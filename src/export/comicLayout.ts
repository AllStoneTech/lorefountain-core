/**
 * Comic script page layout for the PDF export (Core ADR-0008, section 4): the
 * comic model on the same Courier character grid, and in the same output
 * shape, as the screenplay layout, so one renderer draws both.
 *
 * Exports {@link layoutComic} and {@link ComicLayoutOptions}.
 *
 * Layout:
 * - Margins 1 in on every side; text runs the full measure (6.5 in on Letter).
 * - Each comic page starts a new sheet with its heading, bold and underlined,
 *   and its details (`(4 panels)`). A comic page longer than a sheet continues
 *   under `PAGE ONE (CONTINUED)`.
 * - `PANEL 1` in bold, then its layout, description, shot lines and further
 *   direction. A panel heading never ends a sheet.
 * - Lettering hangs: the number, the label (`ADÉ:`), then the words in a
 *   column of their own. A label too wide for its column puts the words on
 *   the next row. An entry moves to the next sheet whole unless it is longer
 *   than a sheet.
 * - Sheets are numbered top right from sheet 2; the title page has none.
 */

import type { ComicExportPage, ComicExportPanel, ComicLettering, ComicScript } from './comic';
import { displayWidth, numberPages, paperGeometry, printedRuns, titlePageLayout, wrapRuns, type LayoutPage, type PaperSize, type ScreenplayLayout } from './layout';
import type { RunLine } from './screenplay';

/** Options for {@link layoutComic}. */
export interface ComicLayoutOptions {
  paper: PaperSize;
  /** Lay out a title page first when the script has one. Defaults to true. */
  titlePage?: boolean;
}

const TOP_ROW = 6;
const BOTTOM_MARGIN_ROWS = 6;
const LEFT_COL = 10;
const MARGIN_COLS = 10;
const NUMBER_INDENT = 4;
const LABEL_INDENT = 8;
const TEXT_INDENT = 24;

/** A line within a block, before it has a row. */
interface BlockLine {
  col: number;
  runs: RunLine;
}

/** A unit the paginator places. */
interface Block {
  lines: BlockLine[];
  /** Blank rows before it, unless it opens a sheet. */
  spaceBefore: number;
  /** Keep with at least two rows of the next block (a panel heading). */
  keepNext?: true;
  /** May break across sheets, keeping two lines on each side (description and direction). */
  splittable?: true;
  /** Set on a comic page's heading: it starts a new sheet. */
  startsPage?: { bookmark: string; continued: RunLine };
}

/** Column positions for one paper size. */
interface Columns {
  left: number;
  width: number;
  right: number;
}

/**
 * Lay a comic script out in sheets.
 *
 * @param script - The comic model.
 * @param options - Paper size and title page.
 * @returns The page geometry and every sheet's positioned lines and bookmarks.
 */
export function layoutComic(script: ComicScript, options: ComicLayoutOptions): ScreenplayLayout {
  const geometry = paperGeometry(options.paper);
  const right = Math.floor(geometry.widthPt / geometry.colPt) - MARGIN_COLS;
  const columns: Columns = { left: LEFT_COL, right, width: right - LEFT_COL };
  const bodyRows = Math.floor(geometry.heightPt / geometry.rowPt) - TOP_ROW - BOTTOM_MARGIN_ROWS;

  const pages: LayoutPage[] = [];
  if ((options.titlePage ?? true) && script.titlePage.length > 0) {
    pages.push({ number: 0, lines: titlePageLayout(script.titlePage, options.paper) });
  }
  const blocks = script.pages.flatMap((page) => pageBlocks(page, columns));
  pages.push(...paginate(blocks, bodyRows, columns));
  return { geometry, pages };
}

/** One comic page as blocks: heading, page notes, then each panel. */
function pageBlocks(page: ComicExportPage, columns: Columns): Block[] {
  const heading: RunLine = [{ text: page.heading, bold: true, underline: true }, { text: ` ${page.details}` }];
  const blocks: Block[] = [
    {
      lines: wrapped(heading, columns.left, columns.width),
      spaceBefore: 0,
      startsPage: { bookmark: page.heading, continued: [{ text: `${page.heading} (CONTINUED)`, bold: true }] },
    },
  ];
  if (page.layout) blocks.push({ lines: wrapped(labelled('Layout', page.layout), columns.left, columns.width), spaceBefore: 1, splittable: true });
  for (const note of page.notes) blocks.push({ lines: note.flatMap((line) => wrapped(line, columns.left, columns.width)), spaceBefore: 1, splittable: true });
  for (const panel of page.panels) blocks.push(...panelBlocks(panel, columns));
  return blocks.filter((block) => block.lines.length > 0);
}

/** One panel as blocks. */
function panelBlocks(panel: ComicExportPanel, columns: Columns): Block[] {
  const blocks: Block[] = [];
  const heading = panel.number > 0 ? `PANEL ${panel.number}` : 'LETTERING BEFORE THE FIRST PANEL';
  blocks.push({ lines: [{ col: columns.left, runs: [{ text: heading, bold: true }] }], spaceBefore: 1, keepNext: true });

  const direction: BlockLine[] = [];
  if (panel.layout) direction.push(...wrapped(labelled('Layout', panel.layout), columns.left, columns.width));
  if (panel.description) direction.push(...wrapped(panel.description, columns.left, columns.width));
  for (const line of panel.directions) direction.push(...wrapped(labelled(line.label, line.runs), columns.left, columns.width));
  if (direction.length > 0) blocks.push({ lines: direction, spaceBefore: 0, splittable: true });
  for (const action of panel.action) blocks.push({ lines: action.flatMap((line) => wrapped(line, columns.left, columns.width)), spaceBefore: 1, splittable: true });
  for (const entry of panel.lettering) blocks.push({ lines: letteringLines(entry, columns), spaceBefore: 1 });
  return blocks;
}

/** A lettering entry: number and label, then the words hanging in their own column. */
function letteringLines(entry: ComicLettering, columns: Columns): BlockLine[] {
  const numberCol = columns.left + NUMBER_INDENT;
  const labelCol = columns.left + LABEL_INDENT;
  const textCol = columns.left + TEXT_INDENT;
  const number = `${entry.number}.`;
  const label = `${entry.label}:`;
  const head: RunLine = [{ text: number }, { text: ' '.repeat(Math.max(1, labelCol - numberCol - displayWidth(number))) }, { text: label }];
  const words = entry.lines.flatMap((line) => wrapRuns(printedRuns(line), columns.right - textCol)).filter((runs) => runs.length > 0);
  if (words.length === 0) return [{ col: numberCol, runs: head }];

  // The number and label share the first row with the words when the label fits its column.
  const used = displayWidth(number) + Math.max(1, labelCol - numberCol - displayWidth(number)) + displayWidth(label);
  if (numberCol + used >= textCol) return [{ col: numberCol, runs: head }, ...words.map((runs) => ({ col: textCol, runs }))];
  return [
    { col: numberCol, runs: [...head, { text: ' '.repeat(textCol - numberCol - used) }, ...words[0]] },
    ...words.slice(1).map((runs) => ({ col: textCol, runs })),
  ];
}

/** `Label: text` runs. */
function labelled(label: string, runs: RunLine): RunLine {
  return [{ text: `${label}: ` }, ...runs];
}

/** A line wrapped to a width at a column, notes left out; nothing for a line that only held notes. */
function wrapped(runs: RunLine, col: number, width: number): BlockLine[] {
  const printed = printedRuns(runs);
  if (printed.length === 0) return runs.length > 0 ? [] : [{ col, runs: [] }];
  return wrapRuns(printed, width).map((line) => ({ col, runs: line }));
}

/** Place blocks on sheets. */
function paginate(blocks: readonly Block[], bodyRows: number, columns: Columns): LayoutPage[] {
  const pages: LayoutPage[] = [];
  let page: LayoutPage = { number: 1, lines: [] };
  let used = 0;
  let continued: RunLine | undefined;

  const place = (lines: readonly BlockLine[], spaceBefore: number): void => {
    let row = used === 0 ? 0 : used + spaceBefore;
    for (const line of lines) {
      page.lines.push({ row: TOP_ROW + row, col: line.col, runs: line.runs });
      row += 1;
    }
    used = row;
  };
  const free = (spaceBefore: number): number => bodyRows - (used === 0 ? 0 : used + spaceBefore);
  const newSheet = (carryOn: boolean): void => {
    pages.push(page);
    page = { number: page.number + 1, lines: [] };
    used = 0;
    if (carryOn && continued) place([{ col: columns.left, runs: continued }], 0);
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.startsPage) {
      if (page.lines.length > 0) newSheet(false);
      continued = block.startsPage.continued;
      (page.bookmarks ??= []).push(block.startsPage.bookmark);
      place(block.lines, 0);
      continue;
    }

    const rows = block.lines.length;
    const next = blocks[index + 1];
    const follow = block.keepNext && next && !next.startsPage ? Math.min(2, next.lines.length) + next.spaceBefore : 0;
    if (rows + follow <= free(block.spaceBefore)) {
      place(block.lines, block.spaceBefore);
      continue;
    }
    if (block.splittable) {
      placeSplit(block);
      continue;
    }
    newSheet(true);
    if (rows <= free(block.spaceBefore)) {
      place(block.lines, block.spaceBefore);
    } else {
      // Longer than a whole sheet: place what fits, sheet by sheet.
      placeSplit(block);
    }
  }
  if (page.lines.length > 0 || pages.length === 0) pages.push(page);
  numberPages(pages, columns.right);
  return pages;

  /** Break a block across sheets, keeping two lines on each side when it can. */
  function placeSplit(block: Block): void {
    let lines = block.lines;
    const spaceBefore = block.spaceBefore;
    while (lines.length > 0) {
      const available = free(spaceBefore);
      if (lines.length <= available) {
        place(lines, spaceBefore);
        return;
      }
      const twoEachSide = available >= 2 && lines.length - available >= 2;
      const sheetIsFresh = used <= 1;
      const take = twoEachSide ? available : sheetIsFresh ? Math.max(1, available) : 0;
      if (take > 0) {
        place(lines.slice(0, take), spaceBefore);
        lines = lines.slice(take);
      }
      newSheet(true);
    }
  }
}
