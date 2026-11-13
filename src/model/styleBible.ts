/**
 * Project style bible schema, parse/serialize and normalization (Core ADR-0002).
 * `world/style.lf.md` is one optional per-project file for visual and tonal style
 * that comics, video and illustrated books all read: a small, tolerant set of
 * frontmatter fields (`medium`, `art_style`, `palette`, `reference_images`,
 * `avoid`, `format`, `lettering`, `era_reference`) plus a free Markdown body
 * (Overall look, Color & light, per-medium notes, whatever the project needs).
 *
 * Posture, as for `storyOverview.ts`: every field is optional, unknown fields
 * round-trip untouched (`catchall`), and a file with no frontmatter at all
 * parses with its whole text as the body. List-like fields accept a single
 * string as a list of one. Only the frontmatter is checked; the body never is.
 *
 * Exports {@link styleBibleSchema}, {@link parseStyleBibleFile},
 * {@link serializeStyleBible}, {@link resolveStyleBible} (normalized view for
 * consumers such as LoreFountain-Producer), {@link parsePaletteEntry} and
 * {@link styleAppliesTo}. Pure: no file access (see `project/styleBible.ts`).
 *
 * Gotcha: an unquoted `#` starts a YAML comment, so `- #2a7f8e` is a null list
 * item. The parse failure says so; hex colours must be quoted.
 */

import { z } from 'zod';
import type { ValidationIssue } from './errors';
import { parseMarkdownWithFrontmatter, serializeMarkdownWithFrontmatter } from './frontmatter';

/**
 * The style bible's file name inside the world folder (lower-case; matched
 * case-insensitively). The `.lf.md` suffix marks a LoreFountain project
 * document, never an entity (Core ADR-0004, `project/files` `isProjectDocument`).
 */
export const STYLE_BIBLE_FILE_NAME = 'style.lf.md';

/** Media the docs and scaffold name. `medium` accepts any string; unknown values are kept. */
export const KNOWN_STYLE_MEDIA: readonly string[] = ['comic', 'video', 'illustrated-book', 'animation', 'audio'];

/** A string, or a list of strings (a lone string means a list of one). */
const textOrList = z.union([z.string(), z.array(z.string())]);

/** A string or number, for hints such as an aspect ratio written `1.78`. */
const scalar = z.union([z.string(), z.number()]);

/** Per-medium format hints: a free note, or an object with the two common keys plus anything else. */
const formatValue = z.union([
  z.string(),
  z
    .object({
      aspect_ratio: scalar.optional(),
      trim_size: scalar.optional(),
    })
    .catchall(z.unknown()),
]);

/** Style bible frontmatter schema. Every field is optional; unknown fields are preserved. */
export const styleBibleSchema = z
  .object({
    /** The media this style applies to, e.g. `comic`, `video`. Empty or absent means every medium. */
    medium: textOrList.optional(),
    /** A one-line summary of the look. */
    art_style: z.string().optional(),
    /** Colour names and/or hex values, e.g. `Harbor teal #2a7f8e`. */
    palette: textOrList.optional(),
    /** Project-relative paths (or URLs) of mood and style references. Not character sheets. */
    reference_images: textOrList.optional(),
    /** Negative prompts: what generated or drawn images must not contain. */
    avoid: textOrList.optional(),
    /** Format hints keyed by medium, e.g. `comic: { trim_size: 6.625x10.25 in }`. */
    format: z.record(z.string(), formatValue).optional(),
    /** Lettering notes for comics (font, balloon style, SFX treatment). */
    lettering: textOrList.optional(),
    /** The period the look draws on, e.g. `1920s pulp covers`. */
    era_reference: z.string().optional(),
  })
  .catchall(z.unknown());

export type StyleBibleFrontmatter = z.infer<typeof styleBibleSchema>;

/** A fully-resolved style bible: validated frontmatter plus file context. */
export interface StyleBible {
  /** Absolute path to `world/style.lf.md`. */
  filePath: string;
  /** Markdown body: the free-form sections. */
  body: string;
  frontmatter: StyleBibleFrontmatter;
}

/** Outcome of {@link parseStyleBibleFile}. */
export type StyleBibleParseResult =
  | { ok: true; style: StyleBible }
  | {
      ok: false;
      reason: 'malformed-yaml' | 'invalid-schema';
      filePath: string;
      message: string;
      issues?: ValidationIssue[];
    };

/**
 * Parse a style bible file into a validated {@link StyleBible}.
 *
 * Never throws; failures are reported via the `ok: false` branch. A file with
 * no frontmatter parses with every field unset and its full text as the body.
 *
 * @param fileText - Raw file contents.
 * @param filePath - Absolute path to the file (never indexed, so no `id` is needed).
 * @returns A discriminated result with the style bible or a described failure.
 */
export function parseStyleBibleFile(fileText: string, filePath: string): StyleBibleParseResult {
  const fm = parseMarkdownWithFrontmatter(fileText);
  if (!fm.ok) {
    return { ok: false, reason: 'malformed-yaml', filePath, message: fm.message };
  }

  const parsed = styleBibleSchema.safeParse(fm.value.frontmatter);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid-schema',
      filePath,
      message: 'Style bible frontmatter failed validation.',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: describeIssue(issue.path, issue.message, fm.value.frontmatter),
      })),
    };
  }

  return { ok: true, style: { filePath, body: fm.value.body, frontmatter: parsed.data } };
}

/**
 * Serialize a {@link StyleBible} back into file text.
 *
 * @param style - The style bible to serialize.
 * @returns The combined frontmatter + body document text.
 */
export function serializeStyleBible(style: StyleBible): string {
  return serializeMarkdownWithFrontmatter(style.frontmatter, style.body);
}

/** Make a union failure on a list field specific: name the first bad item, and explain the `#` comment trap. */
function describeIssue(issuePath: ReadonlyArray<PropertyKey>, message: string, frontmatter: unknown): string {
  let node: unknown = frontmatter;
  for (const key of issuePath) {
    if (node === null || typeof node !== 'object') return message;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  if (Array.isArray(node)) {
    const index = node.findIndex((item) => typeof item !== 'string');
    if (index >= 0) {
      return node[index] === null
        ? `Item ${index + 1} is empty: an unquoted \`#\` starts a YAML comment, so quote hex colours like "#2a7f8e".`
        : `Item ${index + 1} must be text.`;
    }
  }
  return node === null ? `${message} (an empty value: an unquoted \`#\` starts a YAML comment)` : message;
}

/** One palette entry split into an optional name and an optional hex value. */
export interface StylePaletteEntry {
  /** The entry as written. */
  raw: string;
  /** The colour's name, when the entry has words besides the hex. */
  name?: string;
  /** The hex value including `#`, lower-cased, when the entry has one. */
  hex?: string;
}

const HEX_PATTERN = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z])/i;

/**
 * Split a palette string such as `Harbor teal #2a7f8e` or `"#2a7f8e"` into a
 * name and a hex value. Anything with no hex is just a name.
 *
 * @param raw - One palette list item.
 * @returns The entry with `name` and/or `hex` set.
 */
export function parsePaletteEntry(raw: string): StylePaletteEntry {
  const text = raw.trim();
  const match = HEX_PATTERN.exec(text);
  if (!match) return { raw: text, name: text };
  const name = (text.slice(0, match.index) + text.slice(match.index + match[0].length))
    .replace(/[()[\]]/g, ' ')
    .replace(/\s*[:\-–—=]\s*$/, '')
    .replace(/^\s*[:\-–—=]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name ? { raw: text, name, hex: match[0].toLowerCase() } : { raw: text, hex: match[0].toLowerCase() };
}

/** Normalized per-medium format hints. */
export interface StyleFormat {
  aspectRatio?: string;
  trimSize?: string;
  /** The whole hint when it was written as a plain string. */
  note?: string;
  /** Any other keys of an object-shaped hint, untouched. */
  other: Record<string, unknown>;
}

/** The consumer-facing view of a style bible: lists are lists, strings are trimmed, nothing is missing. */
export interface ResolvedStyleBible {
  /** Lower-cased, de-duplicated media; empty means "every medium". */
  medium: string[];
  artStyle?: string;
  palette: StylePaletteEntry[];
  /** As written, in order. Resolve against the project root with `project/styleBible`. */
  referenceImages: string[];
  avoid: string[];
  /** Keyed by lower-cased medium. */
  format: Record<string, StyleFormat>;
  lettering: string[];
  eraReference?: string;
}

/** A string-or-list field as a trimmed list with empty items dropped. */
function toList(value: string | string[] | undefined): string[] {
  const items = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

/** A trimmed string, or `undefined` when blank. */
function toText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/**
 * Normalize validated frontmatter for a consumer. Pure; unknown fields are not
 * part of the view (read them from the frontmatter).
 *
 * @param frontmatter - Frontmatter that passed {@link styleBibleSchema}.
 * @returns The normalized style.
 */
export function resolveStyleBible(frontmatter: StyleBibleFrontmatter): ResolvedStyleBible {
  const medium = [...new Set(toList(frontmatter.medium).map((item) => item.toLowerCase()))];
  const format: Record<string, StyleFormat> = {};
  for (const [key, value] of Object.entries(frontmatter.format ?? {})) {
    const name = key.trim().toLowerCase();
    if (!name) continue;
    if (typeof value === 'string') {
      const note = toText(value);
      format[name] = note ? { note, other: {} } : { other: {} };
      continue;
    }
    const { aspect_ratio: aspect, trim_size: trim, ...other } = value;
    const entry: StyleFormat = { other };
    if (aspect !== undefined) entry.aspectRatio = String(aspect).trim();
    if (trim !== undefined) entry.trimSize = String(trim).trim();
    format[name] = entry;
  }
  const resolved: ResolvedStyleBible = {
    medium,
    palette: toList(frontmatter.palette).map(parsePaletteEntry),
    referenceImages: toList(frontmatter.reference_images),
    avoid: toList(frontmatter.avoid),
    format,
    lettering: toList(frontmatter.lettering),
  };
  const artStyle = toText(frontmatter.art_style);
  if (artStyle) resolved.artStyle = artStyle;
  const era = toText(frontmatter.era_reference);
  if (era) resolved.eraReference = era;
  return resolved;
}

/**
 * Whether a style applies to a medium: always when the style names no medium,
 * otherwise only when it lists it.
 *
 * @param style - The resolved style.
 * @param medium - A medium name such as `comic`; compared case-insensitively.
 * @returns True when the style covers that medium.
 */
export function styleAppliesTo(style: ResolvedStyleBible, medium: string): boolean {
  return style.medium.length === 0 || style.medium.includes(medium.trim().toLowerCase());
}
