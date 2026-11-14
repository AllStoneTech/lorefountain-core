/**
 * The export filter (Core ADR-0006, section 3): a script's text with what the
 * export leaves out removed, as standard Fountain. The `.fountain` export is
 * this text; every other format parses it into the screenplay model.
 *
 * Exports {@link filterScript} and {@link FilterResult}.
 *
 * Rules:
 * - Whole physical lines are removed; other lines are never edited, except to
 *   drop a `[tag]`, remove an inline note or boneyard span, renumber a scene
 *   heading, or add the `!` below.
 * - A line that only held removed material disappears with its line break,
 *   so a speech never gains a blank line (which would end it). A run of blank
 *   lines that a removal leaves behind collapses to one.
 * - Convention lines inside a kept boneyard are cut material, so they are
 *   left exactly as written.
 * - A kept convention line that standard Fountain would read as a character
 *   cue gets a leading `!` (Core ADR-0005), so the output is standard even if
 *   the writer never fixed the warning.
 *
 * Gotchas:
 * - Line breaks in the output match the input's first line break style.
 * - Scene headings are found with `fountain-js`'s own rule plus the spec's
 *   blank line before and after; a forced `.HEADING` counts.
 */

import { BONEYARD } from '../fountain/boneyard';
import { matchComicLine, matchPrefixLine, type ComicKeyword, type PrefixKeyword } from '../fountain/conventions';
import { bodyStart, findMisreadConventionLines } from '../fountain/misread';
import type { ExportContent } from './options';

/** Result of {@link filterScript}. */
export interface FilterResult {
  /** The filtered script, standard Fountain. */
  text: string;
  /** How many convention lines were removed. */
  removedConventionLines: number;
  /** How many `!` marks were added to keep convention lines from reading as character cues. */
  forcedLines: number;
}

/** LoreFountain's own title-page keys, which other Fountain apps ignore. */
const LOREFOUNTAIN_TITLE_KEY = /^\s*(?:order|production code)\s*:/i;

/** A title-page continuation line: indented three spaces or a tab. */
const TITLE_CONTINUATION = /^(?: {3,}|\t)/;

/** A leading `[tag]` right after a keyword that takes one. Group 1 is everything before the tag. */
const TAGGED_LINE = /^([ \t]*!?(?:SHOT|SFX|MUSIC|AMB|SUPER|TITLE CARD|CHYRON):[ \t]*)\[[a-z0-9]+(?:-[a-z0-9]+)*\][ \t]*/;

/** An inline note, which never crosses a blank line. */
const NOTE_SPAN = /\[\[(?:(?!\n[ \t]*\n)[\s\S])*?\]\]/g;

/** `fountain-js`'s scene heading rule (case-insensitive), forced `.HEADING` included. */
const SCENE_HEADING = /^\s*(?:(?:\*{0,3}_?)?(?:(?:int|i)\.?\/(?:ext|e)|int|ext|est)[. ].+$|\.(?!\.+)\S.*$)/i;

/** A scene number at the end of a heading, with the space before it. */
const SCENE_NUMBER = /\s*#[\w.-]+?#\s*$/;

/** A section line. */
const SECTION = /^\s*#/;

/** A synopsis line (not a `===` page break). */
const SYNOPSIS = /^\s*=(?!=)/;

/** Which content flag decides whether a convention keyword is kept. */
const KEYWORD_GROUP: Readonly<Record<PrefixKeyword | ComicKeyword, keyof ExportContent | null>> = {
  // On-screen text is ordinary screenplay action ("SUPER: Richmond, 1894"), so it is never removed; only its [tag] is.
  SUPER: null,
  'TITLE CARD': null,
  CHYRON: null,
  SHOT: 'shots',
  POSE: 'shots',
  LIGHT: 'shots',
  DURATION: 'shots',
  PAUSE: 'pauses',
  SFX: 'sound',
  MUSIC: 'sound',
  AMB: 'sound',
  PAGE: 'comic',
  PANEL: 'comic',
  LAYOUT: 'comic',
  CAPTION: 'comic',
  // A panel's camera move for a narrated comic (ADR-0003): production direction, like DURATION:.
  MOVE: 'shots',
};

/** A line slot during filtering: its text, or `null` once removed. */
type Slot = string | null;

/**
 * Filter a script's text for export.
 *
 * @param scriptText - The `.fountain` file's full text.
 * @param content - What the export includes.
 * @returns The filtered, standard Fountain text and counts of what changed.
 */
export function filterScript(scriptText: string, content: ExportContent): FilterResult {
  const eol = /\r\n|\r|\n/.exec(scriptText)?.[0] ?? '\n';
  const normalized = scriptText.replace(/\r\n|\r/g, '\n');

  // 1. Boneyard: removed (with lines that held only boneyard), or kept and shielded from every later rule.
  const boneyardMask = maskOf(normalized, BONEYARD);
  let slots: Slot[];
  let shielded: boolean[];
  if (content.boneyard) {
    slots = normalized.split('\n');
    shielded = lineMask(normalized, boneyardMask);
  } else {
    slots = removeMasked(normalized, boneyardMask);
    shielded = slots.map(() => false);
  }

  // 2. Notes, the same way.
  if (!content.notes) {
    const before = slots;
    const joined = before.map((slot) => slot ?? '').join('\n');
    const noteMask = maskOf(joined, NOTE_SPAN);
    const removed = removeMasked(joined, noteMask);
    // `removeMasked` keeps one slot per line, so earlier removals stay removed.
    slots = removed.map((slot, index) => (before[index] === null ? null : slot));
  }

  // 3. Title page keys.
  const titleEnd = bodyStart(slots.map((slot) => slot ?? ''));
  if (!content.loreFountainTitleKeys) {
    let removingKey = false;
    for (let index = 0; index < titleEnd; index += 1) {
      const slot = slots[index];
      if (slot === null) continue;
      if (TITLE_CONTINUATION.test(slot) && slot.trim() !== '') {
        if (removingKey) slots[index] = null;
        continue;
      }
      removingKey = LOREFOUNTAIN_TITLE_KEY.test(slot);
      if (removingKey) slots[index] = null;
    }
  }

  // 4. Convention lines, sections and synopses in the body.
  let removedConventionLines = 0;
  for (let index = titleEnd; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot === null || shielded[index]) continue;
    const convention = matchComicLine(slot) ?? matchPrefixLine(slot);
    if (convention) {
      const group = KEYWORD_GROUP[convention.keyword];
      if (group !== null && !content[group]) {
        slots[index] = null;
        removedConventionLines += 1;
      } else if (!content.tags) {
        slots[index] = slot.replace(TAGGED_LINE, '$1');
      }
      continue;
    }
    if ((!content.sections && SECTION.test(slot)) || (!content.synopses && SYNOPSIS.test(slot))) {
      slots[index] = null;
    }
  }

  // 5. Scene numbers.
  if (content.sceneNumbers !== 'as-written') {
    let scene = 0;
    for (let index = titleEnd; index < slots.length; index += 1) {
      const slot = slots[index];
      if (slot === null || shielded[index] || !isSceneHeading(slots, index)) continue;
      scene += 1;
      const bare = slot.replace(SCENE_NUMBER, '');
      slots[index] = content.sceneNumbers === 'auto' ? `${bare} #${scene}#` : bare;
    }
  }

  // 6. Drop removed lines, collapsing the blank runs they leave.
  const lines = collapse(slots);

  // 7. Force kept convention lines that would read as character cues.
  const joined = lines.join('\n');
  const misread = findMisreadConventionLines(joined, { comic: true });
  for (const { line } of misread) {
    const text = lines[line];
    const indent = text.length - text.trimStart().length;
    lines[line] = `${text.slice(0, indent)}!${text.slice(indent)}`;
  }

  return { text: lines.join(eol), removedConventionLines, forcedLines: misread.length };
}

/**
 * Mark every character inside a match of `pattern`.
 *
 * @param text - The text, with `\n` line breaks.
 * @param pattern - A global pattern.
 * @returns One flag per character of `text`.
 */
function maskOf(text: string, pattern: RegExp): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
    for (let index = match.index; index < match.index + match[0].length; index += 1) mask[index] = true;
  }
  return mask;
}

/**
 * Which lines have any masked character.
 *
 * @param text - The text, with `\n` line breaks.
 * @param mask - One flag per character.
 * @returns One flag per line.
 */
function lineMask(text: string, mask: readonly boolean[]): boolean[] {
  const result: boolean[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    result.push(mask.slice(offset, offset + line.length).some(Boolean));
    offset += line.length + 1;
  }
  return result;
}

/**
 * Remove masked characters line by line. A line whose only content was
 * masked becomes `null` (removed with its line break); other lines lose just
 * the masked characters.
 *
 * @param text - The text, with `\n` line breaks.
 * @param mask - One flag per character.
 * @returns One slot per line.
 */
function removeMasked(text: string, mask: readonly boolean[]): Slot[] {
  const slots: Slot[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    let kept = '';
    let removedAny = false;
    for (let index = 0; index < line.length; index += 1) {
      if (mask[offset + index]) removedAny = true;
      else kept += line[index];
    }
    slots.push(removedAny && kept.trim() === '' ? null : removedAny ? kept.replace(/[ \t]+$/, '') : line);
    offset += line.length + 1;
  }
  return slots;
}

/**
 * True when the slot at `index` is a scene heading: matches `fountain-js`'s
 * rule, with a blank line (or the start) before and a blank line (or the end)
 * after, skipping removed slots.
 */
function isSceneHeading(slots: readonly Slot[], index: number): boolean {
  if (!SCENE_HEADING.test(slots[index] ?? '')) return false;
  const neighbour = (step: number): string | undefined => {
    for (let current = index + step; current >= 0 && current < slots.length; current += step) {
      const slot = slots[current];
      if (slot !== null) return slot;
    }
    return undefined;
  };
  const before = neighbour(-1);
  const after = neighbour(1);
  return (before === undefined || before.trim() === '') && (after === undefined || after.trim() === '');
}

/**
 * Drop removed slots. Where a removal sits between blank lines (or at the
 * start or end), keep only one blank line.
 *
 * @param slots - Line slots, `null` for removed.
 * @returns The remaining lines.
 */
function collapse(slots: readonly Slot[]): string[] {
  const lines: string[] = [];
  let removedSinceLast = false;
  for (const slot of slots) {
    if (slot === null) {
      removedSinceLast = true;
      continue;
    }
    const blank = slot.trim() === '';
    const previousBlank = lines.length === 0 || lines[lines.length - 1].trim() === '';
    if (blank && removedSinceLast && previousBlank) continue;
    lines.push(slot);
    removedSinceLast = false;
  }
  return lines;
}
