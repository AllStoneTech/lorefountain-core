/**
 * Finding a project's Story Overview file (Core ADR-0004, follow-up). The
 * Story Overview is `world/overview.lf.md`; before the `.lf.md` convention it
 * was `world/OVERVIEW.md`. Readers accept both for as long as projects still
 * carry the old name (the extension renames it on first run), and prefer the
 * new one when both exist.
 *
 * Exports {@link OVERVIEW_FILE_NAME}, {@link LEGACY_OVERVIEW_FILE_NAME} and
 * {@link findStoryOverviewFile}. Read only.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

/** The Story Overview's file name inside the world folder (lower-case; matched case-insensitively). */
export const OVERVIEW_FILE_NAME = 'overview.lf.md';

/** The name used before the `.lf.md` convention; still read, never written. */
export const LEGACY_OVERVIEW_FILE_NAME = 'overview.md';

/** Which file {@link findStoryOverviewFile} found. */
export interface FoundStoryOverview {
  filePath: string;
  /** True when the file still has the pre-convention name. */
  legacy: boolean;
}

/**
 * The Story Overview directly inside the world folder: `overview.lf.md` if
 * there is one, otherwise the legacy `OVERVIEW.md`; matched case-insensitively.
 *
 * @param worldFolder - Absolute path to the project's world folder.
 * @returns The file and whether it is the legacy name, or `undefined` when there is none (or no world folder).
 */
export async function findStoryOverviewFile(worldFolder: string): Promise<FoundStoryOverview | undefined> {
  let names: string[];
  try {
    names = await fsp.readdir(worldFolder);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  const sorted = names.sort();
  const current = sorted.find((candidate) => candidate.toLowerCase() === OVERVIEW_FILE_NAME);
  if (current !== undefined) return { filePath: path.join(worldFolder, current), legacy: false };
  const legacy = sorted.find((candidate) => candidate.toLowerCase() === LEGACY_OVERVIEW_FILE_NAME);
  return legacy === undefined ? undefined : { filePath: path.join(worldFolder, legacy), legacy: true };
}
