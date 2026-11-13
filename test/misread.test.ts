/**
 * Unit tests for `fountain/misread.ts`: convention lines standard Fountain
 * reads as a character cue (Core ADR-0005). Each "is misread" case is checked
 * against `fountain-js` itself, so the check can't drift from the parser.
 */

import { describe, expect, it } from 'vitest';
import { parseFountain } from '../src/fountain/parse';
import { findMisreadConventionLines } from '../src/fountain/misread';

const lines = (...parts: string[]): string => parts.join('\n');

/** True when `fountain-js` reads `cue` (trimmed) as a character cue somewhere in `script`. */
function parsesAsCue(script: string, cue: string): boolean {
  return parseFountain(script).some((token) => token.type === 'character' && token.text?.trim() === cue);
}

describe('findMisreadConventionLines', () => {
  it('finds an all-caps convention line with a blank line above and text directly under it', () => {
    const script = lines('INT. A - DAY', '', 'SHOT: CLOSE-UP', 'POSE: SANGO KNEELS', '', 'She waits.');
    expect(findMisreadConventionLines(script)).toEqual([{ line: 2, text: 'SHOT: CLOSE-UP' }]);
    expect(parsesAsCue(script, 'SHOT: CLOSE-UP')).toBe(true);
  });

  it('finds one at the very start of a script with no title page', () => {
    const script = lines('SHOT: WIDE', 'POSE: X', '', 'Text.');
    expect(findMisreadConventionLines(script)).toEqual([{ line: 0, text: 'SHOT: WIDE' }]);
    expect(parsesAsCue(script, 'SHOT: WIDE')).toBe(true);
  });

  it('skips a title page that opens with a standard key, but checks the body after it', () => {
    const script = lines('Title: A', 'Production Code: 1x01', '', 'SFX: BOOM', 'MARA', '', 'Text.');
    expect(findMisreadConventionLines(script)).toEqual([{ line: 3, text: 'SFX: BOOM' }]);
    expect(parsesAsCue(script, 'SFX: BOOM')).toBe(true);
  });

  it('never reports a forced line, which every Fountain app reads as action', () => {
    const script = lines('INT. A - DAY', '', '!SHOT: CLOSE-UP', '!POSE: SANGO KNEELS', '', 'Text.');
    expect(findMisreadConventionLines(script)).toEqual([]);
    expect(parsesAsCue(script, 'SHOT: CLOSE-UP')).toBe(false);
  });

  it.each([
    ['a lowercase word in the line', lines('INT. A - DAY', '', 'SHOT: WIDE on the dock', 'POSE: X', '')],
    ['a blank line after it', lines('INT. A - DAY', '', 'SHOT: CLOSE-UP', '', 'POSE: X')],
    ['no blank line above it', lines('INT. A - DAY', '', 'Rain.', 'SHOT: CLOSE-UP', 'POSE: X')],
    ['nothing after it', lines('INT. A - DAY', '', 'SHOT: CLOSE-UP')],
    ['a boneyard around it', lines('INT. A - DAY', '', '/*', 'SHOT: CLOSE-UP', 'POSE: X', '*/')],
  ])('does not report a line with %s', (_label, script) => {
    expect(findMisreadConventionLines(script)).toEqual([]);
  });

  it('treats a boneyard right above the line as blank space', () => {
    const script = lines('Rain.', '/* cut */', 'SHOT: CLOSE-UP', 'POSE: X');
    expect(findMisreadConventionLines(script)).toEqual([{ line: 2, text: 'SHOT: CLOSE-UP' }]);
  });

  it('checks comic keywords only when asked', () => {
    const script = lines('INT. A - DAY', '', 'PAGE: 7', 'PANEL: Wide shot.', '');
    expect(findMisreadConventionLines(script)).toEqual([]);
    expect(findMisreadConventionLines(script, { comic: true })).toEqual([{ line: 2, text: 'PAGE: 7' }]);
  });

  it('starts at fromLine when given', () => {
    const script = lines('SHOT: WIDE', 'POSE: X', '', 'SHOT: CLOSE', 'POSE: Y');
    expect(findMisreadConventionLines(script, { fromLine: 1 }).map((found) => found.line)).toEqual([3]);
  });

  it('handles Windows line endings', () => {
    const script = 'INT. A - DAY\r\n\r\nSHOT: CLOSE-UP\r\nPOSE: X\r\n';
    expect(findMisreadConventionLines(script)).toEqual([{ line: 2, text: 'SHOT: CLOSE-UP' }]);
  });
});
