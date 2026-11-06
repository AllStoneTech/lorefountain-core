/**
 * Fingerprints of the script text an asset was made from, so an accepted
 * take can be marked stale when that text changes (Producer spec, "Stale
 * assets"). Both products compute them here, so LoreFountain can warn at
 * the moment of editing and the Producer agrees on what's stale.
 *
 * Exports {@link fingerprintText}, {@link shotSourceText},
 * {@link spokenLinesOf}, {@link lineSourceText} and {@link cueSourceText}.
 *
 * Gotchas:
 * - A shot's picture depends on its `SHOT:`, `POSE:` and `LIGHT:` text and
 *   its action, not on the dialogue over it.
 * - A line's recording depends on its speaker, words and the directions
 *   written for that speech. Whitespace is collapsed first, so re-wrapping
 *   a line doesn't make its recording stale.
 * - Changing these inputs changes every fingerprint, which marks every take
 *   stale. Treat them as part of the published format.
 */

import { createHash } from 'node:crypto';
import type { CueEntry } from '../cues/parseCues';
import type { ShotMapEntry, SpeakerDirection, SpokenLine } from '../shots/shotMap';

/** One spoken line in a shot, with its position and the directions written for it. */
export interface ShotSpokenLine {
  /** 1-based position among the shot's spoken lines (directions, pauses and lyrics aren't counted). */
  index: number;
  line: SpokenLine;
  /** Non-pause parentheticals by the same speaker, written since the previous spoken line, as written. */
  directions: string[];
}

/**
 * Fingerprint a piece of text: `sha256-` and the hex digest of its UTF-8 bytes.
 *
 * @param text - The text to fingerprint.
 * @returns The fingerprint.
 */
export function fingerprintText(text: string): string {
  return `sha256-${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * The text a shot's picture is made from: its `SHOT:` description, `POSE:`,
 * `LIGHT:` and action blocks, one per line, whitespace collapsed.
 *
 * @param shot - A shot from the shot map.
 * @returns The source text to fingerprint.
 */
export function shotSourceText(shot: ShotMapEntry): string {
  return [
    `shot: ${collapse(shot.description ?? '')}`,
    `pose: ${collapse(shot.pose ?? '')}`,
    `light: ${collapse(shot.light ?? '')}`,
    ...shot.action.map((block) => `action: ${collapse(block.text)}`),
  ].join('\n');
}

/**
 * The spoken lines in a shot, numbered, each with its directions. This is
 * the numbering per-line recordings use (`<shot-tag>.<index>.wav`).
 *
 * @param shot - A shot from the shot map.
 * @returns The shot's spoken lines in order.
 */
export function spokenLinesOf(shot: ShotMapEntry): ShotSpokenLine[] {
  const lines: ShotSpokenLine[] = [];
  let pending: SpeakerDirection[] = [];
  for (const item of shot.spoken) {
    if ('direction' in item && !('pause' in item)) {
      pending.push(item);
      continue;
    }
    if (!('text' in item && 'speaker' in item)) continue;
    lines.push({
      index: lines.length + 1,
      line: item,
      directions: pending.filter((direction) => direction.speaker === item.speaker).map((direction) => direction.direction),
    });
    pending = [];
  }
  return lines;
}

/**
 * The text a spoken line's recording is made from: speaker, directions and
 * words, whitespace collapsed.
 *
 * @param spoken - A spoken line from {@link spokenLinesOf}.
 * @returns The source text to fingerprint.
 */
export function lineSourceText(spoken: ShotSpokenLine): string {
  return [
    `speaker: ${collapse(spoken.line.speaker)}`,
    `directions: ${spoken.directions.map(collapse).join(' ')}`,
    `text: ${collapse(spoken.line.text)}`,
  ].join('\n');
}

/**
 * The text a cue's sound is made from: its type, music role and timing,
 * and description, whitespace collapsed.
 *
 * @param cue - A cue from `extractCues`.
 * @returns The source text to fingerprint.
 */
export function cueSourceText(cue: CueEntry): string {
  return [cue.type, cue.role ?? '', cue.timing ?? '', collapse(cue.description)].join('\n');
}

/** Collapse runs of whitespace and trim. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
