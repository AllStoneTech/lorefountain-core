/**
 * Tests for `fountain/cueExtensions.ts` and the `cue-extension-parenthetical`
 * shot-map issue: which parentheticals are cue-line extensions written in the
 * wrong place, and which are left alone or reported as ambiguous.
 */

import { describe, expect, it } from 'vitest';
import { splitExtensionParenthetical } from '../src/fountain/cueExtensions';
import { buildShotMap } from '../src/shots/shotMap';

describe('splitExtensionParenthetical', () => {
  it('splits the real Orun forms', () => {
    expect(splitExtensionParenthetical('(V.O., reading)')).toEqual({ kind: 'split', extensions: ['V.O.'], remainder: 'reading' });
    expect(splitExtensionParenthetical('(V.O., FILTERED — not Lucien)')).toEqual({ kind: 'split', extensions: ['V.O.', 'FILTERED'], remainder: 'not Lucien' });
    expect(splitExtensionParenthetical('(V.O., FILTERED — ancient, unplaceable)')).toEqual({
      kind: 'split',
      extensions: ['V.O.', 'FILTERED'],
      remainder: 'ancient, unplaceable',
    });
    expect(splitExtensionParenthetical('(V.O., precise, an academic register with a St. Lucian cadence underneath it)')).toEqual({
      kind: 'split',
      extensions: ['V.O.'],
      remainder: 'precise, an academic register with a St. Lucian cadence underneath it',
    });
  });

  it('removes nothing but extensions: a parenthetical of only extensions has an empty remainder', () => {
    expect(splitExtensionParenthetical('(V.O.)')).toEqual({ kind: 'split', extensions: ['V.O.'], remainder: '' });
    expect(splitExtensionParenthetical('(V.O., FILTERED)')).toEqual({ kind: 'split', extensions: ['V.O.', 'FILTERED'], remainder: '' });
    expect(splitExtensionParenthetical('(O.S. FILTERED)')).toEqual({ kind: 'split', extensions: ['O.S.', 'FILTERED'], remainder: '' });
  });

  it('accepts en dashes, semicolons and spaced hyphens as separators, and drops repeated tokens', () => {
    expect(splitExtensionParenthetical('(O.S.; muffled)')).toEqual({ kind: 'split', extensions: ['O.S.'], remainder: 'muffled' });
    expect(splitExtensionParenthetical('(O.C. – whispering)')).toEqual({ kind: 'split', extensions: ['O.C.'], remainder: 'whispering' });
    expect(splitExtensionParenthetical('(V.O. - low)')).toEqual({ kind: 'split', extensions: ['V.O.'], remainder: 'low' });
    expect(splitExtensionParenthetical('(V.O., V.O., low)')).toEqual({ kind: 'split', extensions: ['V.O.'], remainder: 'low' });
  });

  it('leaves ordinary parentheticals and lowercase look-alikes alone', () => {
    expect(splitExtensionParenthetical('(beat)')).toBeUndefined();
    expect(splitExtensionParenthetical('(filtered through glass)')).toBeUndefined();
    expect(splitExtensionParenthetical('(reading, V.O.)')).toBeUndefined();
    expect(splitExtensionParenthetical('(V.O.s)')).toBeUndefined();
    expect(splitExtensionParenthetical('not a parenthetical')).toBeUndefined();
  });

  it('reports ambiguous shapes instead of guessing', () => {
    expect(splitExtensionParenthetical('(V.O. reading aloud)')).toMatchObject({ kind: 'ambiguous' });
    expect(splitExtensionParenthetical('(V.O., (quietly) reading)')).toMatchObject({ kind: 'ambiguous' });
  });
});

describe('buildShotMap cue-extension-parenthetical issue', () => {
  const script = ['INT. ROOM - DAY', '', 'THE ARCHIVE', '(V.O., reading)', 'Hello.', '', 'MARA', '(beat)', 'Fine.', ''].join('\n');

  it('warns only on an extension parenthetical directly under a cue', () => {
    const issues = buildShotMap(script, []).issues.filter((i) => i.code === 'cue-extension-parenthetical');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'warning', line: 3 });
    expect(issues[0].message).toContain('"(reading)"');
  });

  it('does not warn when the parenthetical is further into the speech', () => {
    const later = ['INT. ROOM - DAY', '', 'THE ARCHIVE', 'First line.', '(V.O., reading)', 'Second.', ''].join('\n');
    expect(buildShotMap(later, []).issues.filter((i) => i.code === 'cue-extension-parenthetical')).toHaveLength(0);
  });

  it('reports an ambiguous one as needing a manual move', () => {
    const ambiguous = ['INT. ROOM - DAY', '', 'THE ARCHIVE', '(V.O. reading aloud)', 'Hello.', ''].join('\n');
    const issue = buildShotMap(ambiguous, []).issues.find((i) => i.code === 'cue-extension-parenthetical');
    expect(issue?.message).toContain('by hand');
  });
});
