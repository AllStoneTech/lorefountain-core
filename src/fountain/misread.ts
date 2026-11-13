/**
 * Convention lines that standard Fountain reads as a character cue (Core
 * ADR-0002). Fountain treats an all-caps line with a blank line (or the start
 * of the script) above it and text directly under it as a speaker, so a stacked
 * `SHOT: CLOSE-UP` / `POSE: ...` block prints in other Fountain apps as SHOT
 * speaking a line. LoreFountain itself still reads such lines as convention
 * lines (`shots/scanScript.ts`); this module only finds them so the writer can
 * make the script standard.
 *
 * Exports {@link findMisreadConventionLines}, {@link MisreadConventionLine} and
 * {@link bodyStart} (where the script body starts, after any title page).
 *
 * Gotchas:
 * - A forced line (`!SHOT: ...`) is action in every Fountain 1.1 app, so it is
 *   never reported. Neither is a line with any lowercase letter.
 * - Boneyard text is hidden from Fountain, so it is blanked before scanning: a
 *   line inside one is never reported, and a boneyard counts as blank space.
 * - A first block that opens with a standard title-page key (`Title:`,
 *   `Credit:`, ...) is the title page, so that block is skipped. Like
 *   `fountain-js`, any other opening `Key:` line is body text.
 */

import { blankBoneyard } from './boneyard';
import { matchComicLine, matchPrefixLine } from './conventions';

/** One convention line Fountain would read as a character cue. */
export interface MisreadConventionLine {
  /** 0-based line number. */
  line: number;
  /** The line's text, trimmed. */
  text: string;
}

/** Options for {@link findMisreadConventionLines}. */
export interface MisreadOptions {
  /** Check the prefix lines (`SHOT:`, `SFX:`, ...). On by default. */
  prefix?: boolean;
  /** Check the comic convention's `PAGE:`, `PANEL:`, `LAYOUT:` and `CAPTION:` lines. Off by default, matching `scanScript`. */
  comic?: boolean;
  /** The first 0-based line to check. Defaults to the line after the title page, if there is one. */
  fromLine?: number;
}

/**
 * The opening line of a title page, as `fountain-js` detects one: a standard
 * key. A script that opens with any other `Key:` line (`SHOT: WIDE`) has no
 * title page, so that line can be a character cue.
 */
const TITLE_PAGE_START = /^\s*(?:title|credit|authors?|source|notes|draft ?date|date|contact|copyright|revisions?):/i;

/**
 * Find every convention line that standard Fountain reads as a character cue:
 * no lowercase letter, not forced with `!`, a blank line or the script start
 * above it, and a non-blank line directly under it.
 *
 * @param scriptText - The `.fountain` file's full text.
 * @param options - Which keywords to check and where to start; see {@link MisreadOptions}.
 * @returns The misread lines, in document order.
 */
export function findMisreadConventionLines(scriptText: string, options: MisreadOptions = {}): MisreadConventionLine[] {
  const lines = blankBoneyard(scriptText).split(/\r\n|\r|\n/);
  const isBlank = (index: number): boolean => (lines[index] ?? '').trim() === '';
  const match = (text: string): { forced: boolean } | undefined =>
    (options.comic ? matchComicLine(text) : undefined) ?? (options.prefix === false ? undefined : matchPrefixLine(text));

  const found: MisreadConventionLine[] = [];
  for (let index = options.fromLine ?? bodyStart(lines); index < lines.length; index += 1) {
    const text = lines[index];
    const convention = match(text);
    if (!convention || convention.forced || /\p{Ll}/u.test(text)) continue;
    if (!(index === 0 || isBlank(index - 1))) continue;
    if (index + 1 >= lines.length || isBlank(index + 1)) continue;
    found.push({ line: index, text: text.trim() });
  }
  return found;
}

/**
 * The first line after the title page: the line after the first blank line
 * when the script opens with a standard title-page key, otherwise 0.
 *
 * @param lines - The script's physical lines, boneyard blanked.
 * @returns The 0-based line where the script body starts.
 */
export function bodyStart(lines: readonly string[]): number {
  if (!TITLE_PAGE_START.test(lines[0] ?? '')) return 0;
  const firstBlank = lines.findIndex((line) => line.trim() === '');
  return firstBlank === -1 ? lines.length : firstBlank + 1;
}
