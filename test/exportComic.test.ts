/**
 * Unit tests for the comic script export (Core ADR-0008): the comic model
 * (`export/comic.ts`), its page layout (`export/comicLayout.ts`), its HTML
 * writer (`export/comicHtml.ts`), screenplay bookmarks, and the layout
 * resolution in `export/settings.ts`.
 */

import { describe, expect, it } from 'vitest';
import { buildComicScript, comicExportContent, hasComicPages, numberWords, pageHeading, type ComicScript } from '../src/export/comic';
import { writeComicHtml } from '../src/export/comicHtml';
import { layoutComic } from '../src/export/comicLayout';
import { filterScript } from '../src/export/filter';
import { layoutScreenplay, type ScreenplayLayout } from '../src/export/layout';
import { presetContent } from '../src/export/options';
import { buildScreenplay, plainText } from '../src/export/screenplay';
import { PROJECT_TYPES } from '../src/config/projectType';
import { defaultLayoutForProjectType, resolveExportLayout } from '../src/export/settings';

const lines = (...parts: string[]): string => parts.join('\n');

const SAMPLE = lines(
  'Title: Harbour',
  'Author: A. Writer',
  '',
  'Some action before the comic starts.',
  '',
  'PAGE: 1 (SPLASH)',
  '',
  'LAYOUT: one big panel',
  '',
  'PANEL: Wide. The harbour at dawn, *misty*. \\*Not italic\\*',
  'SHOT: [harbour-wide] WIDE',
  'CAPTION: Lagos, 1897.',
  '',
  'ADÉ (WHISPER)',
  '(quietly)',
  "They're late. [[check this]]",
  '',
  'SFX: KLONK',
  '',
  'PAGE: 2-3',
  '',
  'PANEL: Close on Adé.',
  '',
  'BOLA (O.P.)',
  'Come inside!',
  '',
  'PANEL: The door.',
  '',
  'CAPTION (BOLA): Too late.',
  '',
);

/** Filter with a preset, then build the comic model. */
function comic(source: string, preset: 'pure' | 'production' = 'pure', pageSides = false): ComicScript {
  return buildComicScript(filterScript(source, comicExportContent(presetContent(preset))).text, { pageSides });
}

/** A sheet's text as rows, columns kept, for readable assertions. */
function sheetText(layout: ScreenplayLayout, index: number): string[] {
  const rows = new Map<number, string>();
  for (const line of layout.pages[index].lines) rows.set(line.row, (rows.get(line.row) ?? '').padEnd(line.col) + plainText(line.runs));
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, text]) => text);
}

describe('numberWords and pageHeading', () => {
  it('spells page numbers in capitals', () => {
    expect(numberWords(1)).toBe('ONE');
    expect(numberWords(13)).toBe('THIRTEEN');
    expect(numberWords(20)).toBe('TWENTY');
    expect(numberWords(42)).toBe('FORTY-TWO');
    expect(numberWords(100)).toBe('100');
    expect(numberWords(-1)).toBe('-1');
  });

  it('heads a page, a spread, a written label and an unnumbered page', () => {
    expect(pageHeading({ label: '7', number: 7 })).toBe('PAGE SEVEN');
    expect(pageHeading({ label: '2-3', number: 2, endNumber: 3 })).toBe('PAGES TWO–THREE');
    expect(pageHeading({ label: 'Inside front cover' })).toBe('INSIDE FRONT COVER');
    expect(pageHeading({ label: '', implicit: true })).toBe('UNNUMBERED PAGE');
  });
});

describe('comicExportContent and hasComicPages', () => {
  it('always keeps the comic lines and SFX lettering', () => {
    expect(comicExportContent(presetContent('pure'))).toMatchObject({ comic: true, sound: true, shots: false });
  });

  it('detects a script written with PAGE: lines', () => {
    expect(hasComicPages(SAMPLE)).toBe(true);
    expect(hasComicPages('INT. ROOM - DAY\n\nNothing.\n')).toBe(false);
    expect(hasComicPages('PANEL: Only a panel.\n')).toBe(false);
  });
});

describe('buildComicScript', () => {
  it('builds pages with headings, details and the title page', () => {
    const script = comic(SAMPLE);
    expect(script.titlePage.map((entry) => entry.key)).toEqual(['title', 'author']);
    expect(script.pages.map((page) => [page.heading, page.details])).toEqual([
      ['PAGE ONE', '(SPLASH, 1 panel)'],
      ['PAGES TWO–THREE', '(2 panels)'],
    ]);
    expect(plainText(script.pages[0].layout ?? [])).toBe('one big panel');
  });

  it('marks left and right pages when asked: page one is a right-hand page', () => {
    const script = comic(`${SAMPLE}\nPAGE: 4\n\nPANEL: Night.\n`, 'pure', true);
    expect(script.pages.map((page) => page.details)).toEqual(['(RIGHT, SPLASH, 1 panel)', '(SPREAD, 2 panels)', '(LEFT, 1 panel)']);
  });

  it('numbers lettering per page, restarting on each page, across panels', () => {
    const [first, second] = comic(SAMPLE).pages;
    expect(first.panels[0].lettering.map((entry) => [entry.number, entry.label])).toEqual([
      [1, 'CAPTION'],
      [2, 'ADÉ (WHISPER)'],
      [3, 'SFX'],
    ]);
    expect(second.panels.flatMap((panel) => panel.lettering.map((entry) => [entry.number, entry.label]))).toEqual([
      [1, 'BOLA (O.P.)'],
      [2, 'CAPTION (BOLA)'],
    ]);
  });

  it('puts a balloon\'s parenthetical before its words, in italics', () => {
    const balloon = comic(SAMPLE).pages[0].panels[0].lettering[1];
    expect(balloon.lines[0][0]).toEqual({ text: '(quietly) ', italic: true });
    expect(plainText(balloon.lines[0])).toBe("(quietly) They're late. ");
  });

  it('keeps inline formatting and backslash escapes literal', () => {
    const description = comic(SAMPLE).pages[0].panels[0].description ?? [];
    expect(description).toContainEqual({ text: 'misty', italic: true });
    expect(plainText(description)).toBe('Wide. The harbour at dawn, misty. *Not italic*');
  });

  it('follows the options for shot lines and notes', () => {
    const pure = comic(SAMPLE, 'pure').pages[0].panels[0];
    expect(pure.directions).toEqual([]);
    const production = comic(SAMPLE, 'production').pages[0].panels[0];
    expect(production.directions).toEqual([{ label: 'Shot', runs: [{ text: 'WIDE' }] }]);
    const noNotes = buildComicScript(filterScript(SAMPLE, comicExportContent({ ...presetContent('pure'), notes: false })).text);
    expect(noNotes.pages[0].panels[0].lettering[1].lines[0].some((run) => run.note)).toBe(false);
  });

  it('keeps the comic even with the Pure Fountain preset, and leaves out text before the first page', () => {
    const script = comic(SAMPLE, 'pure');
    expect(script.pages).toHaveLength(2);
    expect(JSON.stringify(script)).not.toContain('before the comic starts');
  });

  it('labels lettering written before the first panel as panel 0', () => {
    const script = comic(lines('PAGE: 1', '', 'CAPTION: Early.', '', 'PANEL: Later.', ''));
    expect(script.pages[0].panels.map((panel) => panel.number)).toEqual([0, 1]);
    expect(script.pages[0].details).toBe('(1 panel)');
  });

  it('keeps page notes and further panel direction', () => {
    const script = comic(lines('PAGE: 1', '', 'This page is quiet.', '', 'PANEL: A room.', '', 'Dust in the light.', ''));
    expect(script.pages[0].notes.map((note) => note.map(plainText))).toEqual([['This page is quiet.']]);
    expect(script.pages[0].panels[0].action.map((block) => block.map(plainText))).toEqual([['Dust in the light.']]);
  });
});

describe('layoutComic', () => {
  it('lays out a title page, then each comic page on its own sheet', () => {
    const layout = layoutComic(comic(SAMPLE), { paper: 'letter' });
    expect(layout.pages.map((page) => page.number)).toEqual([0, 1, 2]);
    expect(layout.pages.map((page) => page.bookmarks)).toEqual([undefined, ['PAGE ONE'], ['PAGES TWO–THREE']]);
    expect(sheetText(layout, 1)).toEqual([
      '          PAGE ONE (SPLASH, 1 panel)',
      '          Layout: one big panel',
      '          PANEL 1',
      '          Wide. The harbour at dawn, misty. *Not italic*',
      '              1.  CAPTION:        Lagos, 1897.',
      "              2.  ADÉ (WHISPER):  (quietly) They're late.",
      '              3.  SFX:            KLONK',
    ]);
  });

  it('styles the page heading bold and underlined, and the panel heading bold', () => {
    const sheet = layoutComic(comic(SAMPLE), { paper: 'letter', titlePage: false }).pages[0];
    expect(sheet.lines[0].runs[0]).toEqual({ text: 'PAGE ONE', bold: true, underline: true });
    expect(sheet.lines.find((line) => plainText(line.runs) === 'PANEL 1')?.runs[0].bold).toBe(true);
  });

  it('numbers sheets from sheet 2 at the right margin', () => {
    const layout = layoutComic(comic(SAMPLE), { paper: 'letter', titlePage: false });
    expect(layout.pages[1].lines[0]).toEqual({ row: 3, col: 73, runs: [{ text: '2.' }] });
    const a4 = layoutComic(comic(SAMPLE), { paper: 'a4', titlePage: false });
    expect(a4.pages[1].lines[0].col).toBe(70);
  });

  it('wraps lettering in its own column, and moves the words under a long label', () => {
    const long = 'word '.repeat(20).trim();
    const script = comic(lines('PAGE: 1', '', 'PANEL: x', '', `CAPTION (THE MOST ANCIENT NARRATOR): ${long}`, '', 'BOLA', long, ''));
    const sheet = layoutComic(script, { paper: 'letter', titlePage: false }).pages[0];
    const textLines = sheet.lines.filter((line) => line.col === 34);
    expect(textLines.length).toBeGreaterThan(2);
    const labelRow = sheet.lines.find((line) => plainText(line.runs).includes('NARRATOR'));
    expect(plainText(labelRow?.runs ?? [])).toBe('1.  CAPTION (THE MOST ANCIENT NARRATOR):');
    const bola = sheet.lines.find((line) => plainText(line.runs).includes('BOLA'));
    expect(plainText(bola?.runs ?? [])).toMatch(/^2\. {2}BOLA: {11}word/);
  });

  it('continues a long comic page on the next sheet under PAGE ONE (CONTINUED)', () => {
    const panels = Array.from({ length: 20 }, (_, index) => `PANEL: Panel ${index + 1} description.\n\nCAPTION: Caption ${index + 1}.\n`).join('\n');
    const layout = layoutComic(comic(`PAGE: 1\n\n${panels}`), { paper: 'letter', titlePage: false });
    expect(layout.pages.length).toBeGreaterThan(1);
    const second = sheetText(layout, 1);
    expect(second[1]).toBe('          PAGE ONE (CONTINUED)');
    expect(layout.pages[1].bookmarks).toBeUndefined();
    // No sheet ends with a panel heading.
    for (const sheet of layout.pages) {
      const body = sheet.lines.filter((line) => line.row > 3).sort((a, b) => a.row - b.row);
      expect(plainText(body[body.length - 1].runs)).not.toMatch(/^PANEL \d+$/);
    }
  });

  it('keeps every line inside the margins', () => {
    const layout = layoutComic(comic(SAMPLE), { paper: 'a4' });
    for (const sheet of layout.pages) {
      for (const line of sheet.lines) {
        expect(line.col).toBeGreaterThanOrEqual(10);
        expect(line.col + plainText(line.runs).length).toBeLessThanOrEqual(72);
        expect(line.row).toBeLessThan(Math.floor(layout.geometry.heightPt / 12) - 6);
      }
    }
  });
});

describe('writeComicHtml', () => {
  const html = writeComicHtml(comic(SAMPLE), { fallbackTitle: 'harbour', lang: 'yo' });

  it('writes a standalone page in the export language', () => {
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<html lang="yo">');
    expect(html).toContain('<title>Harbour</title>');
    expect(html).not.toContain('style="');
    expect(html).not.toContain('<script');
  });

  it('uses a section per page and per panel, with numbered lettering', () => {
    expect(html).toContain('<h2 class="comic-page__heading"><span class="comic-page__label">PAGES TWO–THREE</span> <span class="comic-page__details">(2 panels)</span></h2>');
    expect(html).toContain('<h3 class="panel__heading">Panel 1</h3>');
    expect(html).toContain('<ol class="lettering" start="2">');
    expect(html).toContain('<span class="lettering__number">2.</span><span class="lettering__label">CAPTION (BOLA):</span>');
  });

  it('escapes script text', () => {
    const escaped = writeComicHtml(comic(lines('PAGE: 1', '', 'PANEL: <b>x</b> & y', '')), { fallbackTitle: 't' });
    expect(escaped).toContain('&lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(escaped).toContain('<title>t</title>');
  });
});

describe('screenplay bookmarks (ADR-0008, section 5)', () => {
  it('lists scene headings, with their numbers, on the page they start', () => {
    const screenplay = buildScreenplay(lines('INT. HOUSE - DAY #1#', '', 'Action.', '', 'EXT. YARD - NIGHT', '', 'More.', ''));
    const layout = layoutScreenplay(screenplay, { paper: 'letter' });
    expect(layout.pages[0].bookmarks).toEqual(['1. INT. HOUSE - DAY', 'EXT. YARD - NIGHT']);
  });
});

describe('resolveExportLayout', () => {
  it('prefers an explicit choice, then the project type, then the script', () => {
    expect(resolveExportLayout('screenplay', { projectType: 'comic', hasComicPages: true })).toBe('screenplay');
    expect(resolveExportLayout('comic', { hasComicPages: false })).toBe('comic');
    expect(resolveExportLayout('auto', { projectType: 'comic', hasComicPages: false })).toBe('comic');
    expect(resolveExportLayout('auto', { projectType: 'tv_series', hasComicPages: true })).toBe('comic');
    expect(resolveExportLayout('auto', { projectType: 'tv_series', hasComicPages: false })).toBe('screenplay');
    expect(resolveExportLayout('auto', { hasComicPages: true })).toBe('comic');
    expect(resolveExportLayout('auto', { hasComicPages: false })).toBe('screenplay');
  });

  it('maps only the comic project type', () => {
    expect(defaultLayoutForProjectType('comic')).toBe('comic');
    for (const type of PROJECT_TYPES.filter((candidate) => candidate !== 'comic')) expect(defaultLayoutForProjectType(type)).toBeUndefined();
    expect(defaultLayoutForProjectType(undefined)).toBeUndefined();
  });
});
