/**
 * Read-only loading of a project's style bible, `world/style.lf.md` (Core
 * ADR-0002): finds the file (any letter case), parses it with
 * `model/styleBible`, and resolves its `reference_images` against the project
 * root, checking which exist.
 *
 * Exports {@link readStyleBible}, {@link findStyleBibleFile}, {@link resolveReferenceImage} and the result
 * types. Used by `loadProject` and by the extension's validator.
 *
 * Gotchas:
 * - Never writes, never throws for a bad file; failures come back as a status.
 * - A missing reference image is not an error. It is listed in
 *   `missingReferenceImages` so a caller can report it as information.
 * - Reference images are project-relative. A path that leaves the project
 *   (absolute, or climbing out with `..`) is flagged `outside-project` and is
 *   not touched; a URL is `remote` and is not checked.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { ValidationIssue } from '../model/errors';
import {
  STYLE_BIBLE_FILE_NAME,
  parseStyleBibleFile,
  resolveStyleBible,
  type ResolvedStyleBible,
  type StyleBibleFrontmatter,
} from '../model/styleBible';

/** Where a `reference_images` entry points. */
export type StyleReferenceKind = 'file' | 'remote' | 'outside-project';

/** One `reference_images` entry, resolved. */
export interface StyleReferenceImage {
  /** The entry as written. */
  path: string;
  kind: StyleReferenceKind;
  /** Absolute path, for `file` entries. */
  absolutePath?: string;
  /** Whether the file exists. Only set for `file` entries. */
  exists?: boolean;
}

/** A style bible that loaded, with its references resolved. */
export interface LoadedStyleBible {
  filePath: string;
  body: string;
  /** Validated frontmatter, including any unknown fields. */
  frontmatter: StyleBibleFrontmatter;
  /** The normalized view. */
  resolved: ResolvedStyleBible;
  referenceImages: StyleReferenceImage[];
  /** `path` of each `file` reference that does not exist. */
  missingReferenceImages: string[];
}

/** Result of {@link readStyleBible}. */
export type ReadStyleBibleResult =
  | { status: 'absent' }
  | { status: 'ok'; style: LoadedStyleBible }
  | { status: 'invalid'; filePath: string; reason: 'malformed-yaml' | 'invalid-schema'; message: string; issues?: ValidationIssue[] }
  | { status: 'read-error'; filePath: string; message: string };

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Classify and resolve one reference image path against the project root.
 * Pure (no file access).
 *
 * @param entry - The entry as written in `reference_images`.
 * @param projectRoot - Absolute path to the project root.
 * @returns The entry with its kind and, for a file inside the project, its absolute path.
 */
export function resolveReferenceImage(entry: string, projectRoot: string): StyleReferenceImage {
  if (URL_PATTERN.test(entry)) return { path: entry, kind: 'remote' };
  const absolutePath = path.resolve(projectRoot, entry);
  const relative = path.relative(path.resolve(projectRoot), absolutePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { path: entry, kind: 'outside-project' };
  }
  return { path: entry, kind: 'file', absolutePath };
}

/**
 * Read and parse `style.lf.md` from the world folder, if there is one.
 *
 * @param worldFolder - Absolute path to the project's world folder.
 * @param projectRoot - Absolute path to the project root, for resolving reference images.
 * @returns `absent` when there is no file, `ok` with the style, or why it could not be used.
 */
export async function readStyleBible(worldFolder: string, projectRoot: string): Promise<ReadStyleBibleResult> {
  const filePath = await findStyleBibleFile(worldFolder);
  if (filePath === undefined) return { status: 'absent' };

  let text: string;
  try {
    text = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    return { status: 'read-error', filePath, message: err instanceof Error ? err.message : String(err) };
  }

  const parsed = parseStyleBibleFile(text, filePath);
  if (!parsed.ok) {
    return {
      status: 'invalid',
      filePath,
      reason: parsed.reason,
      message: parsed.message,
      ...(parsed.issues ? { issues: parsed.issues } : {}),
    };
  }

  const resolved = resolveStyleBible(parsed.style.frontmatter);
  const referenceImages: StyleReferenceImage[] = [];
  for (const entry of resolved.referenceImages) {
    const reference = resolveReferenceImage(entry, projectRoot);
    if (reference.kind === 'file' && reference.absolutePath !== undefined) {
      reference.exists = await isFile(reference.absolutePath);
    }
    referenceImages.push(reference);
  }

  return {
    status: 'ok',
    style: {
      filePath,
      body: parsed.style.body,
      frontmatter: parsed.style.frontmatter,
      resolved,
      referenceImages,
      missingReferenceImages: referenceImages.filter((ref) => ref.exists === false).map((ref) => ref.path),
    },
  };
}

/**
 * The `style.lf.md` directly inside the world folder, matched case-insensitively.
 *
 * @param worldFolder - Absolute path to the project's world folder.
 * @returns The file's absolute path, or `undefined` when there is none (or no world folder).
 */
export async function findStyleBibleFile(worldFolder: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await fsp.readdir(worldFolder);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  const name = names.sort().find((candidate) => candidate.toLowerCase() === STYLE_BIBLE_FILE_NAME);
  return name === undefined ? undefined : path.join(worldFolder, name);
}

/** Whether `target` exists and is a file. */
async function isFile(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isFile();
  } catch {
    return false;
  }
}
