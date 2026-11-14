/**
 * Tests for `shots/tagShots.ts` and the `untagged-shot` / `untagged-implicit-shot`
 * shot-map issues: generated tags are IDs, never overwrite or duplicate, and the
 * plan is idempotent.
 */

import { describe, expect, it } from 'vitest';
import { applyShotTags, planShotTags } from '../src/shots/tagShots';
import { buildShotMap } from '../src/shots/shotMap';

const script = [
  'INT. ROOM - DAY',
  '',
  'SHOT: WIDE, the room',
  '',
  'Mara enters.',
  '',
  'SHOT: CLOSE on MARA',
  '',
  'INT. HALL - NIGHT',
  '',
  'SHOT: [hall-wide] WIDE',
  '',
  'SHOT: INSERT',
  '',
].join('\n');

describe('planShotTags', () => {
  it('tags each untagged shot from production code, scene and shot', () => {
    const plan = planShotTags(script, '1x03');
    expect(plan.edits.map((e) => e.tag)).toEqual(['1x03-01-01', '1x03-01-02', '1x03-02-02']);
    expect(applyShotTags(script, plan)).toContain('SHOT: [1x03-01-01] WIDE, the room');
    expect(applyShotTags(script, plan)).toContain('SHOT: [hall-wide] WIDE');
  });

  it('changes nothing but the inserted tags', () => {
    const result = applyShotTags(script, planShotTags(script, '1x03'));
    expect(result.replace(/\[1x03-\d\d-\d\d\] /g, '')).toBe(script);
  });

  it('is idempotent: a second run plans nothing', () => {
    const once = applyShotTags(script, planShotTags(script, '1x03'));
    expect(planShotTags(once, '1x03').edits).toEqual([]);
    expect(applyShotTags(once, planShotTags(once, '1x03'))).toBe(once);
  });

  it('never renumbers: a shot inserted later gets a free number, existing tags stay', () => {
    const tagged = applyShotTags(script, planShotTags(script, '1x03'));
    const inserted = tagged.replace('SHOT: [1x03-01-02] CLOSE on MARA', 'SHOT: OVER THE SHOULDER\n\nSHOT: [1x03-01-02] CLOSE on MARA');
    const plan = planShotTags(inserted, '1x03');
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0].tag).toBe('1x03-01-03');
    expect(applyShotTags(inserted, plan)).toContain('SHOT: [1x03-01-02] CLOSE on MARA');
  });

  it('never duplicates within the script or a reserved tag', () => {
    const plan = planShotTags('INT. A - DAY\n\nSHOT: ONE\n\nSHOT: TWO\n', '1x03', new Set(['1x03-01-01']));
    expect(plan.edits.map((e) => e.tag)).toEqual(['1x03-01-02', '1x03-01-03']);
    expect(new Set(plan.edits.map((e) => e.tag)).size).toBe(plan.edits.length);
  });

  it('writes valid tag shapes', () => {
    for (const edit of planShotTags(script, '1x03').edits) expect(edit.tag).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('skips and reports every shot when there is no usable prefix', () => {
    const plan = planShotTags(script, undefined);
    expect(plan.edits).toEqual([]);
    expect(plan.skipped).toHaveLength(3);
  });

  it('handles forced, indented and empty SHOT: lines and CRLF files exactly', () => {
    const text = 'INT. A - DAY\r\n\r\n!SHOT: WIDE\r\n\r\n  SHOT:\r\n';
    const result = applyShotTags(text, planShotTags(text, 'ep1'));
    expect(result).toBe('INT. A - DAY\r\n\r\n!SHOT: [ep1-01-01] WIDE\r\n\r\n  SHOT: [ep1-01-02]\r\n');
  });

  it('leaves mixed line endings untouched', () => {
    const text = 'INT. A - DAY\n\r\nSHOT: WIDE\r\nAction.\n';
    expect(applyShotTags(text, planShotTags(text, 'ep1'))).toBe('INT. A - DAY\n\r\nSHOT: [ep1-01-01] WIDE\r\nAction.\n');
  });
});

describe('buildShotMap untagged-shot issues', () => {
  it('warns on each untagged SHOT: line and not on tagged ones', () => {
    const issues = buildShotMap(script, []).issues.filter((i) => i.code === 'untagged-shot');
    expect(issues.map((i) => i.line)).toEqual([2, 6, 12]);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('warns about a scene with content before its first SHOT:', () => {
    const text = 'INT. A - DAY\n\nMara waits.\n\nSHOT: [a-wide] WIDE\n';
    const issue = buildShotMap(text, []).issues.find((i) => i.code === 'untagged-implicit-shot');
    expect(issue).toMatchObject({ severity: 'warning', line: 0 });
  });

  it('warns about a scene with no SHOT: at all, but only in a script that uses shots', () => {
    const withShots = 'INT. A - DAY\n\nSHOT: [a-wide] WIDE\n\nINT. B - DAY\n\nMara waits.\n';
    const issue = buildShotMap(withShots, []).issues.find((i) => i.code === 'untagged-implicit-shot');
    expect(issue?.message).toContain('has no SHOT: line');
    const noShots = 'INT. A - DAY\n\nMara waits.\n';
    expect(buildShotMap(noShots, []).issues.some((i) => i.code === 'untagged-implicit-shot')).toBe(false);
  });

  it('does not warn about a scene whose first line is a SHOT:', () => {
    const text = 'INT. A - DAY\n\nSHOT: [a-wide] WIDE\n\nMara waits.\n';
    expect(buildShotMap(text, []).issues.some((i) => i.code.startsWith('untagged'))).toBe(false);
  });
});
