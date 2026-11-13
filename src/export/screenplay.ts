/**
 * The screenplay document model every non-Fountain export writer reads (Core
 * ADR-0006, section 4): a title page and a list of elements, each element's
 * text as styled runs.
 *
 * Exports {@link buildScreenplay}, {@link parseInline}, {@link shieldEscapes},
 * {@link plainText} and the model types.
 *
 * Gotchas:
 * - Build it from {@link filterScript}'s output: the model includes whatever
 *   the text holds, and the filter is what applies the export options.
 * - Backslash escapes (`\*`, `\_`, `\\`) are shielded before parsing, because
 *   `fountain-js` drops the backslash and an escaped `*word*` would otherwise
 *   become italic.
 * - Emphasis never crosses a line break (Fountain spec), so each line is
 *   parsed on its own. A note is a run with `note: true`; a writer that
 *   doesn't print notes skips those runs.
 * - Convention lines stay action lines, tagged with their keyword, so a writer
 *   can treat them specially (Final Draft's Shot paragraph for `SHOT:`).
 */

import { matchComicLine, matchPrefixLine, type ComicKeyword, type PrefixKeyword } from '../fountain/conventions';
import { parseFountain, type FountainToken } from '../fountain/parse';
import { parseCharacterCue } from '../shots/scanScript';

/** One piece of text with its styling. */
export interface TextRun {
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  /** Text from a `[[note]]`; not part of the printed script. */
  note?: true;
}

/** One printed line: its runs, in order. */
export type RunLine = TextRun[];

/** One line of an action block. */
export interface ActionLine {
  runs: RunLine;
  /** The convention keyword when the line is a LoreFountain convention line (`SHOT`, `SFX`, ...). */
  convention?: PrefixKeyword | ComicKeyword;
}

/** One part of a speech, in order. */
export type SpeechPart =
  | { kind: 'parenthetical'; runs: RunLine }
  | { kind: 'dialogue'; lines: RunLine[] }
  | { kind: 'lyric'; lines: RunLine[] };

/** A character cue and everything said under it. */
export interface DialogueBlock {
  /** The cue as written, extensions and `(CONT'D)` included, without `@` or `^`. */
  cue: RunLine;
  /** The bare character name. */
  name: string;
  /** Cue-line extensions without `CONT'D`, e.g. `V.O.`. */
  extensions: string[];
  parts: SpeechPart[];
}

/** One element of the script body. */
export type ScreenplayElement =
  | { kind: 'scene-heading'; runs: RunLine; number?: string }
  | { kind: 'action'; lines: ActionLine[] }
  | { kind: 'dialogue'; block: DialogueBlock }
  | { kind: 'dual-dialogue'; left: DialogueBlock; right: DialogueBlock }
  | { kind: 'lyric'; lines: RunLine[] }
  | { kind: 'transition'; runs: RunLine }
  | { kind: 'centered'; lines: RunLine[] }
  | { kind: 'page-break' }
  | { kind: 'section'; depth: number; text: string }
  | { kind: 'synopsis'; text: string }
  | { kind: 'note'; lines: RunLine[] };

/** One title-page entry. */
export interface TitlePageEntry {
  /** The key as `fountain-js` reports it, lowercased with underscores: `title`, `draft_date`, `production_code`. */
  key: string;
  /** A readable label: `Title`, `Draft date`, `Production Code`. */
  label: string;
  lines: RunLine[];
}

/** A whole script, ready for a writer. */
export interface Screenplay {
  titlePage: TitlePageEntry[];
  elements: ScreenplayElement[];
}

/** Private Use Area stand-ins for escaped characters: same meaning, invisible to `fountain-js`. */
const ESCAPES: readonly (readonly [string, string])[] = [
  ['\\\\', ''],
  ['\\*', ''],
  ['\\_', ''],
];

/** Readable labels for the standard title-page keys. */
const TITLE_LABELS: Readonly<Record<string, string>> = {
  title: 'Title',
  credit: 'Credit',
  author: 'Author',
  authors: 'Authors',
  source: 'Source',
  notes: 'Notes',
  draft_date: 'Draft date',
  date: 'Date',
  contact: 'Contact',
  copyright: 'Copyright',
  revision: 'Revision',
  revisions: 'Revisions',
  order: 'Order',
  production_code: 'Production Code',
};

/**
 * Build the screenplay model from (filtered) Fountain text.
 *
 * @param fountainText - Standard Fountain text, normally {@link filterScript}'s output.
 * @returns The title page and body elements.
 */
export function buildScreenplay(fountainText: string): Screenplay {
  const tokens = parseFountain(shieldEscapes(fountainText));

  const titlePage: TitlePageEntry[] = [];
  const elements: ScreenplayElement[] = [];
  let open: { block: DialogueBlock; dual?: string } | undefined;
  let pendingLeft: DialogueBlock | undefined;

  const closeBlock = (): void => {
    if (!open) return;
    const { block, dual } = open;
    open = undefined;
    if (dual === 'left') {
      pendingLeft = block;
      return;
    }
    if (dual === 'right' && pendingLeft) {
      elements.push({ kind: 'dual-dialogue', left: pendingLeft, right: block });
      pendingLeft = undefined;
      return;
    }
    flushPendingLeft();
    elements.push({ kind: 'dialogue', block });
  };
  const flushPendingLeft = (): void => {
    if (pendingLeft) elements.push({ kind: 'dialogue', block: pendingLeft });
    pendingLeft = undefined;
  };

  for (const token of tokens) {
    const text = token.text ?? '';
    if (token.is_title) {
      titlePage.push({ key: token.type, label: titleLabel(token.type), lines: linesOf(text) });
      continue;
    }
    switch (token.type) {
      case 'dialogue_begin':
        open = { block: { cue: [], name: '', extensions: [], parts: [] }, dual: (token as FountainToken & { dual?: string }).dual };
        break;
      case 'character': {
        if (!open) open = { block: { cue: [], name: '', extensions: [], parts: [] } };
        const { name, extensions } = parseCharacterCue(unshield(text));
        open.block.cue = parseInline(text.replace(/^\s*@/, '').trim());
        open.block.name = name;
        open.block.extensions = extensions;
        break;
      }
      case 'parenthetical':
        open?.block.parts.push({ kind: 'parenthetical', runs: parseInline(text.trim()) });
        break;
      case 'dialogue':
        open?.block.parts.push({ kind: 'dialogue', lines: linesOf(text) });
        break;
      case 'lyrics':
        if (open) open.block.parts.push({ kind: 'lyric', lines: linesOf(text) });
        else pushBody({ kind: 'lyric', lines: linesOf(text) });
        break;
      case 'dialogue_end':
        closeBlock();
        break;
      case 'dual_dialogue_begin':
      case 'dual_dialogue_end':
      case 'spaces':
        break;
      case 'scene_heading':
        pushBody({ kind: 'scene-heading', runs: parseInline(text.trim()), ...(token.scene_number ? { number: token.scene_number } : {}) });
        break;
      case 'action':
        pushBody(actionElement(text));
        break;
      case 'transition':
        pushBody({ kind: 'transition', runs: parseInline(text.trim()) });
        break;
      case 'centered':
        pushBody({ kind: 'centered', lines: linesOf(text) });
        break;
      case 'page_break':
        pushBody({ kind: 'page-break' });
        break;
      case 'section':
        pushBody({ kind: 'section', depth: token.depth ?? 1, text: unshield(text.trim()) });
        break;
      case 'synopsis':
        pushBody({ kind: 'synopsis', text: unshield(text.trim()) });
        break;
      case 'note':
        pushBody({ kind: 'note', lines: linesOf(text).map((line) => line.map((run) => ({ ...run, note: true as const }))) });
        break;
      default:
        break;
    }
  }
  closeBlock();
  flushPendingLeft();
  return { titlePage, elements };

  function pushBody(element: ScreenplayElement): void {
    flushPendingLeft();
    elements.push(element);
  }
}

/**
 * Replace backslash escapes (`\*`, `\_`, `\\`) with private stand-ins that
 * `fountain-js` and emphasis parsing ignore. {@link parseInline} turns them
 * back into the literal characters.
 *
 * @param text - Fountain text.
 * @returns The text with every escape shielded.
 */
export function shieldEscapes(text: string): string {
  let shielded = text;
  for (const [escape, stand] of ESCAPES) shielded = shielded.split(escape).join(stand);
  return shielded;
}

/**
 * Build an action element. A block that is wholly one `[[note]]` becomes a
 * note element, since `fountain-js` reads a multi-line note as action.
 */
function actionElement(text: string): ScreenplayElement {
  const trimmed = text.trim();
  if (/^\[\[[\s\S]*\]\]$/.test(trimmed) && !trimmed.slice(2, -2).includes(']]')) {
    return { kind: 'note', lines: trimmed.slice(2, -2).split('\n').map((line) => [{ text: unshield(line.trim()), note: true as const }]) };
  }
  return {
    kind: 'action',
    lines: text.split('\n').map((line) => {
      const convention = matchComicLine(line) ?? matchPrefixLine(line);
      return { runs: parseInline(line), ...(convention ? { convention: convention.keyword } : {}) };
    }),
  };
}

/** Parse each line of a token's text into runs. */
function linesOf(text: string): RunLine[] {
  return text.split('\n').map((line) => parseInline(line.trim()));
}

/** Inline style flags carried down while parsing nested markup. */
interface InlineStyle {
  bold?: true;
  italic?: true;
  underline?: true;
  note?: true;
}

/** Inline markup, in priority order when two start at the same place. */
const INLINE_PATTERNS: readonly { pattern: RegExp; style: InlineStyle; marker: number }[] = [
  { pattern: /\[\[(.+?)\]\]/, style: { note: true }, marker: 2 },
  { pattern: /\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*/, style: { bold: true, italic: true }, marker: 3 },
  { pattern: /\*\*(?!\s)(.+?)(?<!\s)\*\*/, style: { bold: true }, marker: 2 },
  { pattern: /\*(?!\s)(.+?)(?<!\s)\*/, style: { italic: true }, marker: 1 },
  { pattern: /_(?!\s)(.+?)(?<!\s)_/, style: { underline: true }, marker: 1 },
];

/**
 * Parse one line of Fountain text into styled runs: `***bold italic***`,
 * `**bold**`, `*italic*`, `_underline_` (nesting allowed) and `[[notes]]`.
 * Escaped characters (shielded by {@link buildScreenplay}) come back as
 * literal text.
 *
 * @param line - One line of text, without line breaks.
 * @param style - Styling inherited from enclosing markup.
 * @returns The runs, with adjacent runs of the same style merged.
 */
export function parseInline(line: string, style: InlineStyle = {}): RunLine {
  const runs: RunLine = [];
  let rest = line;
  while (rest.length > 0) {
    let best: { index: number; length: number; inner: string; style: InlineStyle } | undefined;
    for (const { pattern, style: added } of INLINE_PATTERNS) {
      const match = pattern.exec(rest);
      if (match && (best === undefined || match.index < best.index)) {
        best = { index: match.index, length: match[0].length, inner: match[1], style: added };
      }
    }
    if (!best) {
      pushRun(runs, { text: unshield(rest), ...style });
      break;
    }
    if (best.index > 0) pushRun(runs, { text: unshield(rest.slice(0, best.index)), ...style });
    for (const run of parseInline(best.inner, { ...style, ...best.style })) pushRun(runs, run);
    rest = rest.slice(best.index + best.length);
  }
  return runs;
}

/** Append a run, merging it into the previous one when the styling matches. */
function pushRun(runs: RunLine, run: TextRun): void {
  if (run.text === '') return;
  const last = runs[runs.length - 1];
  if (last && last.bold === run.bold && last.italic === run.italic && last.underline === run.underline && last.note === run.note) {
    last.text += run.text;
  } else {
    runs.push(run);
  }
}

/** Turn shielded escape stand-ins back into the literal characters they stand for. */
function unshield(text: string): string {
  return text.replace(//g, '\\').replace(//g, '*').replace(//g, '_');
}

/** A readable label for a title-page key. */
function titleLabel(key: string): string {
  return TITLE_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (first) => first.toUpperCase());
}

/**
 * The plain text of a line of runs, notes left out.
 *
 * @param line - The runs.
 * @returns The concatenated text of every non-note run.
 */
export function plainText(line: RunLine): string {
  return line
    .filter((run) => !run.note)
    .map((run) => run.text)
    .join('');
}
