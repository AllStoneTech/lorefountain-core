/**
 * Unit tests for `export/layout.ts` (Core ADR-0003, section 5): screenplay
 * pagination on the monospaced grid.
 */

import { describe, expect, it } from 'vitest';
import { displayWidth, layoutScreenplay, wrapRuns, type LayoutPage } from '../src/export/layout';
import { buildScreenplay, plainText } from '../src/export/screenplay';

/** Lay out Fountain text on Letter paper. */
const layout = (text: string, options: { titlePage?: boolean; sceneNumbers?: boolean; paper?: 'letter' | 'a4' } = {}): LayoutPage[] =>
  layoutScreenplay(buildScreenplay(text), { paper: options.paper ?? 'letter', ...options }).pages;

/** A page's lines as `row:col:text`, page number included. */
const rows = (page: LayoutPage): string[] => page.lines.map((line) => `${line.row}:${line.col}:${plainText(line.runs)}`);

/** Text of a page's lines, in order. */
const texts = (page: LayoutPage): string[] => page.lines.map((line) => plainText(line.runs));

describe('displayWidth and wrapRuns', () => {
  it('counts characters, not combining marks', () => {
    expect(displayWidth('Ọ̀rúnmìlà')).toBe(8);
    expect(displayWidth('Ọ̀run')).toBe(4);
  });

  it('wraps on words and keeps styles across the break', () => {
    expect(wrapRuns([{ text: 'one two ' }, { text: 'three four', bold: true }], 9)).toEqual([
      [{ text: 'one two' }],
      [{ text: 'three', bold: true }],
      [{ text: 'four', bold: true }],
    ]);
  });

  it('breaks a word longer than the width, and returns one empty line for nothing', () => {
    expect(wrapRuns([{ text: 'abcdefghij' }], 4).map((line) => plainText(line))).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapRuns([], 10)).toEqual([[]]);
  });
});

describe('layoutScreenplay', () => {
  it('places elements in the industry columns with one blank row between them', () => {
    const [page] = layout('INT. A - DAY\n\nRain.\n\nMARA\n(quietly)\nHello.\n\nCUT TO:\n');
    expect(rows(page)).toEqual(['6:15:INT. A - DAY', '8:15:Rain.', '10:37:MARA', '11:31:(quietly)', '12:25:Hello.', '14:68:CUT TO:']);
  });

  it('uses the Letter and A4 page sizes', () => {
    expect(layoutScreenplay(buildScreenplay('x\n'), { paper: 'letter' }).geometry).toMatchObject({ widthPt: 612, heightPt: 792, colPt: 7.2, rowPt: 12 });
    expect(layoutScreenplay(buildScreenplay('x\n'), { paper: 'a4' }).geometry).toMatchObject({ widthPt: 595.28, heightPt: 841.89 });
  });

  it('wraps dialogue at 35 characters and action at 60', () => {
    const words = 'word '.repeat(30).trim();
    const [page] = layout(`${words}\n\nMARA\n${words}\n`);
    const action = page.lines.filter((line) => line.col === 15).map((line) => displayWidth(plainText(line.runs)));
    const dialogue = page.lines.filter((line) => line.col === 25).map((line) => displayWidth(plainText(line.runs)));
    expect(Math.max(...action)).toBeLessThanOrEqual(60);
    expect(Math.max(...dialogue)).toBeLessThanOrEqual(35);
    expect(dialogue.length).toBeGreaterThan(action.length);
  });

  it('prints scene numbers in both margins on the heading row, or not at all', () => {
    expect(rows(layout('INT. A - DAY #12#\n\nRain.\n')[0])).toEqual(['6:15:INT. A - DAY', '6:11:12', '6:77:12', '8:15:Rain.']);
    expect(rows(layout('INT. A - DAY #12#\n\nRain.\n', { sceneNumbers: false })[0])).toEqual(['6:15:INT. A - DAY', '8:15:Rain.']);
  });

  it('numbers pages from 2, top right', () => {
    const pages = layout(Array.from({ length: 40 }, (_, index) => `Line ${index}.`).join('\n\n'));
    expect(pages.length).toBeGreaterThan(1);
    expect(texts(pages[0])).not.toContain('1.');
    expect(rows(pages[1])[0]).toBe('3:73:2.');
  });

  it('fits 54 rows on a Letter page and more on A4', () => {
    const script = Array.from({ length: 200 }, (_, index) => `Line ${index}.`).join('\n');
    const letter = layout(script);
    const a4 = layout(script, { paper: 'a4' });
    expect(letter[0].lines.length).toBe(54);
    expect(a4[0].lines.length).toBe(58);
  });

  it('starts a new page at a page break', () => {
    const pages = layout('One.\n\n===\n\nTwo.\n');
    expect(pages.map(texts)).toEqual([['One.'], ['2.', 'Two.']]);
  });

  it('never strands a scene heading at the bottom of a page', () => {
    // 26 two-row blocks fill 51 rows; the heading would land on row 53 with no room after it.
    const filler = Array.from({ length: 26 }, (_, index) => `Line ${index}.`).join('\n\n');
    const pages = layout(`${filler}\n\nINT. B - NIGHT\n\nShe waits.\n`);
    expect(texts(pages[0])).not.toContain('INT. B - NIGHT');
    expect(texts(pages[1]).slice(1, 3)).toEqual(['INT. B - NIGHT', 'She waits.']);
  });

  it("breaks a long speech with (MORE) and NAME (CONT'D), never after a parenthetical", () => {
    const filler = Array.from({ length: 24 }, (_, index) => `Line ${index}.`).join('\n\n');
    const speech = Array.from({ length: 10 }, (_, index) => `Sentence number ${index}.`).join('\n');
    const pages = layout(`${filler}\n\nMARA (V.O.)\n${speech}\n`);
    const first = texts(pages[0]);
    const second = texts(pages[1]);
    expect(first[first.length - 1]).toBe('(MORE)');
    expect(first).toContain('MARA (V.O.)');
    expect(second[1]).toBe("MARA (V.O.) (CONT'D)");
    const spoken = [...first, ...second].filter((text) => text.startsWith('Sentence'));
    expect(spoken).toHaveLength(10);
  });

  it('moves a short speech whole rather than splitting it', () => {
    const filler = Array.from({ length: 26 }, (_, index) => `Line ${index}.`).join('\n\n');
    const pages = layout(`${filler}\n\nMARA\nOne.\nTwo.\n`);
    expect(texts(pages[0])).not.toContain('MARA');
    expect(texts(pages[1]).slice(1)).toEqual(['MARA', 'One.', 'Two.']);
  });

  it('keeps two action lines on each side of a break', () => {
    const filler = Array.from({ length: 26 }, (_, index) => `Line ${index}.`).join('\n\n');
    const pages = layout(`${filler}\n\nA1\nA2\nA3\n`);
    // Rows 52-53 are free: only two lines fit, and only one would be left, so the block moves.
    expect(texts(pages[1]).slice(1)).toEqual(['A1', 'A2', 'A3']);
  });

  it('lays dual dialogue side by side on shared rows', () => {
    const [page] = layout('BRICK\nScrew it.\n\nSTEEL ^\nNo.\n');
    expect(rows(page)).toEqual(['6:22:BRICK', '6:53:STEEL', '7:15:Screw it.', '7:46:No.']);
  });

  it('prints neither notes, sections nor synopses', () => {
    const [page] = layout('# Act\n\n= Synopsis\n\n[[note]]\n\nHe sits [[inline]] down.\n');
    expect(texts(page)).toEqual(['He sits  down.']);
  });

  it('centers centered text and italicizes lyrics', () => {
    const [page] = layout('> THE END <\n\n~La la\n');
    expect(rows(page)[0]).toBe('6:41:THE END');
    expect(page.lines[1].runs).toEqual([{ text: 'La la', italic: true }]);
  });

  it('lays out a title page first, with no page number, when there is one', () => {
    const pages = layout('Title: The Night\nAuthor: Ada\nContact: ada@example.com\nDraft date: 1/1\n\nRain.\n');
    expect(pages[0].number).toBe(0);
    expect(texts(pages[0])).toEqual(['The Night', 'Ada', 'ada@example.com', '1/1']);
    expect(pages[0].lines[0].row).toBe(22);
    expect(pages[0].lines[2]).toMatchObject({ row: 59, col: 15 });
    expect(pages[0].lines[3]).toMatchObject({ row: 59, col: 72 });
    expect(pages[1].number).toBe(1);
    expect(layout('Title: X\n\nRain.\n', { titlePage: false })[0].number).toBe(1);
  });
});
