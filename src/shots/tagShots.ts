/**
 * Planning "Tag all shots": generated `[tag]` handles for `SHOT:` lines that
 * have none. Pure text in, edits out; the `vscode` glue lives in
 * LoreFountain-VSCE.
 *
 * Exports {@link planShotTags} and {@link applyShotTags}. A generated tag is an
 * ID, not a position: `<production code>-<scene>-<shot>` such as `1x03-04-02`.
 * It is derived from where the shot is when it is first tagged, then written
 * into the script and never recomputed, so inserting a shot later never
 * renumbers an existing tag.
 *
 * Rules:
 * - An existing tag is never overwritten or touched.
 * - A generated tag is never a duplicate within the script, nor of any tag in
 *   `reserved`. On a clash the shot number counts up to the next free one, so
 *   a shot inserted between two tagged shots gets a fresh number rather than
 *   renumbering its neighbours.
 * - Without a usable prefix (no production code or slug) nothing is
 *   generated and every untagged shot is reported as skipped.
 * - Only the tag is inserted, right after `SHOT:`. No other character changes.
 * - Idempotent: a second run finds nothing untagged and plans nothing.
 */

import { ASSET_TAG_BODY } from '../fountain/conventions';
import { parseShotText } from './parseShots';
import { scanScript } from './scanScript';

/** One planned tag insertion. */
export interface ShotTagEdit {
  /** 0-based line of the `SHOT:` line. */
  line: number;
  /** 0-based character offset where `[tag] ` is inserted (right after `SHOT:` and its following spaces). */
  character: number;
  /** The text to insert, including the trailing space when the line has a description. */
  insert: string;
  /** The generated tag, without brackets. */
  tag: string;
}

/** A shot left untagged, with why. */
export interface SkippedShot {
  line: number;
  reason: string;
}

/** Result of {@link planShotTags}. */
export interface ShotTagPlan {
  edits: ShotTagEdit[];
  skipped: SkippedShot[];
}

/** The slug shape every tag and prefix must have. */
const TAG_SLUG = new RegExp(`^${ASSET_TAG_BODY}$`);
/** `SHOT:` at the start of a line, optionally forced with `!`, with the whitespace after it. */
const SHOT_PREFIX = /^[ \t]*!?SHOT:[ \t]*/;

/**
 * Plan tags for every untagged `SHOT:` line in a script.
 *
 * @param scriptText - The script's full text.
 * @param prefix - The production code (or file slug) the tags start with, already lowercase; `undefined` when none is usable.
 * @param reserved - Tags already used elsewhere in the project, which must not be reused.
 * @returns The edits (in line order) and the shots that were skipped.
 */
export function planShotTags(scriptText: string, prefix: string | undefined, reserved: ReadonlySet<string> = new Set()): ShotTagPlan {
  const lines = scriptText.split(/\r\n|\r|\n/);
  const used = new Set<string>(reserved);
  const untagged: Array<{ line: number; scene: number; shot: number; hasText: boolean }> = [];
  let scene = 0;
  let shot = 0;

  for (const item of scanScript(scriptText)) {
    if (item.kind === 'heading') {
      scene += 1;
      shot = 0;
    } else if (item.kind === 'directive' && item.keyword === 'SHOT') {
      shot += 1;
      const { tag, description } = parseShotText(item.rest);
      if (tag !== undefined) used.add(tag);
      else untagged.push({ line: item.line, scene, shot, hasText: description !== '' });
    }
  }

  const plan: ShotTagPlan = { edits: [], skipped: [] };
  if (prefix === undefined || !TAG_SLUG.test(prefix)) {
    for (const entry of untagged) plan.skipped.push({ line: entry.line, reason: 'the script has no Production Code (or file name) to build a tag from' });
    return plan;
  }

  for (const entry of untagged) {
    const match = SHOT_PREFIX.exec(lines[entry.line] ?? '');
    if (!match) {
      plan.skipped.push({ line: entry.line, reason: 'the SHOT: line could not be located' });
      continue;
    }
    let number = entry.shot;
    let tag = formatTag(prefix, entry.scene, number);
    while (used.has(tag)) {
      number += 1;
      tag = formatTag(prefix, entry.scene, number);
    }
    used.add(tag);
    // `SHOT:WIDE` / bare `SHOT:` have no space after the colon; add one so the line reads `SHOT: [tag] WIDE`.
    const lead = /[ \t]$/.test(match[0]) ? '' : ' ';
    plan.edits.push({ line: entry.line, character: match[0].length, insert: `${lead}[${tag}]${entry.hasText ? ' ' : ''}`, tag });
  }
  return plan;
}

/**
 * Apply a plan's edits to the script text.
 *
 * @param scriptText - The text the plan was made from.
 * @param plan - The plan from {@link planShotTags}.
 * @returns The text with every planned tag inserted.
 */
export function applyShotTags(scriptText: string, plan: ShotTagPlan): string {
  // Work on character offsets so every line ending (even mixed ones) is left exactly as written.
  const lineStarts = [0];
  for (const match of scriptText.matchAll(/\r\n|\r|\n/g)) lineStarts.push(match.index + match[0].length);
  let result = scriptText;
  for (const edit of [...plan.edits].sort((a, b) => b.line - a.line)) {
    const offset = (lineStarts[edit.line] ?? 0) + edit.character;
    result = result.slice(0, offset) + edit.insert + result.slice(offset);
  }
  return result;
}

/** `1x03` + scene 4 + shot 2 → `1x03-04-02`. Numbers are at least two digits, never truncated. */
function formatTag(prefix: string, scene: number, shot: number): string {
  return `${prefix}-${String(scene).padStart(2, '0')}-${String(shot).padStart(2, '0')}`;
}
