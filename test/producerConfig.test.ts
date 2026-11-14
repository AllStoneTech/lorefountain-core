/**
 * Unit tests for `producer/config.ts`: the `producer.json` schema and reader.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { producerConfigSchema, readProducerConfig } from '../src/producer/config';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lorefountain-producer-config-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Write `producer.json` with `value` serialized, or raw text. */
function write(value: unknown): void {
  writeFileSync(join(root, 'producer.json'), typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

const FULL = {
  schema_version: 1,
  project: { commercial: true, profile: 'short-dialogue' },
  sources: { voice: { source: 'generated', provider: 'elevenlabs', fallback: ['manual'] }, stills: { source: 'provided' } },
  overrides: { '1x01-wide': { stills: { source: 'generated', provider: 'manual' } } },
  takePolicy: { default: 'pick', byType: { sfx: 'auto' } },
  vault: { path: 'D:/vault/signal', keepRejectedDays: 14 },
  output: { formats: ['16:9', '9:16'], loudness: { video: -16, podcast: -19 } },
  casting: { mara: { provider: 'elevenlabs', voice: 'abc123', style: 'warm, tired' } },
  textStyles: { chyron: { font: 'Inter', position: 'lower-third' } },
  lockedReferences: { mara: ['sha256-aaaa'] },
  shots: { '1x01-wide': { audioOffset: -0.08, trims: { start: 0.5 }, holdAfter: 1, focus: 'left' } },
  coverage: { '1x01-wide': [{ tag: '1x01-wide.c1', description: 'INSERT, her hands', start: 2, end: 5 }] },
};

describe('producerConfigSchema', () => {
  it('accepts a full config and a minimal one', () => {
    expect(producerConfigSchema.safeParse(FULL).success).toBe(true);
    expect(producerConfigSchema.safeParse({ schema_version: 1 }).success).toBe(true);
  });

  it('accepts a production type with outputs, a budget, and a treatment per shot', () => {
    const config = {
      schema_version: 1,
      production: { type: 'narrated_series', outputs: ['video-16x9', 'podcast'] },
      budget: { maxJobsPerRun: 5, maxCostPerRun: 2, maxCostTotal: 50 },
      shots: { a: { treatment: 'animated' }, b: { treatment: 'still', motion: 'ken-burns-in' }, c: { treatment: 'card' } },
    };
    expect(producerConfigSchema.safeParse(config).success).toBe(true);
  });

  it('rejects an unknown production type, output or treatment, and a non-positive job cap', () => {
    const bad = [
      { production: { type: 'feature_film' } },
      { production: { type: 'audio_drama', outputs: ['vhs'] } },
      { production: { type: 'audio_drama', outputs: [] } },
      { shots: { a: { treatment: 'rotoscope' } } },
      { budget: { maxJobsPerRun: 0 } },
      { budget: { maxCostPerRun: -1 } },
    ];
    for (const extra of bad) expect(producerConfigSchema.safeParse({ schema_version: 1, ...extra }).success, JSON.stringify(extra)).toBe(false);
  });

  it('rejects unknown keys, so typos are caught', () => {
    expect(producerConfigSchema.safeParse({ schema_version: 1, castng: {} }).success).toBe(false);
    expect(producerConfigSchema.safeParse({ schema_version: 1, shots: { a: { audio_offset: 1 } } }).success).toBe(false);
  });

  it('rejects bad values: an unknown asset type, take policy or focus, and coverage that ends before it starts', () => {
    expect(producerConfigSchema.safeParse({ schema_version: 1, sources: { video: { source: 'provided' } } }).success).toBe(false);
    expect(producerConfigSchema.safeParse({ schema_version: 1, takePolicy: { default: 'sometimes' } }).success).toBe(false);
    expect(producerConfigSchema.safeParse({ schema_version: 1, shots: { a: { focus: 'up' } } }).success).toBe(false);
    expect(
      producerConfigSchema.safeParse({ schema_version: 1, coverage: { a: [{ tag: 'a.c1', description: '', start: 5, end: 2 }] } }).success,
    ).toBe(false);
  });

  it('requires schema_version 1', () => {
    expect(producerConfigSchema.safeParse({}).success).toBe(false);
  });
});

describe('readProducerConfig', () => {
  it('reports a missing file as not found, not an error', async () => {
    expect(await readProducerConfig(root)).toEqual({ ok: true, found: false });
  });

  it('reads a valid file', async () => {
    write(FULL);
    const result = await readProducerConfig(root);
    expect(result).toMatchObject({ ok: true, found: true });
    if (result.ok && result.found) expect(result.config.casting?.mara.voice).toBe('abc123');
  });

  it('reports malformed JSON and schema violations without throwing', async () => {
    write('{ nope');
    expect(await readProducerConfig(root)).toMatchObject({ ok: false, reason: 'malformed-json' });
    write({ schema_version: 1, takePolicy: { default: 'never' } });
    const result = await readProducerConfig(root);
    expect(result).toMatchObject({ ok: false, reason: 'invalid-schema' });
    if (!result.ok) expect(result.message).toContain('takePolicy.default');
  });

  it('reports a newer schema version before parsing its fields', async () => {
    write({ schema_version: 2, somethingNew: true });
    expect(await readProducerConfig(root)).toMatchObject({ ok: false, reason: 'newer-version' });
  });
});
