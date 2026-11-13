/**
 * The comic script document model for exports (Core ADR-0004, section 2):
 * pages, panels and numbered lettering, with styled text runs, built from a
 * filtered script with the Page/Panel convention (ADR-0001).
 *
 * Exports {@link buildComicScript}, {@link comicExportContent},
 * {@link pageHeading}, {@link numberWords}, {@link hasComicPages} and the
 * model types.
 *
 * Gotchas:
 * - Build it from {@link filterScript}'s output with
 *   {@link comicExportContent}, which keeps the comic structure whatever the
 *   preset says.
 * - Text before the first `PAGE:` or `PANEL:` is not part of the comic and is
 *   left out, as the page map does. Scene headings aren't printed.
 * - Lettering is numbered per page, restarting at 1, so a letterer can match
 *   each balloon to the art.
 */

import { extractComic, type ComicPage, type ComicPanel, type LetteringEntry } from '../comics/parseComic';
import type { ExportContent } from './options';
import { buildScreenplay, parseInline, shieldEscapes, type RunLine, type TitlePageEntry } from './screenplay';

/** One piece of numbered lettering. */
export interface ComicLettering {
  /** 1-based within the page. */
  number: number;
  kind: LetteringEntry['kind'];
  /** What prints before the words: `CAPTION`, `CAPTION (NAME)`, `NAME (WHISPER)`, `SFX`. */
  label: string;
  /** The words, one run line per source line; a balloon's parentheticals come first, italic. */
  lines: RunLine[];
}

/** One panel ready to print. */
export interface ComicExportPanel {
  /** 1-based within the page; 0 for lettering written before the page's first `PANEL:`. */
  number: number;
  /** The panel's `LAYOUT:` text. */
  layout?: RunLine;
  /** The `PANEL:` description. */
  description?: RunLine;
  /** Kept `SHOT:`, `POSE:` and `LIGHT:` lines, as `Shot`/`Pose`/`Light` and their text. */
  directions: { label: 'Shot' | 'Pose' | 'Light'; runs: RunLine }[];
  /** Further action blocks, each a list of lines. */
  action: RunLine[][];
  lettering: ComicLettering[];
}

/** One comic page ready to print. */
export interface ComicExportPage {
  /** The printed heading, e.g. `PAGE ONE`, `PAGES TWO–THREE`, `INSIDE FRONT COVER`. */
  heading: string;
  /** The heading's details, e.g. `(SPLASH, 1 panel)` or `(RIGHT, 4 panels)`. */
  details: string;
  /** The page `LAYOUT:` text. */
  layout?: RunLine;
  /** Action written between `PAGE:` and the first panel. */
  notes: RunLine[][];
  panels: ComicExportPanel[];
}

/** A whole comic script, ready for a writer. */
export interface ComicScript {
  titlePage: TitlePageEntry[];
  pages: ComicExportPage[];
}

/** Options for {@link buildComicScript}. */
export interface ComicScriptOptions {
  /** Mark each page `LEFT` or `RIGHT` (page one is a right-hand page). Defaults to false. */
  pageSides?: boolean;
}

/**
 * The export content to filter a script with for the comic layout: the
 * writer's choices, with the comic lines and `SFX:` lettering always kept.
 *
 * @param content - The writer's chosen content.
 * @returns The same content with `comic` and `sound` on.
 */
export function comicExportContent(content: ExportContent): ExportContent {
  return { ...content, comic: true, sound: true };
}

/**
 * Whether a script has at least one explicit `PAGE:` line, the test the
 * automatic layout uses when the project has no type.
 *
 * @param scriptText - The script's text.
 * @returns True when the script is written as a comic.
 */
export function hasComicPages(scriptText: string): boolean {
  return extractComic(scriptText).hasPages;
}

/**
 * Build the comic model from (filtered) Fountain text.
 *
 * @param fountainText - Fountain text, normally {@link filterScript}'s output with {@link comicExportContent}.
 * @param options - Page-side marking.
 * @returns The title page and the comic pages.
 */
export function buildComicScript(fountainText: string, options: ComicScriptOptions = {}): ComicScript {
  const shielded = shieldEscapes(fountainText);
  const { titlePage } = buildScreenplay(fountainText);
  const structure = extractComic(shielded);
  return { titlePage, pages: structure.pages.map((page) => exportPage(page, options.pageSides ?? false)) };
}

/** One page of the model. */
function exportPage(page: ComicPage, pageSides: boolean): ComicExportPage {
  let lettered = 0;
  const panels = page.panels.map((panel) => {
    const exported = exportPanel(panel, lettered);
    lettered += exported.lettering.length;
    return exported;
  });
  const counted = page.panels.filter((panel) => panel.number > 0).length;
  const details = [...page.modifiers];
  if (pageSides) {
    const side = pageSide(page);
    if (side && !details.includes(side)) details.unshift(side);
  }
  details.push(`${counted} ${counted === 1 ? 'panel' : 'panels'}`);
  return {
    heading: pageHeading(page),
    details: `(${details.join(', ')})`,
    ...(page.layout ? { layout: parseInline(page.layout) } : {}),
    notes: page.notes.map((note) => linesOf(note.text)),
    panels,
  };
}

/** One panel of the model; lettering numbers continue from `before`. */
function exportPanel(panel: ComicPanel, before: number): ComicExportPanel {
  const directions: ComicExportPanel['directions'] = [];
  if (panel.shot) directions.push({ label: 'Shot', runs: parseInline(panel.shot) });
  if (panel.pose) directions.push({ label: 'Pose', runs: parseInline(panel.pose) });
  if (panel.light) directions.push({ label: 'Light', runs: parseInline(panel.light) });
  return {
    number: panel.number,
    ...(panel.layout ? { layout: parseInline(panel.layout) } : {}),
    ...(panel.description ? { description: parseInline(panel.description) } : {}),
    directions,
    action: panel.action.map((block) => linesOf(block.text)),
    lettering: panel.lettering.map((entry, index) => exportLettering(entry, before + index + 1)),
  };
}

/** One piece of lettering with its number and label. */
function exportLettering(entry: LetteringEntry, number: number): ComicLettering {
  switch (entry.kind) {
    case 'caption':
      return { number, kind: 'caption', label: entry.speaker ? `CAPTION (${entry.speaker.toUpperCase()})` : 'CAPTION', lines: linesOf(entry.text) };
    case 'sfx':
      return { number, kind: 'sfx', label: 'SFX', lines: linesOf(entry.text) };
    case 'balloon': {
      const extensions = entry.extensions.map((extension) => ` (${extension.trim().toUpperCase()})`).join('');
      const lines = linesOf(entry.text);
      if (entry.directions.length > 0) {
        const directions = entry.directions.flatMap((direction) => parseInline(`${direction.trim()} `)).map((run) => ({ ...run, italic: true as const }));
        lines[0] = [...directions, ...(lines[0] ?? [])];
      }
      return { number, kind: 'balloon', label: `${entry.speaker.toUpperCase()}${extensions}`, lines };
    }
  }
}

/** Each line of a block as runs. */
function linesOf(text: string): RunLine[] {
  return text.split('\n').map((line) => parseInline(line.trim()));
}

/**
 * A page's printed heading.
 *
 * @param page - The page's label fields.
 * @returns `PAGE ONE`, `PAGES TWO–THREE`, the written label in capitals, or `UNNUMBERED PAGE`.
 */
export function pageHeading(page: Pick<ComicPage, 'label' | 'number' | 'endNumber' | 'implicit'>): string {
  if (page.number !== undefined && page.endNumber !== undefined) return `PAGES ${numberWords(page.number)}–${numberWords(page.endNumber)}`;
  if (page.number !== undefined) return `PAGE ${numberWords(page.number)}`;
  if (page.label) return page.label.toUpperCase();
  return 'UNNUMBERED PAGE';
}

/** Which side a page falls on: odd pages right, even pages left, a spread both. */
function pageSide(page: ComicPage): 'LEFT' | 'RIGHT' | 'SPREAD' | undefined {
  if (page.number === undefined) return undefined;
  if (page.endNumber !== undefined) return 'SPREAD';
  return page.number % 2 === 1 ? 'RIGHT' : 'LEFT';
}

const ONES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

/**
 * A page number in capital words, the comic-script convention.
 *
 * @param value - A whole number.
 * @returns `ONE` … `NINETY-NINE`; larger numbers stay as digits.
 */
export function numberWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 99) return String(value);
  if (value < 20) return ONES[value];
  const ones = value % 10;
  return ones === 0 ? TENS[Math.floor(value / 10)] : `${TENS[Math.floor(value / 10)]}-${ONES[ones]}`;
}
