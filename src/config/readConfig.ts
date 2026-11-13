/**
 * Reading `lorefountain.config.json`, the project-owned config file at a
 * project's root. Its `folders` section renames the `world/`, `scripts/`,
 * `imports/` and `assets/` folders, so every reader has to honor it.
 *
 * Exports the file name, its Zod schema, {@link readLoreFountainConfig} and
 * two helpers that pull sections out of a parsed config. Read only: writing
 * the file is the extension's job, and its writers stay there.
 *
 * Reading is tolerant: a missing file isn't an error (the defaults apply),
 * and malformed JSON or a schema violation is reported, never thrown.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import type { FolderSettings } from './folders';

/** Filename of the config file, expected at the project root. */
export const CONFIG_FILE_NAME = 'lorefountain.config.json';

/** Zod schema for `lorefountain.config.json`'s contents. Unknown top-level keys are kept. */
export const loreFountainConfigSchema = z
  .object({
    $schema: z.string().optional(),
    folders: z
      .object({
        world: z.string().optional(),
        scripts: z.string().optional(),
        imports: z.string().optional(),
        assets: z.string().optional(),
      })
      .optional(),
    world: z
      .object({
        /** World-tree category ids to hide from the extension's World view (e.g. `"faction"`). Loose strings: an unrecognized id is harmless. */
        hiddenCategories: z.array(z.string()).optional(),
      })
      .optional(),
    /**
     * Comic-script settings (`preset`, `limits`, `sfxAsCue`). Kept loose here on purpose: a bad value
     * must not invalidate the whole file, so `comics/limits`' `comicSettingsFromConfig` validates it
     * part by part and reports what it drops.
     */
    comic: z.unknown().optional(),
  })
  .catchall(z.unknown());

/** A parsed `lorefountain.config.json`. */
export type LoreFountainConfig = z.infer<typeof loreFountainConfigSchema>;

/** Outcome of {@link readLoreFountainConfig}. */
export type ReadConfigResult =
  | { ok: true; config: LoreFountainConfig; found: boolean }
  | { ok: false; reason: 'malformed-json' | 'invalid-schema'; message: string };

/**
 * Read and validate `lorefountain.config.json` from a project root.
 *
 * A missing file is reported as `{ ok: true, found: false, config: {} }`, so
 * callers fall back to the default folder names.
 *
 * @param workspaceRoot - Absolute path to the project root.
 * @returns The parsed config (or defaults), or a described non-throwing failure.
 */
export async function readLoreFountainConfig(workspaceRoot: string): Promise<ReadConfigResult> {
  const filePath = path.join(workspaceRoot, CONFIG_FILE_NAME);

  let text: string;
  try {
    text = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, config: {}, found: false };
    }
    return { ok: false, reason: 'malformed-json', message: errorMessage(err) };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: 'malformed-json', message: `Invalid JSON: ${errorMessage(err)}` };
  }

  const parsed = loreFountainConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid-schema',
      message: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    };
  }

  return { ok: true, config: parsed.data, found: true };
}

/**
 * Extract the `folders` section as plain {@link FolderSettings}.
 *
 * @param config - A parsed config.
 * @returns The folder names it sets; unset names are `undefined`.
 */
export function folderSettingsFromConfig(config: LoreFountainConfig): FolderSettings {
  return {
    world: config.folders?.world,
    scripts: config.folders?.scripts,
    imports: config.folders?.imports,
    assets: config.folders?.assets,
  };
}

/**
 * Extract `world.hiddenCategories` from a parsed config.
 *
 * @param config - A parsed config.
 * @returns The hidden category ids, or none.
 */
export function hiddenCategoriesFromConfig(config: LoreFountainConfig): string[] {
  return config.world?.hiddenCategories ?? [];
}

/** Extract a message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
