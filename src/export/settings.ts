/**
 * A project's saved export settings: the `export` section of
 * `lorefountain.config.json` (Core ADR-0003, section 2). It holds the
 * writer's Custom preset, the preset and format last used, and the paper size.
 *
 * Exports {@link exportSettingsSchema}, {@link ExportSettings},
 * {@link EXPORT_FORMATS}, {@link ExportFormat}, {@link EXPORT_LAYOUTS},
 * {@link ExportLayoutSetting}, {@link ExportLayout},
 * {@link DEFAULT_EXPORT_SETTINGS}, {@link exportSettingsFromConfig},
 * {@link defaultLayoutForProjectType}, {@link resolveExportLayout} and
 * {@link languageSchema}.
 *
 * Gotchas:
 * - The config schema keeps `export` as unknown, and it is validated here
 *   field by field: a bad export value falls back to its default and never
 *   stops the rest of the config (folder names) from loading.
 * - `project_type` isn't in the config yet. {@link defaultLayoutForProjectType}
 *   is the one place that maps it, to be aligned with the real field when it
 *   lands (ADR-0004, section 1).
 */

import { z } from 'zod';
import type { LoreFountainConfig } from '../config/readConfig';
import { EXPORT_PRESET_IDS, exportContentSchema, presetContent, type ExportContent, type ExportPresetId } from './options';

/** Every export format: the five script formats plus the dialogue transcript. */
export const EXPORT_FORMATS = ['pdf', 'fountain', 'fdx', 'html', 'docx', 'transcript'] as const;

/** One export format. */
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The page layouts a writer can choose: automatic, or one of the two layouts. */
export const EXPORT_LAYOUTS = ['auto', 'screenplay', 'comic'] as const;

/** A layout setting, `auto` included. */
export type ExportLayoutSetting = (typeof EXPORT_LAYOUTS)[number];

/** A resolved layout. */
export type ExportLayout = Exclude<ExportLayoutSetting, 'auto'>;

/** A BCP 47 language tag that `Intl` accepts, e.g. `en`, `en-GB`, `yo`. */
export const languageSchema = z
  .string()
  .min(1)
  .max(35)
  .refine((tag) => {
    try {
      return Intl.getCanonicalLocales(tag).length === 1;
    } catch {
      return false;
    }
  }, 'Expected a language tag such as en, en-GB or yo.');

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
  /** The page layout for PDF, Word and HTML. */
  layout: z.enum(EXPORT_LAYOUTS),
  /** Mark comic pages LEFT or RIGHT. */
  comicPageSides: z.boolean(),
  /** The language exports declare, as a BCP 47 tag. */
  language: languageSchema,
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
  layout: 'auto',
  comicPageSides: false,
  language: 'en',
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
    layout: pick<ExportLayoutSetting>(exportSettingsSchema.shape.layout, raw.layout, DEFAULT_EXPORT_SETTINGS.layout),
    comicPageSides: pick(exportSettingsSchema.shape.comicPageSides, raw.comicPageSides, DEFAULT_EXPORT_SETTINGS.comicPageSides),
    language: pick(languageSchema, raw.language, DEFAULT_EXPORT_SETTINGS.language),
    custom: pick<ExportContent>(exportContentSchema, raw.custom, { ...DEFAULT_EXPORT_SETTINGS.custom }),
  };
}

/**
 * The layout a project type implies, when it implies one.
 *
 * @param projectType - The project's type, when the project has one. Expected to be a short id such as `comic`.
 * @returns `comic` for a comic project; `undefined` otherwise, so the script decides.
 */
export function defaultLayoutForProjectType(projectType: string | undefined): ExportLayout | undefined {
  switch (projectType?.trim().toLowerCase()) {
    case 'comic':
    case 'comics':
    case 'graphic-novel':
      return 'comic';
    default:
      return undefined;
  }
}

/** What {@link resolveExportLayout} knows about the project and script. */
export interface LayoutContext {
  /** The project's type, when it has one. */
  projectType?: string;
  /** Whether the script has at least one explicit `PAGE:` line (`hasComicPages`). */
  hasComicPages: boolean;
}

/**
 * Resolve a layout setting for one script: an explicit choice wins, then the
 * project type, then whether the script is written with `PAGE:` lines.
 *
 * @param setting - The writer's layout setting.
 * @param context - The project type and whether the script has comic pages.
 * @returns The layout to use.
 */
export function resolveExportLayout(setting: ExportLayoutSetting, context: LayoutContext): ExportLayout {
  if (setting !== 'auto') return setting;
  return defaultLayoutForProjectType(context.projectType) ?? (context.hasComicPages ? 'comic' : 'screenplay');
}
