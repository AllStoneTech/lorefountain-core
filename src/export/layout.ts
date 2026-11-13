/**
 * Screenplay page layout for the PDF export (Core ADR-0003, section 5): the
 * screenplay model laid out on a monospaced character grid, the way
 * screenplays are typeset.
 *
 * Exports {@link layoutScreenplay}, {@link displayWidth}, {@link wrapRuns}
 * and the layout types.
 *
 * Grid: Courier 12 pt is 10 characters per inch and 6 lines per inch, so a
 * column is 0.1 in (7.2 pt) and a row 1/6 in (12 pt). Rows and columns count
 * from the page's top-left corner. A renderer only has to draw each line's
 * runs at its row and column.
 *
 * Industry layout (US Letter; A4 keeps the same margins with more rows):
 * - Margins 1.5 in left, 1 in right, top and bottom: 54 body rows on Letter.
 * - Action and scene headings at 1.5 in, 6.0 in wide. Character names at
 *   3.7 in, parentheticals at 3.1 in (2.5 in wide), dialogue at 2.5 in
 *   (3.5 in wide), transitions right-aligned at 7.5 in.
 * - Page numbers top right ("2.") from page 2; the title page has none.
 * - A speech that breaks across pages ends with `(MORE)` and continues under
 *   `NAME (CONT'D)`. A scene heading or character name is never the last
 *   thing on a page, and action keeps at least two lines on each side of a break.
 * - Dual dialogue sits in two columns and never breaks across pages.
 * - Sections, synopses and notes are not printed (Fountain spec).
 */

import { plainText, type DialogueBlock, type RunLine, type Screenplay, type TextRun } from './screenplay';

/** Paper sizes. */
export type PaperSize = 'letter' | 'a4';

/** Options for {@link layoutScreenplay}. */
export interface LayoutOptions {
  paper: PaperSize;
  /** Lay out a title page first when the script has one. Defaults to true. */
  titlePage?: boolean;
  /** Print scene numbers in both margins. Defaults to true. */
  sceneNumbers?: boolean;
}

/** One printed line: runs drawn left to right from `col` on `row`. */
export interface LayoutLine {
  row: number;
  col: number;
  runs: RunLine;
}

/** One page of the layout. */
export interface LayoutPage {
  /** The printed page number; 0 for the title page. */
  number: number;
  lines: LayoutLine[];
}

/** The page grid in inches and character cells. */
export interface PageGeometry {
  paper: PaperSize;
  /** Page size in points (1/72 in). */
  widthPt: number;
  heightPt: number;
  /** Cell size in points: 7.2 × 12 for Courier 12 pt. */
  colPt: number;
  rowPt: number;
}

/** The finished layout. */
export interface ScreenplayLayout {
  geometry: PageGeometry;
  pages: LayoutPage[];
}

/** Page sizes in points. */
const PAPER: Readonly<Record<PaperSize, { width: number; height: number }>> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
};

const COL_PT = 7.2;
const ROW_PT = 12;
const TOP_ROW = 6;
const BOTTOM_MARGIN_ROWS = 6;
const PAGE_NUMBER_ROW = 3;

const ACTION_COL = 15;
const ACTION_WIDTH = 60;
const CHARACTER_COL = 37;
const PARENTHETICAL_COL = 31;
const PARENTHETICAL_WIDTH = 25;
const DIALOGUE_COL = 25;
const DIALOGUE_WIDTH = 35;
const RIGHT_EDGE_COL = 75;
const LEFT_NUMBER_COL = 9;
const RIGHT_NUMBER_COL = 77;

/** Dual dialogue columns: [left, right]. */
const DUAL = [
  { character: 22, parenthetical: 17, dialogue: 15 },
  { character: 53, parenthetical: 48, dialogue: 46 },
] as const;
const DUAL_DIALOGUE_WIDTH = 28;
const DUAL_PARENTHETICAL_WIDTH = 24;

/** A line within a block, before it has a row. */
interface BlockLine {
  col: number;
  runs: RunLine;
  /** What the line is, for page-break decisions inside a speech. */
  role: 'character' | 'parenthetical' | 'dialogue' | 'other';
}

/** A unit the paginator places. */
interface Block {
  kind: 'heading' | 'action' | 'speech' | 'whole' | 'page-break';
  lines: BlockLine[];
  /** Blank rows before it, unless it opens a page. */
  spaceBefore: number;
  /** For a speech: the cue to repeat, as `NAME (CONT'D)`, when it continues on the next page. */
  continuedCue?: RunLine;
}

/**
 * Lay a screenplay out in pages.
 *
 * @param screenplay - The script model.
 * @param options - Paper size, title page and scene numbers.
 * @returns The page geometry and every page's positioned lines.
 */
export function layoutScreenplay(screenplay: Screenplay, options: LayoutOptions): ScreenplayLayout {
  const paper = PAPER[options.paper];
  const geometry: PageGeometry = { paper: options.paper, widthPt: paper.width, heightPt: paper.height, colPt: COL_PT, rowPt: ROW_PT };
  const totalRows = Math.floor(paper.height / ROW_PT);
  const bodyRows = totalRows - TOP_ROW - BOTTOM_MARGIN_ROWS;

  const pages: LayoutPage[] = [];
  if ((options.titlePage ?? true) && screenplay.titlePage.length > 0) {
    pages.push({ number: 0, lines: titlePageLines(screenplay, totalRows) });
  }
  const blocks = toBlocks(screenplay, options.sceneNumbers ?? true);
  pages.push(...paginate(blocks, bodyRows));
  return { geometry, pages };
}

/** Turn the model's printed elements into blocks. */
function toBlocks(screenplay: Screenplay, sceneNumbers: boolean): Block[] {
  const blocks: Block[] = [];
  for (const element of screenplay.elements) {
    switch (element.kind) {
      case 'scene-heading': {
        const lines: BlockLine[] = wrapRuns(element.runs, ACTION_WIDTH).map((runs) => ({ col: ACTION_COL, runs, role: 'other' }));
        if (sceneNumbers && element.number && lines.length > 0) {
          const label = [{ text: element.number }];
          lines.push({ col: LEFT_NUMBER_COL + Math.max(0, 4 - displayWidth(element.number)), runs: label, role: 'other' });
          lines.push({ col: RIGHT_NUMBER_COL, runs: label, role: 'other' });
        }
        blocks.push({ kind: 'heading', lines, spaceBefore: 1 });
        break;
      }
      case 'action': {
        const lines = element.lines.flatMap((line) =>
          printedRuns(line.runs).length === 0 && line.runs.length > 0
            ? []
            : wrapRuns(printedRuns(line.runs), ACTION_WIDTH).map((runs): BlockLine => ({ col: ACTION_COL, runs, role: 'other' })),
        );
        if (lines.length > 0) blocks.push({ kind: 'action', lines, spaceBefore: 1 });
        break;
      }
      case 'lyric': {
        const lines = element.lines.flatMap((line) => wrapRuns(italic(printedRuns(line)), ACTION_WIDTH).map((runs): BlockLine => ({ col: ACTION_COL, runs, role: 'other' })));
        blocks.push({ kind: 'action', lines, spaceBefore: 1 });
        break;
      }
      case 'dialogue':
        blocks.push(speechBlock(element.block));
        break;
      case 'dual-dialogue':
        blocks.push(dualBlock(element.left, element.right));
        break;
      case 'transition': {
        const lines = wrapRuns(printedRuns(element.runs), ACTION_WIDTH).map((runs): BlockLine => ({ col: RIGHT_EDGE_COL - displayWidth(plainText(runs)), runs, role: 'other' }));
        blocks.push({ kind: 'whole', lines, spaceBefore: 1 });
        break;
      }
      case 'centered': {
        const lines = element.lines.flatMap((line) =>
          wrapRuns(printedRuns(line), ACTION_WIDTH).map((runs): BlockLine => ({ col: ACTION_COL + Math.floor((ACTION_WIDTH - displayWidth(plainText(runs))) / 2), runs, role: 'other' })),
        );
        blocks.push({ kind: 'whole', lines, spaceBefore: 1 });
        break;
      }
      case 'page-break':
        blocks.push({ kind: 'page-break', lines: [], spaceBefore: 0 });
        break;
      case 'section':
      case 'synopsis':
      case 'note':
        break;
    }
  }
  return blocks;
}

/** A speech as one block: cue, then parentheticals, dialogue and lyrics. */
function speechBlock(block: DialogueBlock): Block {
  const lines: BlockLine[] = [{ col: CHARACTER_COL, runs: printedRuns(block.cue), role: 'character' }];
  lines.push(...speechPartLines(block, DIALOGUE_COL, DIALOGUE_WIDTH, PARENTHETICAL_COL, PARENTHETICAL_WIDTH));
  return { kind: 'speech', lines, spaceBefore: 1, continuedCue: continuedCue(block) };
}

/** A speech's parts as block lines, wrapped to the given columns. */
function speechPartLines(block: DialogueBlock, dialogueCol: number, dialogueWidth: number, parentheticalCol: number, parentheticalWidth: number): BlockLine[] {
  const lines: BlockLine[] = [];
  for (const part of block.parts) {
    if (part.kind === 'parenthetical') {
      for (const runs of wrapRuns(printedRuns(part.runs), parentheticalWidth)) lines.push({ col: parentheticalCol, runs, role: 'parenthetical' });
      continue;
    }
    for (const line of part.lines) {
      const runs = part.kind === 'lyric' ? italic(printedRuns(line)) : printedRuns(line);
      for (const wrapped of wrapRuns(runs, dialogueWidth)) lines.push({ col: dialogueCol, runs: wrapped, role: 'dialogue' });
    }
  }
  return lines;
}

/** Dual dialogue: both speeches side by side, row-aligned from the cue down. */
function dualBlock(left: DialogueBlock, right: DialogueBlock): Block {
  const side = (block: DialogueBlock, index: 0 | 1): BlockLine[] => [
    { col: DUAL[index].character, runs: printedRuns(block.cue), role: 'character' },
    ...speechPartLines(block, DUAL[index].dialogue, DUAL_DIALOGUE_WIDTH, DUAL[index].parenthetical, DUAL_PARENTHETICAL_WIDTH),
  ];
  const leftLines = side(left, 0);
  const rightLines = side(right, 1);
  // Interleave so that line i of each side shares row i; `paginate` assigns rows by `rowOffset`.
  const lines: (BlockLine & { rowOffset?: number })[] = [];
  const rows = Math.max(leftLines.length, rightLines.length);
  for (let row = 0; row < rows; row += 1) {
    if (leftLines[row]) lines.push({ ...leftLines[row], rowOffset: row });
    if (rightLines[row]) lines.push({ ...rightLines[row], rowOffset: row });
  }
  return { kind: 'whole', lines, spaceBefore: 1 };
}

/** `NAME (EXT) (CONT'D)` for a speech continuing on the next page. */
function continuedCue(block: DialogueBlock): RunLine {
  const cue = plainText(block.cue).replace(/\s*\((?:CONT(?:'|’)?D\.?|CONT\.?|CONTINUED)\)\s*/gi, ' ').trim();
  return [{ text: `${cue} (CONT'D)` }];
}

/** How many rows a block's lines occupy (dual dialogue shares rows). */
function rowsOf(lines: readonly (BlockLine & { rowOffset?: number })[]): number {
  if (lines.length === 0) return 0;
  if (lines.some((line) => line.rowOffset !== undefined)) return Math.max(...lines.map((line) => line.rowOffset ?? 0)) + 1;
  // Scene-number labels share the heading's first row.
  return lines.filter((line) => !isNumberLabel(line)).length;
}

/** True for a scene-number label line, which shares its heading's first row. */
function isNumberLabel(line: BlockLine): boolean {
  return line.col === RIGHT_NUMBER_COL || (line.col < ACTION_COL && line.role === 'other');
}

/** Place blocks on pages. */
function paginate(blocks: readonly Block[], bodyRows: number): LayoutPage[] {
  const pages: LayoutPage[] = [];
  let page: LayoutPage = { number: 1, lines: [] };
  let used = 0;

  const newPage = (): void => {
    pages.push(page);
    page = { number: page.number + 1, lines: [] };
    used = 0;
  };
  const place = (lines: readonly (BlockLine & { rowOffset?: number })[], spaceBefore: number): void => {
    const start = used === 0 ? 0 : used + spaceBefore;
    let row = start;
    for (const line of lines) {
      if (line.rowOffset !== undefined) {
        page.lines.push({ row: TOP_ROW + start + line.rowOffset, col: line.col, runs: line.runs });
      } else if (isNumberLabel(line)) {
        page.lines.push({ row: TOP_ROW + start, col: line.col, runs: line.runs });
      } else {
        page.lines.push({ row: TOP_ROW + row, col: line.col, runs: line.runs });
        row += 1;
      }
    }
    used = start + rowsOf(lines);
  };
  const free = (spaceBefore: number): number => bodyRows - (used === 0 ? 0 : used + spaceBefore);

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.kind === 'page-break') {
      if (used > 0 || page.lines.length > 0) newPage();
      continue;
    }
    const rows = rowsOf(block.lines);

    if (block.kind === 'heading') {
      // Keep a heading with at least two rows of what follows.
      const next = blocks[index + 1];
      const follow = next && next.kind !== 'page-break' ? Math.min(2, rowsOf(next.lines)) + next.spaceBefore : 0;
      if (used > 0 && rows + follow > free(block.spaceBefore)) newPage();
      place(block.lines, block.spaceBefore);
      continue;
    }

    if (rows <= free(block.spaceBefore)) {
      place(block.lines, block.spaceBefore);
      continue;
    }

    if (block.kind === 'action') {
      placeAction(block);
      continue;
    }
    if (block.kind === 'speech') {
      placeSpeech(block);
      continue;
    }
    // Unsplittable: start a new page (if this one has anything), then place it.
    if (used > 0) newPage();
    place(block.lines, block.spaceBefore);
  }
  if (page.lines.length > 0 || pages.length === 0) pages.push(page);

  // Page numbers from page 2.
  for (const finished of pages) {
    if (finished.number < 2) continue;
    const label = `${finished.number}.`;
    finished.lines.unshift({ row: PAGE_NUMBER_ROW, col: RIGHT_EDGE_COL - displayWidth(label), runs: [{ text: label }] });
  }
  return pages;

  /** Split an action block, keeping two lines on each side, or move it whole. */
  function placeAction(block: Block): void {
    let lines = block.lines;
    let spaceBefore = block.spaceBefore;
    while (lines.length > 0) {
      const available = free(spaceBefore);
      if (lines.length <= available) {
        place(lines, spaceBefore);
        return;
      }
      const fitsTwoEachSide = available >= 2 && lines.length - available >= 2;
      const take = fitsTwoEachSide ? available : used === 0 ? Math.max(1, available) : 0;
      if (take > 0) {
        place(lines.slice(0, take), spaceBefore);
        lines = lines.slice(take);
      }
      newPage();
      spaceBefore = 0;
    }
  }

  /** Split a speech with (MORE) and (CONT'D), or move it whole. */
  function placeSpeech(block: Block): void {
    const [cue, ...parts] = block.lines;
    let header = cue;
    let rest = parts;
    let spaceBefore = block.spaceBefore;
    while (rest.length > 0) {
      const available = free(spaceBefore);
      if (rest.length + 1 <= available) {
        place([header, ...rest], spaceBefore);
        return;
      }
      // Rows for the cue and (MORE) leave this many for speech lines.
      let take = available - 2;
      // Never end on a parenthetical, and keep at least two speech lines on this page and one on the next.
      while (take > 0 && rest[take - 1].role === 'parenthetical') take -= 1;
      if (take >= 2 && rest.length - take >= 1) {
        place([header, ...rest.slice(0, take), { col: CHARACTER_COL, runs: [{ text: '(MORE)' }], role: 'other' }], spaceBefore);
        rest = rest.slice(take);
        header = { col: CHARACTER_COL, runs: block.continuedCue ?? cue.runs, role: 'character' };
        newPage();
        spaceBefore = 0;
        continue;
      }
      if (used === 0) {
        // Longer than a whole page with nothing splittable: place what fits.
        const forced = Math.max(1, available - 2);
        place([header, ...rest.slice(0, forced), { col: CHARACTER_COL, runs: [{ text: '(MORE)' }], role: 'other' }], spaceBefore);
        rest = rest.slice(forced);
        header = { col: CHARACTER_COL, runs: block.continuedCue ?? cue.runs, role: 'character' };
      }
      newPage();
      spaceBefore = 0;
    }
  }
}

/** The title page: title block centered a third of the way down, contact details bottom left, dates bottom right. */
function titlePageLines(screenplay: Screenplay, totalRows: number): LayoutLine[] {
  const lines: LayoutLine[] = [];
  const centerKeys = ['title', 'credit', 'author', 'authors', 'source'];
  const leftKeys = ['contact', 'notes', 'copyright'];

  let row = Math.floor(totalRows / 3);
  for (const key of centerKeys) {
    for (const entry of screenplay.titlePage.filter((candidate) => candidate.key === key)) {
      for (const line of entry.lines) {
        for (const runs of wrapRuns(printedRuns(line), ACTION_WIDTH)) {
          lines.push({ row, col: ACTION_COL + Math.floor((ACTION_WIDTH - displayWidth(plainText(runs))) / 2), runs });
          row += 1;
        }
      }
      row += 1;
    }
  }

  const bottomRow = totalRows - BOTTOM_MARGIN_ROWS - 1;
  const leftEntries = screenplay.titlePage.filter((entry) => leftKeys.includes(entry.key));
  const rightEntries = screenplay.titlePage.filter((entry) => !centerKeys.includes(entry.key) && !leftKeys.includes(entry.key));
  const stack = (entries: typeof leftEntries, col: (runs: RunLine) => number): void => {
    const wrapped = entries.flatMap((entry, index) => [
      ...(index > 0 ? [null] : []),
      ...entry.lines.flatMap((line) => wrapRuns(printedRuns(line), 30)),
    ]);
    let current = bottomRow - wrapped.length + 1;
    for (const runs of wrapped) {
      if (runs) lines.push({ row: current, col: col(runs), runs });
      current += 1;
    }
  };
  stack(leftEntries, () => ACTION_COL);
  stack(rightEntries, (runs) => RIGHT_EDGE_COL - displayWidth(plainText(runs)));
  return lines;
}

/** A line's runs without notes (never printed). */
function printedRuns(runs: RunLine): RunLine {
  return runs.filter((run) => !run.note);
}

/** The same runs, italic. */
function italic(runs: RunLine): RunLine {
  return runs.map((run) => ({ ...run, italic: true as const }));
}

/**
 * The printed width of text in monospaced cells: one per character,
 * combining marks taking none.
 *
 * @param text - The text.
 * @returns Its width in character cells.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text.normalize('NFC')) if (!/\p{M}/u.test(char)) width += 1;
  return width;
}

/**
 * Word-wrap styled runs to a width in character cells. Words longer than the
 * width are broken. Leading and trailing spaces of each wrapped line are dropped.
 *
 * @param runs - The runs of one line.
 * @param width - The maximum width in cells.
 * @returns The wrapped lines; one empty line for empty input.
 */
export function wrapRuns(runs: RunLine, width: number): RunLine[] {
  // Split into words (with their trailing spaces) that keep their run's style.
  const pieces: TextRun[] = [];
  for (const run of runs) {
    for (const part of run.text.normalize('NFC').match(/\S+\s*|\s+/g) ?? []) pieces.push({ ...run, text: part });
  }
  const lines: RunLine[] = [];
  let line: TextRun[] = [];
  let lineWidth = 0;
  const flush = (): void => {
    lines.push(trimLine(line));
    line = [];
    lineWidth = 0;
  };
  for (const piece of pieces) {
    const word = piece.text.trimEnd();
    const wordWidth = displayWidth(word);
    if (lineWidth > 0 && lineWidth + wordWidth > width) flush();
    if (wordWidth > width) {
      // Break an over-long word across lines.
      let remaining = Array.from(piece.text);
      while (remaining.length > 0) {
        const room = width - lineWidth;
        const chunk = remaining.slice(0, room).join('');
        appendRun(line, { ...piece, text: chunk });
        lineWidth += displayWidth(chunk);
        remaining = remaining.slice(room);
        if (remaining.length > 0) flush();
      }
      continue;
    }
    appendRun(line, piece);
    lineWidth += displayWidth(piece.text);
  }
  if (line.length > 0 || lines.length === 0) flush();
  return lines;
}

/** Append a piece, merging it with the previous run when the styling matches. */
function appendRun(line: TextRun[], piece: TextRun): void {
  const last = line[line.length - 1];
  if (last && last.bold === piece.bold && last.italic === piece.italic && last.underline === piece.underline && last.note === piece.note) {
    last.text += piece.text;
  } else {
    line.push({ ...piece });
  }
}

/** Drop leading and trailing spaces from a wrapped line, and any runs left empty. */
function trimLine(line: TextRun[]): RunLine {
  const result = line.map((run) => ({ ...run }));
  if (result.length > 0) {
    result[0].text = result[0].text.trimStart();
    result[result.length - 1].text = result[result.length - 1].text.trimEnd();
  }
  return result.filter((run) => run.text !== '');
}
