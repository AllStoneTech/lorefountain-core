/**
 * The published format of a comic script's `<script>.pages.json` sidecar: a
 * Zod schema (schema version 1), the pure builder that turns a
 * {@link PageMapResult} into the on-disk object, and a tolerant parser for
 * consumers. It sits beside `.shots.json` and `.cues.json`.
 *
 * Exports {@link pageSidecarSchema}, {@link PageSidecar}, {@link buildPageSidecar},
 * {@link parsePageSidecarText}, {@link pageSidecarPathFor} and
 * {@link PAGE_SIDECAR_VERSION}.
 *
 * Core reads and parses only: writing the file on save, and removing it when
 * a script stops having pages, stays in the extension (ADR-0042). The sidecar
 * is derived and disposable, regenerated from the script every time, never
 * hand-edited.
 *
 * Gotchas:
 * - Keys are camelCase except `schema_version`, matching `.shots.json`.
 * - Line numbers are 0-based; ranges are inclusive.
 * - The parser reports a newer `schema_version` without parsing it, so an
 *   older consumer can tell the file is newer than it supports.
 */

import { z } from 'zod';
import type { PageMapResult } from './pageMap';

/** The `schema_version` this module writes and reads. */
export const PAGE_SIDECAR_VERSION = 1;

const lineSchema = z.number().int().min(0);
const lineRangeSchema = z.object({ start: lineSchema, end: lineSchema }).strict();
const actionSchema = z.object({ text: z.string(), line: lineSchema }).strict();

const countsSchema = z
  .object({
    balloons: z.number().int().min(0),
    captions: z.number().int().min(0),
    sfx: z.number().int().min(0),
    words: z.number().int().min(0),
  })
  .strict();

/** A speech or thought balloon. */
export const balloonSchema = z
  .object({
    kind: z.literal('balloon'),
    speaker: z.string(),
    speakerEntity: z.string().optional(),
    extensions: z.array(z.string()),
    offPanel: z.literal(true).optional(),
    simultaneous: z.literal(true).optional(),
    directions: z.array(z.string()),
    text: z.string(),
    line: lineSchema,
  })
  .strict();

/** A narration or caption box. */
export const captionSchema = z
  .object({
    kind: z.literal('caption'),
    speaker: z.string().optional(),
    speakerEntity: z.string().optional(),
    text: z.string(),
    line: lineSchema,
  })
  .strict();

/** A lettered sound effect. */
export const sfxSchema = z
  .object({
    kind: z.literal('sfx'),
    text: z.string(),
    tag: z.string().optional(),
    line: lineSchema,
  })
  .strict();

/** One piece of lettering, discriminated on `kind`. */
export const letteringSchema = z.discriminatedUnion('kind', [balloonSchema, captionSchema, sfxSchema]);

/** One panel. */
export const panelSchema = z
  .object({
    number: z.number().int().min(0),
    description: z.string().optional(),
    tag: z.string().optional(),
    durationText: z.string().optional(),
    durationSeconds: z.number().optional(),
    moveText: z.string().optional(),
    motion: z.string().optional(),
    pageTurn: z.literal(true).optional(),
    shot: z.string().optional(),
    layout: z.string().optional(),
    pose: z.string().optional(),
    light: z.string().optional(),
    action: z.array(actionSchema),
    lettering: z.array(letteringSchema),
    scene: z.number().int().min(0),
    sceneHeading: z.string().optional(),
    lines: lineRangeSchema,
    entities: z.array(z.string()),
    counts: countsSchema,
  })
  .strict();

/** One page. */
export const pageSchema = z
  .object({
    index: z.number().int().min(0),
    implicit: z.literal(true).optional(),
    label: z.string(),
    number: z.number().int().min(0).optional(),
    endNumber: z.number().int().min(0).optional(),
    modifiers: z.array(z.string()),
    layout: z.string().optional(),
    notes: z.array(actionSchema),
    lines: lineRangeSchema,
    panels: z.array(panelSchema),
    entities: z.array(z.string()),
    counts: countsSchema.extend({ panels: z.number().int().min(0) }).strict(),
  })
  .strict();

/** One issue as written to the sidecar. */
export const pageIssueSchema = z
  .object({
    code: z.string(),
    severity: z.enum(['warning', 'info']),
    line: lineSchema,
    path: z.string(),
    message: z.string(),
  })
  .strict();

/** `<script>.pages.json`. */
export const pageSidecarSchema = z
  .object({
    schema_version: z.literal(PAGE_SIDECAR_VERSION),
    /** The generating `.fountain` file's name, relative. */
    script: z.string(),
    /** A warning against hand-editing, embedded in the data (JSON has no comments). */
    generated_by: z.string(),
    totals: countsSchema.extend({ pages: z.number().int().min(0), panels: z.number().int().min(0) }).strict(),
    pages: z.array(pageSchema),
    issues: z.array(pageIssueSchema),
  })
  .strict();

/** The page sidecar's on-disk shape. */
export type PageSidecar = z.infer<typeof pageSidecarSchema>;

/** The text of `generated_by`, shared with the other sidecars' wording. */
export const PAGE_SIDECAR_GENERATED_BY =
  'LoreFountain — auto-generated from the script; do not edit by hand, it will be overwritten';

/**
 * Derive a script's page sidecar path: same directory, `.fountain` swapped for `.pages.json`.
 *
 * @param scriptPath - Path to the `.fountain` script.
 * @returns The sidecar's path.
 */
export function pageSidecarPathFor(scriptPath: string): string {
  return scriptPath.replace(/\.fountain$/, '.pages.json');
}

/**
 * Build the sidecar object for a script. Pure: serializing and writing it
 * (and removing the file when `result.hasPages` is false) is the caller's job.
 *
 * @param scriptName - The `.fountain` file's name, relative to the sidecar.
 * @param result - The script's {@link PageMapResult}.
 * @returns The object to serialize as `<script>.pages.json`.
 */
export function buildPageSidecar(scriptName: string, result: PageMapResult): PageSidecar {
  return {
    schema_version: PAGE_SIDECAR_VERSION,
    script: scriptName,
    generated_by: PAGE_SIDECAR_GENERATED_BY,
    totals: result.totals,
    pages: result.pages,
    issues: result.issues.map(({ code, severity, line, path, message }) => ({ code, severity, line, path, message })),
  };
}

/** Outcome of {@link parsePageSidecarText}. */
export type ParsePageSidecarResult =
  | { ok: true; sidecar: PageSidecar }
  | { ok: false; reason: 'malformed-json' | 'invalid-schema' | 'newer-version'; message: string };

/**
 * Parse and validate a `.pages.json` file's text. Never throws.
 *
 * @param text - The file's contents.
 * @returns The validated sidecar, or a described failure.
 */
export function parsePageSidecarText(text: string): ParsePageSidecarResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: 'malformed-json', message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const version = z.object({ schema_version: z.number() }).safeParse(json);
  if (version.success && version.data.schema_version > PAGE_SIDECAR_VERSION) {
    return {
      ok: false,
      reason: 'newer-version',
      message: `schema version ${version.data.schema_version} is newer than the supported ${PAGE_SIDECAR_VERSION}; update to read it.`,
    };
  }
  const parsed = pageSidecarSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid-schema',
      message: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
    };
  }
  return { ok: true, sidecar: parsed.data };
}
