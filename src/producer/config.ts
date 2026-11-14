/**
 * The published format of `producer.json`, LoreFountain-Producer's settings
 * file at a project's root, and a read-only reader for it. The Producer
 * owns and writes the file; LoreFountain reads it (tolerantly) to show
 * production status. Both validate against this one schema (Producer spec,
 * "Reading each other's data").
 *
 * Exports {@link producerConfigSchema}, its parts, the inferred types,
 * {@link PRODUCER_CONFIG_VERSION} and {@link readProducerConfig}.
 *
 * Gotchas:
 * - Keys are camelCase, except `schema_version`, matching the sidecars.
 *   The spec's per-shot fix names (`audio_offset`, `hold_after`) are
 *   `audioOffset` and `holdAfter` here.
 * - Objects are strict, so a typo is caught rather than silently ignored.
 *   A file from a newer Producer is reported as `newer-version` before any
 *   parsing, so an older reader never misreads fields it doesn't know.
 * - No secrets live here: API keys belong in the OS keychain.
 * - Every section is optional; an empty `{ "schema_version": 1 }` is valid.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

/** The `schema_version` this module reads and the Producer writes. */
export const PRODUCER_CONFIG_VERSION = 1;

/** Filename of the Producer's settings file, at the project root. */
export const PRODUCER_CONFIG_FILE_NAME = 'producer.json';

/** The asset types a project sources (spec, "Sources per asset type"). */
export const PRODUCER_ASSET_TYPES = ['voice', 'stills', 'clips', 'music', 'sfx'] as const;
export const producerAssetTypeSchema = z.enum(PRODUCER_ASSET_TYPES);
export type ProducerAssetType = z.infer<typeof producerAssetTypeSchema>;

/** How one asset type is sourced: the creator supplies files, or a provider generates them. */
export const assetSourceSchema = z
  .object({
    source: z.enum(['provided', 'generated']),
    /** The provider plugin id, e.g. `manual`, `elevenlabs`, `comfyui`. Defaults to `manual`. */
    provider: z.string().min(1).optional(),
    /** Providers to try in order when the main one refuses a job. */
    fallback: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type AssetSource = z.infer<typeof assetSourceSchema>;

/** How takes are chosen (spec, "Take policy"). */
export const takePolicyValueSchema = z.enum(['pick', 'auto-review', 'auto']);
export type TakePolicyValue = z.infer<typeof takePolicyValueSchema>;

export const takePolicySchema = z
  .object({
    default: takePolicyValueSchema,
    /** Per-asset-type overrides, e.g. auto-pick SFX while hand-picking stills. */
    byType: z.partialRecord(producerAssetTypeSchema, takePolicyValueSchema).optional(),
  })
  .strict();
export type TakePolicy = z.infer<typeof takePolicySchema>;

/** One character's text-to-speech casting. */
export const castingEntrySchema = z
  .object({
    provider: z.string().min(1),
    /** The provider's voice id. */
    voice: z.string().min(1),
    /** Free-form style or settings hint for the provider. */
    style: z.string().optional(),
  })
  .strict();
export type CastingEntry = z.infer<typeof castingEntrySchema>;

/** A text style template for on-screen text (fonts and layout are provider/renderer concerns, kept loose). */
export const textStyleSchema = z
  .object({
    font: z.string().optional(),
    size: z.number().positive().optional(),
    color: z.string().optional(),
    background: z.string().optional(),
    position: z.enum(['top', 'center', 'bottom', 'lower-third']).optional(),
    /** Path to a template file, relative to the project root. */
    template: z.string().optional(),
  })
  .strict();
export type TextStyle = z.infer<typeof textStyleSchema>;

/**
 * How the Producer makes a project: one coordinator per production type
 * (Producer `docs/COORDINATORS.md`). Separate from LoreFountain's
 * `project_type`, which says how a work is written.
 */
export const PRODUCTION_TYPES = [
  'narrated_series',
  'animatic',
  'audio_drama',
  'motion_comic',
  'comic_pages',
  'dialogue_video',
  'audiobook',
  'table_kit',
  'explainer',
] as const;
export const productionTypeSchema = z.enum(PRODUCTION_TYPES);
export type ProductionType = z.infer<typeof productionTypeSchema>;

/** What a production delivers. */
export const PRODUCTION_OUTPUTS = ['video-16x9', 'video-9x16', 'podcast', 'captions', 'segments-9x16', 'audiobook', 'session-pack'] as const;
export const productionOutputSchema = z.enum(PRODUCTION_OUTPUTS);
export type ProductionOutput = z.infer<typeof productionOutputSchema>;

/**
 * How one shot's picture is made: a still with a camera move, a generated
 * animation clip (made from the shot's still), or a title card.
 */
export const SHOT_TREATMENTS = ['still', 'animated', 'card'] as const;
export const shotTreatmentSchema = z.enum(SHOT_TREATMENTS);
export type ShotTreatment = z.infer<typeof shotTreatmentSchema>;

/** Per-shot fixes made on the timeline, keyed by shot tag (spec, "The timeline"). */
export const shotFixSchema = z
  .object({
    /** How the shot's picture is made; a shot without one is a `still` (or a `card` when it's only on-screen text). */
    treatment: shotTreatmentSchema.optional(),
    /** Seconds to shift the recording against the picture (lip sync). */
    audioOffset: z.number().optional(),
    /** Seconds trimmed from a clip's start and end. */
    trims: z.object({ start: z.number().nonnegative().optional(), end: z.number().nonnegative().optional() }).strict().optional(),
    /** Seconds of silence after the shot's last line. */
    tail: z.number().nonnegative().optional(),
    /** Seconds to hold the shot's last frame after it ends. */
    holdAfter: z.number().nonnegative().optional(),
    /** Where the subject sits, for the vertical reframe. */
    focus: z.enum(['left', 'center', 'right']).optional(),
    /** Overrides the shot manifest's `motion` for a still. */
    motion: z.string().optional(),
    /** Overrides the shot's length, in seconds. */
    durationSeconds: z.number().positive().optional(),
  })
  .strict();
export type ShotFix = z.infer<typeof shotFixSchema>;

/** One accepted coverage sub-shot (spec, "Coverage"). */
export const coverageShotSchema = z
  .object({
    /** The sub-shot's tag, derived from the parent's: `1x03-harbor-wide.c1`. */
    tag: z.string().min(1),
    description: z.string(),
    /** Seconds from the parent shot's start. */
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .strict()
  .refine((shot) => shot.end > shot.start, { message: 'end must be after start' });
export type CoverageShot = z.infer<typeof coverageShotSchema>;

export const producerConfigSchema = z
  .object({
    schema_version: z.literal(PRODUCER_CONFIG_VERSION),
    project: z
      .object({
        /** True when the project will be used commercially, which turns on commercial-terms warnings. */
        commercial: z.boolean().optional(),
        /** The starting profile this project came from, e.g. `short-dialogue`. */
        profile: z.string().optional(),
      })
      .strict()
      .optional(),
    /** How the project is produced. When absent, the Producer suggests a type from LoreFountain's `project_type`. */
    production: z
      .object({
        type: productionTypeSchema,
        outputs: z.array(productionOutputSchema).min(1).optional(),
      })
      .strict()
      .optional(),
    /** Spending caps, in US dollars. A run stops before a call that would cross one. */
    budget: z
      .object({
        /** Most jobs one run may do (default 5). */
        maxJobsPerRun: z.number().int().positive().optional(),
        /** Most one run may spend (default 2). */
        maxCostPerRun: z.number().nonnegative().optional(),
        /** Most the project may spend in total, across runs. */
        maxCostTotal: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    sources: z.partialRecord(producerAssetTypeSchema, assetSourceSchema).optional(),
    /** Below-type overrides, keyed by shot or cue tag. */
    overrides: z.record(z.string(), z.partialRecord(producerAssetTypeSchema, assetSourceSchema)).optional(),
    takePolicy: takePolicySchema.optional(),
    vault: z
      .object({
        /** The media vault folder, outside the project. */
        path: z.string().min(1),
        /** Days before a rejected take is cleared (default 30). */
        keepRejectedDays: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    output: z
      .object({
        formats: z.array(z.enum(['16:9', '9:16'])).min(1).optional(),
        loudness: z.object({ video: z.number().optional(), podcast: z.number().optional() }).strict().optional(),
      })
      .strict()
      .optional(),
    /** Text-to-speech casting, keyed by character entity id. */
    casting: z.record(z.string(), castingEntrySchema).optional(),
    /** On-screen text styles, keyed by style tag; the keys `super`, `titleCard`, `chyron` and `captions` are the defaults. */
    textStyles: z.record(z.string(), textStyleSchema).optional(),
    /** Accepted takes promoted to a character's references, keyed by character id; values are file fingerprints. */
    lockedReferences: z.record(z.string(), z.array(z.string().min(1))).optional(),
    shots: z.record(z.string(), shotFixSchema).optional(),
    /** Accepted coverage, keyed by parent shot tag. */
    coverage: z.record(z.string(), z.array(coverageShotSchema)).optional(),
  })
  .strict();

/** A parsed `producer.json`. */
export type ProducerConfig = z.infer<typeof producerConfigSchema>;

/** Outcome of {@link readProducerConfig}. */
export type ReadProducerConfigResult =
  | { ok: true; found: false }
  | { ok: true; found: true; config: ProducerConfig }
  | { ok: false; reason: 'malformed-json' | 'invalid-schema' | 'newer-version'; message: string };

/**
 * Read and validate `producer.json` from a project root. Never throws for a
 * bad file.
 *
 * @param projectRoot - Absolute path to the project root.
 * @returns The config, `found: false` when there's none, or a described failure.
 */
export async function readProducerConfig(projectRoot: string): Promise<ReadProducerConfigResult> {
  let text: string;
  try {
    text = await fsp.readFile(path.join(projectRoot, PRODUCER_CONFIG_FILE_NAME), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, found: false };
    return { ok: false, reason: 'malformed-json', message: errorMessage(err) };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: 'malformed-json', message: `Invalid JSON: ${errorMessage(err)}` };
  }

  const version = z.object({ schema_version: z.number() }).safeParse(json);
  if (version.success && version.data.schema_version > PRODUCER_CONFIG_VERSION) {
    return {
      ok: false,
      reason: 'newer-version',
      message: `producer.json is schema version ${version.data.schema_version}; this reader supports version ${PRODUCER_CONFIG_VERSION}. Update to read it.`,
    };
  }

  const parsed = producerConfigSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid-schema',
      message: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
    };
  }
  return { ok: true, found: true, config: parsed.data };
}

/** Extract a message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
