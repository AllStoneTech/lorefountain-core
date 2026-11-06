/**
 * The published formats of the records LoreFountain-Producer keeps in a
 * project's `producer/` folder, and read-only readers for them:
 *
 * - `producer/takes.json`: which file fulfills each shot tag, spoken line
 *   (`<shot-tag>.<n>`) and cue tag.
 * - `producer/provenance.json`: where each accepted file came from, keyed
 *   by the file's fingerprint (Producer spec, "Rights and provenance").
 *
 * Exports the schemas, inferred types, file paths, {@link readTakes},
 * {@link readProvenance} and {@link emptyTakes}/{@link emptyProvenance}.
 * The Producer writes these files; LoreFountain only reads them.
 *
 * Gotchas:
 * - `file` paths are relative to the media vault's root, never absolute,
 *   so a vault can move to another drive.
 * - `madeFrom` is the fingerprint of the script text the take was made
 *   from (`producer/fingerprint`), which is how a take is found stale.
 * - Readers report a newer `schema_version` without parsing it.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

/** The `schema_version` these readers support. */
export const PRODUCER_RECORDS_VERSION = 1;

/** Paths of the record files, relative to the project root. */
export const TAKES_FILE = path.join('producer', 'takes.json');
export const PROVENANCE_FILE = path.join('producer', 'provenance.json');

/** A content fingerprint: `sha256-` and 64 hex digits. */
export const fingerprintSchema = z.string().regex(/^sha256-[0-9a-f]{64}$/, 'expected sha256- and 64 hex digits');

/** One accepted take. */
export const takeSchema = z
  .object({
    /** The file's path inside the media vault, with `/` separators. */
    file: z.string().min(1),
    /** Fingerprint of the file's contents. */
    fingerprint: fingerprintSchema,
    /** Fingerprint of the script text it was made from. */
    madeFrom: fingerprintSchema,
    /** When it was accepted (ISO 8601). */
    acceptedAt: z.iso.datetime({ offset: true }),
    /** Who accepted it: the Git user name, when known. */
    acceptedBy: z.string().optional(),
  })
  .strict();
export type Take = z.infer<typeof takeSchema>;

/** `producer/takes.json`. */
export const takesFileSchema = z
  .object({
    schema_version: z.literal(PRODUCER_RECORDS_VERSION),
    /** Keyed by shot tag. */
    shots: z.record(z.string(), takeSchema),
    /** Keyed by `<shot-tag>.<n>`, n counting the shot's spoken lines from 1. */
    lines: z.record(z.string(), takeSchema),
    /** Keyed by cue tag. */
    cues: z.record(z.string(), takeSchema),
  })
  .strict();
export type TakesFile = z.infer<typeof takesFileSchema>;

/** Provenance for one accepted file. */
export const provenanceEntrySchema = z
  .object({
    /** The provider plugin id, e.g. `manual`. */
    provider: z.string().min(1),
    model: z.string().optional(),
    plan: z.string().optional(),
    license: z.string().optional(),
    prompt: z.string().optional(),
    /** The file's name when it arrived, e.g. `1x01-wide.png`. */
    originalName: z.string().min(1),
    importedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type ProvenanceEntry = z.infer<typeof provenanceEntrySchema>;

/** `producer/provenance.json`. */
export const provenanceFileSchema = z
  .object({
    schema_version: z.literal(PRODUCER_RECORDS_VERSION),
    /** Keyed by file fingerprint. */
    files: z.record(fingerprintSchema, provenanceEntrySchema),
  })
  .strict();
export type ProvenanceFile = z.infer<typeof provenanceFileSchema>;

/** Outcome of reading a record file. */
export type ReadRecordResult<T> =
  | { ok: true; found: boolean; value: T }
  | { ok: false; reason: 'malformed-json' | 'invalid-schema' | 'newer-version'; message: string };

/** @returns An empty takes file. */
export function emptyTakes(): TakesFile {
  return { schema_version: PRODUCER_RECORDS_VERSION, shots: {}, lines: {}, cues: {} };
}

/** @returns An empty provenance file. */
export function emptyProvenance(): ProvenanceFile {
  return { schema_version: PRODUCER_RECORDS_VERSION, files: {} };
}

/**
 * Read `producer/takes.json`. A missing file reads as empty.
 *
 * @param projectRoot - Absolute path to the project root.
 * @returns The takes, or a described failure. Never throws for a bad file.
 */
export function readTakes(projectRoot: string): Promise<ReadRecordResult<TakesFile>> {
  return readRecord(path.join(projectRoot, TAKES_FILE), takesFileSchema, emptyTakes());
}

/**
 * Read `producer/provenance.json`. A missing file reads as empty.
 *
 * @param projectRoot - Absolute path to the project root.
 * @returns The provenance records, or a described failure. Never throws for a bad file.
 */
export function readProvenance(projectRoot: string): Promise<ReadRecordResult<ProvenanceFile>> {
  return readRecord(path.join(projectRoot, PROVENANCE_FILE), provenanceFileSchema, emptyProvenance());
}

/** Read and validate one record file. */
async function readRecord<T>(filePath: string, schema: z.ZodType<T>, empty: T): Promise<ReadRecordResult<T>> {
  let text: string;
  try {
    text = await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, found: false, value: empty };
    return { ok: false, reason: 'malformed-json', message: errorMessage(err) };
  }
  return parseRecordText(text, schema);
}

/**
 * Parse a record file's text. Exported for writers that need to re-read
 * exactly what's on disk.
 *
 * @param text - The file's contents.
 * @param schema - The record's schema.
 * @returns The parsed value, or a described failure.
 */
export function parseRecordText<T>(text: string, schema: z.ZodType<T>): ReadRecordResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: 'malformed-json', message: `Invalid JSON: ${errorMessage(err)}` };
  }
  const version = z.object({ schema_version: z.number() }).safeParse(json);
  if (version.success && version.data.schema_version > PRODUCER_RECORDS_VERSION) {
    return {
      ok: false,
      reason: 'newer-version',
      message: `schema version ${version.data.schema_version} is newer than the supported ${PRODUCER_RECORDS_VERSION}; update to read it.`,
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid-schema',
      message: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
    };
  }
  return { ok: true, found: true, value: parsed.data };
}

/** Extract a message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
