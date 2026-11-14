/**
 * Unit tests for `producer/records.ts` and `producer/fingerprint.ts`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractCues } from '../src/cues/parseCues';
import { cueSourceText, fingerprintText, lineSourceText, shotSourceText, spokenLinesOf } from '../src/producer/fingerprint';
import { readProvenance, readTakes } from '../src/producer/records';
import { buildShotMap } from '../src/shots/shotMap';

const HASH = `sha256-${'a'.repeat(64)}`;
const TAKE = { file: 'sha256/aa/aaaa.png', fingerprint: HASH, madeFrom: HASH, acceptedAt: '2026-11-06T12:00:00Z' };

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lorefountain-records-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Write a record file under `producer/`. */
function put(name: string, value: unknown): void {
  mkdirSync(join(root, 'producer'), { recursive: true });
  writeFileSync(join(root, 'producer', name), typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

describe('readTakes', () => {
  it('reads a missing file as empty', async () => {
    expect(await readTakes(root)).toEqual({ ok: true, found: false, value: { schema_version: 1, shots: {}, lines: {}, cues: {} } });
  });

  it('reads valid takes', async () => {
    put('takes.json', { schema_version: 1, shots: { 'a-wide': TAKE }, lines: { 'a-wide.1': { ...TAKE, acceptedBy: 'Louis' } }, cues: {} });
    const result = await readTakes(root);
    expect(result.ok && result.value.lines['a-wide.1'].acceptedBy).toBe('Louis');
  });

  it('reads references when present and accepts files written before they existed', async () => {
    put('takes.json', { schema_version: 1, shots: {}, lines: {}, cues: {}, references: { 'mara:1': TAKE, 'mara:1:storm-gear': TAKE } });
    const result = await readTakes(root);
    expect(result.ok && Object.keys(result.value.references ?? {})).toEqual(['mara:1', 'mara:1:storm-gear']);
    put('takes.json', { schema_version: 1, shots: {}, lines: {}, cues: {} });
    expect(await readTakes(root)).toMatchObject({ ok: true, found: true });
  });

  it('rejects a bad fingerprint, a bad date and unknown keys, and reports newer versions unparsed', async () => {
    put('takes.json', { schema_version: 1, shots: { a: { ...TAKE, fingerprint: 'md5-x' } }, lines: {}, cues: {} });
    expect(await readTakes(root)).toMatchObject({ ok: false, reason: 'invalid-schema' });
    put('takes.json', { schema_version: 1, shots: { a: { ...TAKE, acceptedAt: 'yesterday' } }, lines: {}, cues: {} });
    expect(await readTakes(root)).toMatchObject({ ok: false, reason: 'invalid-schema' });
    put('takes.json', { schema_version: 1, shots: {}, lines: {}, cues: {}, extra: 1 });
    expect(await readTakes(root)).toMatchObject({ ok: false, reason: 'invalid-schema' });
    put('takes.json', { schema_version: 3 });
    expect(await readTakes(root)).toMatchObject({ ok: false, reason: 'newer-version' });
    put('takes.json', '{');
    expect(await readTakes(root)).toMatchObject({ ok: false, reason: 'malformed-json' });
  });
});

describe('readProvenance', () => {
  it('reads provenance keyed by fingerprint', async () => {
    put('provenance.json', { schema_version: 1, files: { [HASH]: { provider: 'manual', originalName: 'a-wide.png', importedAt: '2026-11-06T12:00:00Z' } } });
    const result = await readProvenance(root);
    expect(result.ok && result.value.files[HASH].provider).toBe('manual');
  });

  it('rejects a key that is not a fingerprint', async () => {
    put('provenance.json', { schema_version: 1, files: { 'a-wide.png': { provider: 'manual', originalName: 'a', importedAt: '2026-11-06T12:00:00Z' } } });
    expect(await readProvenance(root)).toMatchObject({ ok: false, reason: 'invalid-schema' });
  });
});

describe('fingerprints', () => {
  const SCRIPT = 'INT. A - DAY\n\nSHOT: [s] WIDE\nPOSE: Mara stands\n\nRain falls.\n\nMARA\n(quietly)\nHello\nthere.\n(beat)\nGo.\n';

  it('fingerprints text as sha256 hex', () => {
    expect(fingerprintText('')).toBe('sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('numbers spoken lines and attaches the directions written before each, but not pauses', () => {
    const [shot] = buildShotMap(SCRIPT, []).shots;
    expect(spokenLinesOf(shot).map((spoken) => [spoken.index, spoken.line.text, spoken.directions])).toEqual([
      [1, 'Hello there.', ['(quietly)']],
      [2, 'Go.', []],
    ]);
  });

  it('changes a shot\'s fingerprint when its picture text changes, not when its dialogue does', () => {
    const before = fingerprintText(shotSourceText(buildShotMap(SCRIPT, []).shots[0]));
    const dialogueEdited = fingerprintText(shotSourceText(buildShotMap(SCRIPT.replace('Go.', 'Leave.'), []).shots[0]));
    const actionEdited = fingerprintText(shotSourceText(buildShotMap(SCRIPT.replace('Rain falls.', 'Snow falls.'), []).shots[0]));
    expect(dialogueEdited).toBe(before);
    expect(actionEdited).not.toBe(before);
  });

  it('fingerprints a cue from its type, role, timing and description', () => {
    const [sting, bed] = extractCues('MUSIC: [theme] STING - cut hard\n\nMUSIC: [theme] BED IN - cut hard\n');
    expect(cueSourceText(sting)).toBe('music\nSTING\n\ncut hard');
    expect(fingerprintText(cueSourceText(sting))).not.toBe(fingerprintText(cueSourceText(bed)));
  });

  it('changes a line\'s fingerprint when its words or directions change, not when it is re-wrapped', () => {
    const fp = (script: string): string => fingerprintText(lineSourceText(spokenLinesOf(buildShotMap(script, []).shots[0])[0]));
    const before = fp(SCRIPT);
    expect(fp(SCRIPT.replace('Hello\nthere.', 'Hello there.'))).toBe(before);
    expect(fp(SCRIPT.replace('(quietly)', '(loudly)'))).not.toBe(before);
    expect(fp(SCRIPT.replace('there.', 'you.'))).not.toBe(before);
  });
});
