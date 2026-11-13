/**
 * Script export options (Core ADR-0003): what to include, as a Zod schema so
 * options read from `lorefountain.config.json` or a webview are validated,
 * plus the four presets.
 *
 * Exports {@link exportContentSchema}, {@link ExportContent},
 * {@link EXPORT_PRESETS}, {@link ExportPresetId}, {@link presetContent} and
 * {@link parseExportContent}.
 *
 * Gotchas:
 * - Boneyard is off in every preset, so cut material never leaves a project
 *   by accident.
 * - "Pure Fountain" removes LoreFountain's additions only. Notes, sections
 *   and synopses are standard Fountain, so they stay.
 */

import { z } from 'zod';

/** How scene numbers appear in an export. */
export const SCENE_NUMBER_MODES = ['as-written', 'auto', 'none'] as const;

/** One scene-number mode: keep `#1#` as written, number every scene automatically, or drop them. */
export type SceneNumberMode = (typeof SCENE_NUMBER_MODES)[number];

/** What an export includes. Every field is required, so a stored choice never depends on a default changing. */
export const exportContentSchema = z.strictObject({
  /** `SHOT:`, `POSE:`, `LIGHT:` and `DURATION:` lines. */
  shots: z.boolean(),
  /** `SFX:`, `MUSIC:` and `AMB:` lines. */
  sound: z.boolean(),
  /** `PAUSE:` lines. */
  pauses: z.boolean(),
  /** The comic lines `PAGE:`, `PANEL:`, `LAYOUT:` and `CAPTION:`. */
  comic: z.boolean(),
  /** `[tags]` after a convention keyword. Dropping a tag keeps its line. */
  tags: z.boolean(),
  /** `[[notes]]`. */
  notes: z.boolean(),
  /** `#` sections. */
  sections: z.boolean(),
  /** `=` synopses. */
  synopses: z.boolean(),
  /** Boneyard (cut) text, between slash-star and star-slash markers. */
  boneyard: z.boolean(),
  /** LoreFountain's title-page keys, `Order:` and `Production Code:`. */
  loreFountainTitleKeys: z.boolean(),
  /** How scene numbers appear. */
  sceneNumbers: z.enum(SCENE_NUMBER_MODES),
});

/** What an export includes. */
export type ExportContent = z.infer<typeof exportContentSchema>;

/** The built-in presets' ids, plus `custom` for the writer's own choices. */
export const EXPORT_PRESET_IDS = ['pure', 'production', 'audio', 'custom'] as const;

/** One preset id. */
export type ExportPresetId = (typeof EXPORT_PRESET_IDS)[number];

/** A built-in preset: its label, a one-line description and its content. */
export interface ExportPreset {
  label: string;
  description: string;
  content: ExportContent;
}

const STANDARD_ONLY: ExportContent = {
  shots: false,
  sound: false,
  pauses: false,
  comic: false,
  tags: false,
  notes: true,
  sections: true,
  synopses: true,
  boneyard: false,
  loreFountainTitleKeys: false,
  sceneNumbers: 'as-written',
};

/** The built-in presets. `custom` starts from Production draft. */
export const EXPORT_PRESETS: Readonly<Record<ExportPresetId, ExportPreset>> = {
  pure: {
    label: 'Pure Fountain',
    description: 'Standard Fountain only: every LoreFountain line, tag and title key removed.',
    content: STANDARD_ONLY,
  },
  production: {
    label: 'Production draft',
    description: 'Everything in the script, including shots, sound cues, pauses and tags.',
    content: {
      shots: true,
      sound: true,
      pauses: true,
      comic: true,
      tags: true,
      notes: true,
      sections: true,
      synopses: true,
      boneyard: false,
      loreFountainTitleKeys: true,
      sceneNumbers: 'as-written',
    },
  },
  audio: {
    label: 'Audio draft',
    description: 'Sound cues and pauses kept; shot lines and tags removed.',
    content: { ...STANDARD_ONLY, sound: true, pauses: true, loreFountainTitleKeys: true },
  },
  custom: {
    label: 'Custom',
    description: 'Your own choice of what to include.',
    content: {
      shots: true,
      sound: true,
      pauses: true,
      comic: true,
      tags: true,
      notes: true,
      sections: true,
      synopses: true,
      boneyard: false,
      loreFountainTitleKeys: true,
      sceneNumbers: 'as-written',
    },
  },
};

/**
 * The content a preset includes, as a fresh copy the caller may change.
 *
 * @param preset - A preset id.
 * @returns That preset's content.
 */
export function presetContent(preset: ExportPresetId): ExportContent {
  return { ...EXPORT_PRESETS[preset].content };
}

/** Result of {@link parseExportContent}. */
export type ParseExportContentResult = { ok: true; content: ExportContent } | { ok: false; message: string };

/**
 * Validate export content from outside the program (a config file, a
 * webview message).
 *
 * @param value - The unvalidated value; expected to be an object with every {@link ExportContent} field.
 * @returns The parsed content, or a readable message saying what is wrong.
 */
export function parseExportContent(value: unknown): ParseExportContentResult {
  const result = exportContentSchema.safeParse(value);
  if (result.success) return { ok: true, content: result.data };
  return { ok: false, message: z.prettifyError(result.error) };
}
