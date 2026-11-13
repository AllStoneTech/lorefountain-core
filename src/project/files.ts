/**
 * File discovery for a LoreFountain project: which files under the world
 * and scripts folders are entities, glossary terms, timeline events and
 * scripts. The rules match the extension's index build exactly.
 *
 * Exports {@link listFilesWithExtension}, {@link ENTITY_EXCLUDED_SUBDIRS},
 * {@link PROJECT_DOCUMENT_SUFFIX}, {@link isProjectDocument} and
 * {@link isNonEntityDoc}. Read only.
 */

import type { Dirent } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

/** Subfolders of the world folder that hold glossary terms, timeline events and notes, never entities. */
export const ENTITY_EXCLUDED_SUBDIRS: readonly string[] = ['glossary', 'timeline', 'notes'];

/** The suffix that marks a LoreFountain project document (Core ADR-0003): `style.lf.md`, and any future `*.lf.md`. */
export const PROJECT_DOCUMENT_SUFFIX = '.lf.md';

/**
 * True for a LoreFountain project document: a Markdown file whose name ends
 * `.lf.md` (case-insensitive), such as the style bible `world/style.lf.md`.
 * Project documents are LoreFountain's own files about a project. They are
 * never entities, glossary terms, timeline events or notes, wherever they sit,
 * so every walker, watcher, validator and tree must skip them. This one
 * predicate is the whole rule: a future `*.lf.md` needs no new special case.
 *
 * @param filePath - A file path or bare file name.
 * @returns Whether the file name ends in `.lf.md` (and has a name before it).
 */
export function isProjectDocument(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return name.length > PROJECT_DOCUMENT_SUFFIX.length && name.endsWith(PROJECT_DOCUMENT_SUFFIX);
}

/**
 * True for LoreFountain's own reference docs that sit inside indexed folders
 * but are never entity, glossary or event files: a scaffolded `README.md`,
 * the legacy Story Overview `OVERVIEW.md` and the folder `README.md` (older, un-suffixed names, kept as
 * they are), and any project document ({@link isProjectDocument}, e.g. the
 * style bible `style.lf.md`, Core ADR-0002/0003). Case-insensitive.
 *
 * @param filePath - A path to a `.md` file.
 * @returns Whether the file is one of those docs.
 */
export function isNonEntityDoc(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return name === 'readme.md' || name === 'overview.md' || isProjectDocument(filePath);
}

/**
 * Recursively collect file paths under `dir` whose name ends with
 * `extension`, skipping any directory named in `excludeSubdirNames` at any
 * depth. A missing `dir` yields an empty list.
 *
 * @param dir - The folder to search.
 * @param extension - The file name ending to match, e.g. `.fountain`.
 * @param excludeSubdirNames - Directory names to skip.
 * @returns Matching absolute paths, sorted.
 * @throws Re-throws filesystem errors other than a missing folder.
 */
export async function listFilesWithExtension(
  dir: string,
  extension: string,
  excludeSubdirNames: readonly string[] = [],
): Promise<string[]> {
  const results: string[] = [];
  await walk(dir, extension, new Set(excludeSubdirNames), results);
  return results.sort();
}

/** Depth-first walk collecting matching files into `out`. */
async function walk(dir: string, extension: string, excluded: ReadonlySet<string>, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excluded.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), extension, excluded, out);
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      out.push(path.join(dir, entry.name));
    }
  }
}
