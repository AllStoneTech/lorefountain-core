/**
 * Unit tests for `LOOK: CHARACTER label` lines: parsing and carry-over in
 * the shot map (`shots/shotMap.ts`), the check against `characters.json`
 * (`shots/looks.ts`) and the per-script breakdown (`shots/breakdown.ts`).
 */

import { describe, expect, it } from 'vitest';
import { extractCues } from '../src/cues/parseCues';
import { matchPrefixLine } from '../src/fountain/conventions';
import { buildBreakdown, breakdownPathFor } from '../src/shots/breakdown';
import { findLookIssues } from '../src/shots/looks';
import { buildShotMap, parseLookText, type ShotMapEntity } from '../src/shots/shotMap';

const ENTITIES: ShotMapEntity[] = [
  { id: 'mara', type: 'character', names: ['Mara', 'Mara Vale'] },
  { id: 'ada-okafor', type: 'character', names: ['Dr. Ada Okafor', 'Ada'] },
  { id: 'the-key', type: 'object', names: ['the Key'] },
  { id: 'hollow-house', type: 'location', names: ['Hollow House'] },
];

const lines = (...parts: string[]): string => parts.join('\n');

describe('LOOK: as a convention line', () => {
  it('is a prefix line, forced or not', () => {
    expect(matchPrefixLine('LOOK: MARA school uniform')).toEqual({ keyword: 'LOOK', rest: 'MARA school uniform', forced: false });
    expect(matchPrefixLine('!LOOK: MARA x')?.forced).toBe(true);
  });
});

describe('parseLookText', () => {
  it('takes the longest matching name or alias, then the label', () => {
    expect(parseLookText('MARA VALE school uniform', ENTITIES)).toEqual({ characterEntity: 'mara', character: 'Mara Vale', label: 'school uniform' });
    expect(parseLookText('mara school uniform', ENTITIES)).toEqual({ characterEntity: 'mara', character: 'Mara', label: 'school uniform' });
    expect(parseLookText('DR. ADA OKAFOR lab coat', ENTITIES)).toEqual({ characterEntity: 'ada-okafor', character: 'Dr. Ada Okafor', label: 'lab coat' });
  });

  it('drops a separator before the label, and accepts a name with no label', () => {
    expect(parseLookText('Mara - rain coat', ENTITIES)?.label).toBe('rain coat');
    expect(parseLookText('Mara — rain coat', ENTITIES)?.label).toBe('rain coat');
    expect(parseLookText('Mara: rain coat', ENTITIES)?.label).toBe('rain coat');
    expect(parseLookText('Mara', ENTITIES)?.label).toBe('');
  });

  it('matches whole words only, and only characters', () => {
    expect(parseLookText('Marathon runner kit', ENTITIES)).toBeUndefined();
    expect(parseLookText('the Key rusted', ENTITIES)).toBeUndefined();
    expect(parseLookText('Nobody uniform', ENTITIES)).toBeUndefined();
  });
});

describe('LOOK: lines in the shot map', () => {
  const script = lines(
    'INT. HOLLOW HOUSE - NIGHT', // 0
    '', // 1
    'SHOT: [a] WIDE', // 2
    '', // 3
    'LOOK: MARA school uniform', // 4
    '', // 5
    'Mara waits.', // 6
    '', // 7
    'SHOT: [b] CLOSE', // 8
    '', // 9
    'Nothing changes.', // 10
    '', // 11
    'INT. HOLLOW HOUSE - DAY', // 12
    '', // 13
    'SHOT: [c] WIDE', // 14
    '', // 15
    'LOOK: Mara rain coat', // 16
    'LOOK: Ada lab coat', // 17
  );

  it('records the lines written in each shot, and carries each look forward across shots and scenes', () => {
    const { shots, issues } = buildShotMap(script, ENTITIES);
    expect(issues.filter((issue) => issue.code.startsWith('look-'))).toEqual([]);
    expect(shots[0].looks).toEqual([{ character: 'Mara', characterEntity: 'mara', look: 'school uniform', line: 4 }]);
    expect(shots[0].activeLooks).toEqual([{ characterEntity: 'mara', look: 'school uniform' }]);
    expect(shots[1].looks).toBeUndefined();
    expect(shots[1].activeLooks).toEqual([{ characterEntity: 'mara', look: 'school uniform' }]);
    expect(shots[2].looks?.map((look) => [look.characterEntity, look.look])).toEqual([['mara', 'rain coat'], ['ada-okafor', 'lab coat']]);
    expect(shots[2].activeLooks).toEqual([
      { characterEntity: 'mara', look: 'rain coat' },
      { characterEntity: 'ada-okafor', look: 'lab coat' },
    ]);
  });

  it('keeps a LOOK: line out of the action, and adds neither field to a script without one', () => {
    const { shots } = buildShotMap(script, ENTITIES);
    expect(shots[0].action).toEqual([{ text: 'Mara waits.', line: 6 }]);
    const plain = buildShotMap('INT. A - DAY\n\nSHOT: WIDE\n\nMara waits.\n', ENTITIES).shots[0];
    expect('looks' in plain).toBe(false);
    expect('activeLooks' in plain).toBe(false);
  });

  it('reads a LOOK: line that Fountain misreads as a character cue', () => {
    const { shots, issues } = buildShotMap('INT. A - DAY\n\nSHOT: WIDE\n\nLOOK: MARA SCHOOL UNIFORM\nMara waits.\n', ENTITIES);
    expect(shots[0].looks?.[0]).toMatchObject({ characterEntity: 'mara', look: 'SCHOOL UNIFORM' });
    expect(shots[0].spoken).toEqual([]);
    expect(issues.map((issue) => issue.code)).toContain('misread-as-character');
  });

  it('warns for an unknown character or a missing label, and changes nothing', () => {
    const { shots, issues } = buildShotMap('INT. A - DAY\n\nSHOT: [a] WIDE\n\nLOOK: Nobody coat\n\nLOOK: Mara\n', ENTITIES);
    expect(issues.map((issue) => [issue.code, issue.severity, issue.line])).toEqual([
      ['look-unknown-character', 'warning', 4],
      ['look-missing-label', 'warning', 6],
    ]);
    expect(shots[0].looks).toBeUndefined();
    expect(shots[0].activeLooks).toBeUndefined();
  });
});

describe('findLookIssues', () => {
  const script = 'INT. A - DAY\n\nSHOT: WIDE\n\nLOOK: Mara School  Uniform\n\nLOOK: Ada lab coat\n\nLOOK: Mara tuxedo\n';
  const { shots } = buildShotMap(script, ENTITIES);
  const manifest = { mara: { versions: [{ version: 1, file: 'a.png' }], looks: [{ label: 'school uniform', file: 'u.png' }, { label: 'rain coat', file: 'r.png' }] } };

  it('reports a label that is not one of the character\'s looks, listing the ones that exist', () => {
    const issues = findLookIssues(shots, manifest);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'unknown-look', severity: 'warning', line: 8 });
    expect(issues[0].message).toContain('"school uniform", "rain coat"');
  });

  it('compares case-insensitively with whitespace collapsed, and skips a character with no looks listed', () => {
    expect(findLookIssues(shots, manifest).some((issue) => issue.line === 4)).toBe(false);
    expect(findLookIssues(shots, manifest).some((issue) => issue.line === 6)).toBe(false);
    expect(findLookIssues(shots, {})).toEqual([]);
  });
});

describe('buildBreakdown', () => {
  const script = lines(
    'INT. HOLLOW HOUSE - NIGHT', // 0
    '', // 1
    'SHOT: [a] WIDE', // 2
    '', // 3
    'LOOK: MARA school uniform', // 4
    '', // 5
    'AMB: [drip] water dripping', // 6
    '', // 7
    'MARA', // 8
    'Where is the Key?', // 9
    '', // 10
    'The Key glints on the table.', // 11
    '', // 12
    'SUPER: [place] Hollow House, 1894', // 13
    '', // 14
    'INT. ELSEWHERE - DAY', // 15
    '', // 16
    'SHOT: WIDE', // 17
    '', // 18
    'Nobody here.', // 19
    '', // 20
    'LOOK: Mara rain coat', // 21
  );
  const shotMap = buildShotMap(script, ENTITIES);
  const breakdown = buildBreakdown(shotMap, ENTITIES, extractCues(script));

  it('lists each scene\'s cast with looks, locations, props, sounds and on-screen text', () => {
    expect(breakdown.scenes).toHaveLength(2);
    expect(breakdown.scenes[0]).toEqual({
      scene: 1,
      sceneHeading: 'INT. HOLLOW HOUSE - NIGHT',
      shots: ['a'],
      cast: [{ entity: 'mara', looks: ['school uniform'] }],
      locations: ['hollow-house'],
      props: ['the-key'],
      sounds: [{ type: 'amb', tag: 'drip', description: 'water dripping', line: 6 }],
      onScreen: [{ kind: 'super', tag: 'place', text: 'Hollow House, 1894', line: 13 }],
    });
  });

  it('carries a look into a later scene only for a character who appears there', () => {
    const second = breakdown.scenes[1];
    expect(second.shots).toEqual(['2.1']);
    // Mara is not named in the second scene's text until her LOOK: line, but she starts it in the school uniform.
    expect(second.cast).toEqual([{ entity: 'mara', looks: ['school uniform', 'rain coat'] }]);
    expect(second.sounds).toEqual([]);
  });

  it('names the sidecar beside the script', () => {
    expect(breakdownPathFor('scripts/1x01.fountain')).toBe('scripts/1x01.breakdown.json');
    expect(breakdownPathFor('C:\\p\\1x01.FOUNTAIN')).toBe('C:\\p\\1x01.breakdown.json');
  });
});
