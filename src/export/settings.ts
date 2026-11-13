/**
 * A project's saved export settings: the `export` section of
 * `lorefountain.config.json` (Core ADR-0003, section 2). It holds the
 * writer's Custom preset, the preset and format last used, and the paper size.
 *
 * Exports {@link exportSettingsSchema}, {@link ExportSettings},
 * {@link EXPORT_FORMATS}, {@link ExportFormat}, {@link DEFAULT_EXPORT_SETTINGS}
 * and {@link exportSettingsFromConfig}.
 *
 * Gotchas:
 * - The config schema keeps `export` as unknown, and it is validated here
 *   field by field: a bad export value falls back to its default and never
 *   stops the rest of the config (folder names) from loading.
 */

import { z } from 'zod';
import type { LoreFountainConfig } from '../config/readConfig';
import { EXPORT_PRESET_IDS, exportContentSchema, presetContent, type ExportContent, type ExportPresetId } from './options';

/** Every export format: the five script formats plus the dialogue transcript. */
export const EXPORT_FORMATS = ['pdf', 'fountain', 'fdx', 'html', 'docx', 'transcript'] as const;

/** One export format. */
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The `export` section of `lorefountain.config.json`. */
export const exportSettingsSchema = z.strictObject({
  /** The preset used last. */
  preset: z.enum(EXPORT_PRESET_IDS),
  /** The format used last. */
  format: z.enum(EXPORT_FORMATS),
  /** Paper for PDF and Word. */
  paper: z.enum(['letter', 'a4']),
  /** Start PDF and Word exports with the title page. */
  titlePage: z.boolean(),
  /** The writer's own Custom preset. */
  custom: exportContentSchema,
});

/** A project's export settings. */
export type ExportSettings = z.infer<typeof exportSettingsSchema>;

/** Settings for a project that has saved none: PDF on US Letter, Production draft. */
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  preset: 'production',
  format: 'pdf',
  paper: 'letter',
  titlePage: true,
  custom: presetContent('custom'),
};

/**
 * Read the export settings from a parsed config, field by field, falling
 * back to {@link DEFAULT_EXPORT_SETTINGS} for any field that is missing or invalid.
 *
 * @param config - A parsed `lorefountain.config.json`.
 * @returns Complete, valid export settings.
 */
export function exportSettingsFromConfig(config: LoreFountainConfig): ExportSettings {
  const section: unknown = config.export;
  if (typeof section !== 'object' || section === null) return { ...DEFAULT_EXPORT_SETTINGS, custom: { ...DEFAULT_EXPORT_SETTINGS.custom } };
  const raw = section as Record<string, unknown>;
  const pick = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };
  return {
    preset: pick<ExportPresetId>(exportSettingsSchema.shape.preset, raw.preset, DEFAULT_EXPORT_SETTINGS.preset),
    format: pick<ExportFormat>(exportSettingsSchema.shape.format, raw.format, DEFAULT_EXPORT_SETTINGS.format),
    paper: pick(exportSettingsSchema.shape.paper, raw.paper, DEFAULT_EXPORT_SETTINGS.paper),
    titlePage: pick(exportSettingsSchema.shape.titlePage, raw.titlePage, DEFAULT_EXPORT_SETTINGS.titlePage),
    custom: pick<ExportContent>(exportContentSchema, raw.custom, { ...DEFAULT_EXPORT_SETTINGS.custom }),
  };
}
