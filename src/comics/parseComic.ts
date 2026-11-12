/**
 * Reads a comic script's structure from raw Fountain text: pages, the panels
 * inside them, and each panel's lettering (balloons, captions, sound
 * effects) in reading order. The comic convention is plain-English prefix
 * lines written as ordinary Fountain action text (ADR-0001 in
 * `docs/DECISIONS.md`): `PAGE:`, `PANEL:`, `CAPTION:`, `LAYOUT:`, plus the
 * existing `SFX:`, `POSE:`, `LIGHT:` and `SHOT:` lines reused inside a
 * panel. Balloons are standard Fountain dialogue.
 *
 * Exports {@link extractComic} (the structure walk), {@link parsePageLine}
 * (a `PAGE:` line's label and modifiers), {@link countWords}, and the
 * structure types. Pure and entity-free: `pageMap.ts` adds entity
 * resolution, counts and validation on top.
 *
 * Gotchas:
 * - Collect and continue, never throw. A `PANEL:` before any `PAGE:` opens an
 *   implicit page (index 0); lettering written before a page's first panel
 *   lands in an implicit panel 0 (reported as `content-outside-panel`).
 *   Dialogue or `SFX:` before any page is ignored: it isn't part of the comic.
 *   A `CAPTION:` is comic-only, so one outside a page is reported.
 * - Scene headings are transparent: they never open or close a page or panel.
 *   A panel records the heading in effect where it opens.
 * - Balloons come from `scanScript`'s dialogue items, so Fountain's own rules
 *   apply (a character cue needs a blank line before it; boneyard is hidden).
 *   Each dialogue item is one balloon; a parenthetical attaches to the next
 *   balloon in its speech, or to the last one when nothing follows.
 */

import { scanScript, type CharacterItem } from '../shots/scanScript';
import type { ValidationIssue } from '../model/errors';

/** A parsed `PAGE:` line. */
export interface PageLabel {
  /** The label as written, without modifiers: `7`, `2-3`, `INSIDE FRONT COVER`. Empty for a bare `PAGE:`. */
  label: string;
  /** The page number, when the label is a number or a range of numbers. */
  number?: number;
  /** The last page of a range label like `2-3`; absent for a single page. */
  endNumber?: number;
  /** Uppercased words from a trailing `(...)` group, split on commas: `SPLASH`, `SPREAD`, `TURN`, or any other. */
  modifiers: string[];
}

/** One block of freeform action text, with its first line. */
export interface ComicAction {
  /** The block's lines, trimmed, joined with `\n`. */
  text: string;
  /** 0-based line of the block's first line. */
  line: number;
}

/** A speech or thought balloon: one run of dialogue. */
export interface BalloonEntry {
  kind: 'balloon';
  /** The character cue name, without extensions or `^`. */
  speaker: string;
  /** The entity id `speaker` resolves to. Set by `buildPageMap`, never by {@link extractComic}. */
  speakerEntity?: string;
  /** Cue-line extensions (`O.P.`, `THOUGHT`, `WHISPER`, ...), in order, with `CONT'D` dropped. */
  extensions: string[];
  /** True when an extension says the speaker is outside the panel's frame (`O.P.` or `O.S.`). */
  offPanel?: true;
  /** True for the second speaker of Fountain dual dialogue (`^`). */
  simultaneous?: true;
  /** Parentheticals that go with this balloon, exactly as written, parentheses included. */
  directions: string[];
  /** The lettered text. */
  text: string;
  line: number;
}

/** A narration or caption box. */
export interface CaptionEntry {
  kind: 'caption';
  /** Who the box speaks as, from `CAPTION (SPEAKER):`. Absent for plain narration. */
  speaker?: string;
  /** The entity id `speaker` resolves to. Set by `buildPageMap`, never by {@link extractComic}. */
  speakerEntity?: string;
  text: string;
  line: number;
}

/** A lettered sound effect (`SFX:`). */
export interface SfxEntry {
  kind: 'sfx';
  /** The lettering (the text after any `[tag]`). */
  text: string;
  /** The `[tag]` shared with audio cues, when written. */
  tag?: string;
  line: number;
}

/** One piece of lettering in a panel. */
export type LetteringEntry = BalloonEntry | CaptionEntry | SfxEntry;

/** One panel, before entity and count enrichment. */
export interface ComicPanel {
  /** 1-based within the page; 0 for the implicit panel holding lettering written before a page's first `PANEL:`. */
  number: number;
  /** The `PANEL:` text. Absent on panel 0. */
  description?: string;
  /** From a `SHOT:` line inside the panel: camera framing for the artist. */
  shot?: string;
  /** From a `LAYOUT:` line inside the panel. */
  layout?: string;
  pose?: string;
  light?: string;
  /** Further action blocks inside the panel: more direction for the artist. */
  action: ComicAction[];
  /** Balloons, captions and sound effects in script (reading) order. */
  lettering: LetteringEntry[];
  /** Scene number (1-based) in effect where the panel opens; 0 before any scene heading. */
  scene: number;
  sceneHeading?: string;
  /** 0-based, inclusive: from the `PANEL:` line to the line before the next panel, page, or the end of the file. */
  lines: { start: number; end: number };
  /** Text whose entity mentions count for this panel (description, pose, light, shot, action, speaker names). */
  mentionText: string[];
}

/** One page, before entity and count enrichment. */
export interface ComicPage extends PageLabel {
  /** 1-based by encounter order; 0 for the implicit page holding panels written before any `PAGE:`. */
  index: number;
  /** True for index 0: there was no `PAGE:` line. */
  implicit?: true;
  /** From a `LAYOUT:` line between the `PAGE:` line and the first panel. */
  layout?: string;
  /** Action text between the `PAGE:` line and the first panel: notes about the page as a whole. */
  notes: ComicAction[];
  panels: ComicPanel[];
  /** 0-based, inclusive: from the `PAGE:` line to the line before the next page, or the end of the file. */
  lines: { start: number; end: number };
}

/** A structural problem found during the walk. */
export interface ComicStructureIssue extends ValidationIssue {
  code: 'panel-before-page' | 'content-outside-panel' | 'missing-page-label';
  severity: 'warning';
  /** 0-based line the issue is on. */
  line: number;
}

/** Result of {@link extractComic}. */
export interface ComicStructure {
  pages: ComicPage[];
  /** True when the script has at least one explicit `PAGE:` line (an implicit page 0 alone doesn't count). */
  hasPages: boolean;
  issues: ComicStructureIssue[];
}

/** A page label that is one number or a range: `7`, `2-3` (hyphen, en dash or em dash). */
const NUMERIC_LABEL = /^(\d+)(?:[ \t]*[-–—][ \t]*(\d+))?$/;

/** A trailing parenthesized group on a `PAGE:` line. */
const TRAILING_GROUP = /^(.*?)[ \t]*\(([^()]*)\)[ \t]*$/;

/** The largest span of a page-range label that is read as a range; anything bigger stays a label with only its first number. */
const MAX_RANGE_SPAN = 99;

/** Cue-line extensions that put the speaker outside the panel's frame. */
const OFF_PANEL_EXTENSIONS = new Set(['O.P.', 'O.S.', 'OP', 'OS', 'OFF-PANEL', 'OFF PANEL', 'OFF-SCREEN']);

/**
 * Parse the text after `PAGE:` into a label, optional number or range, and
 * modifiers.
 *
 * @param rest - The text after `PAGE:`, e.g. `7 (SPLASH)` or `2-3 (SPREAD, TURN)`.
 * @returns The label (modifiers removed), the number or range when the label is numeric, and the uppercased modifiers.
 */
export function parsePageLine(rest: string): PageLabel {
  let text = rest.trim();
  let modifiers: string[] = [];
  const group = TRAILING_GROUP.exec(text);
  if (group) {
    text = group[1].trim();
    modifiers = group[2]
      .split(',')
      .map((word) => word.trim().toUpperCase())
      .filter((word) => word.length > 0);
  }

  const numeric = NUMERIC_LABEL.exec(text);
  if (!numeric) return { label: text, modifiers };

  const number = Number(numeric[1]);
  const end = numeric[2] === undefined ? undefined : Number(numeric[2]);
  if (end !== undefined && end > number && end - number <= MAX_RANGE_SPAN) {
    return { label: text, number, endNumber: end, modifiers };
  }
  return { label: text, number, modifiers };
}

/**
 * Count the words in lettered text: whitespace-separated tokens containing a
 * letter or digit, so a lone dash or ellipsis doesn't count. Fountain notes
 * (`[[...]]`) are hidden from the script and don't count either.
 *
 * @param text - Lettered text (a balloon's or caption's words).
 * @returns The word count.
 */
export function countWords(text: string): number {
  const visible = text.replace(/\[\[[\s\S]*?\]\]/g, ' ');
  return visible.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** Mutable state for one {@link extractComic} walk. */
interface Walk {
  pages: ComicPage[];
  issues: ComicStructureIssue[];
  page?: ComicPage;
  panel?: ComicPanel;
  panelCounter: number;
  pageCounter: number;
  scene: number;
  sceneHeading?: string;
  /** Parentheticals waiting for the next balloon of their speech. */
  pending?: { speaker: CharacterItem; directions: string[] };
  /** The last balloon made, with the speech it came from, so trailing parentheticals can join it. */
  lastBalloon?: { balloon: BalloonEntry; speaker: CharacterItem };
  /** The line of the action line just applied, while the next item could still continue its block. */
  lastActionLine?: number;
  hasPages: boolean;
}

/**
 * Walk a script and extract its pages, panels and lettering.
 *
 * @param scriptText - The `.fountain` file's full text.
 * @returns The pages (including an implicit page 0 when panels precede any `PAGE:`), whether any explicit page exists, and structural issues.
 */
export function extractComic(scriptText: string): ComicStructure {
  const items = scanScript(scriptText, { comic: true });
  const lastLine = lastLineIndex(scriptText);
  const walk: Walk = { pages: [], issues: [], panelCounter: 0, pageCounter: 0, scene: 0, hasPages: false };

  for (const item of items) {
    switch (item.kind) {
      case 'heading':
        walk.scene += 1;
        walk.sceneHeading = item.text;
        walk.lastActionLine = undefined;
        break;

      case 'directive':
        applyDirective(walk, item);
        walk.lastActionLine = undefined;
        break;

      case 'action':
        applyAction(walk, item.text, item.line, item.blockStart);
        break;

      case 'character':
        flushPending(walk);
        walk.lastActionLine = undefined;
        break;

      case 'parenthetical':
        if (walk.pending && walk.pending.speaker === item.speaker) {
          walk.pending.directions.push(item.text);
        } else {
          walk.pending = { speaker: item.speaker, directions: [item.text] };
        }
        walk.lastActionLine = undefined;
        break;

      case 'dialogue':
        applyDialogue(walk, item.speaker, item.text, item.line);
        walk.lastActionLine = undefined;
        break;

      default:
        walk.lastActionLine = undefined;
        break;
    }
  }
  flushPending(walk);
  closePage(walk, lastLine);

  return { pages: walk.pages, hasPages: walk.hasPages, issues: walk.issues };
}

/** Apply a convention line: `PAGE:`, `PANEL:`, `CAPTION:`, `LAYOUT:`, `SFX:`, or a reused shot line. */
function applyDirective(
  walk: Walk,
  item: { line: number; keyword: string; qualifier?: string; rest: string },
): void {
  const value = item.rest.trim();
  switch (item.keyword) {
    case 'PAGE': {
      flushPending(walk);
      closePage(walk, item.line - 1);
      walk.hasPages = true;
      walk.pageCounter += 1;
      const parsed = parsePageLine(item.rest);
      if (parsed.label === '') {
        walk.issues.push({
          code: 'missing-page-label',
          severity: 'warning',
          line: item.line,
          path: `lines[${item.line}]`,
          message: `PAGE: (line ${item.line + 1}) has no page number or label. Write PAGE: followed by the page number, e.g. PAGE: 7.`,
        });
      }
      walk.page = { index: walk.pageCounter, ...parsed, notes: [], panels: [], lines: { start: item.line, end: item.line } };
      return;
    }
    case 'PANEL': {
      flushPending(walk);
      if (!walk.page) {
        walk.issues.push({
          code: 'panel-before-page',
          severity: 'warning',
          line: item.line,
          path: `lines[${item.line}]`,
          message: `PANEL: (line ${item.line + 1}) comes before any PAGE: line, so it is kept on an unnumbered page. Add a PAGE: line above it.`,
        });
        walk.page = { index: 0, implicit: true, label: '', modifiers: [], notes: [], panels: [], lines: { start: item.line, end: item.line } };
      }
      closePanel(walk, item.line - 1);
      walk.panelCounter += 1;
      walk.panel = newPanel(walk, walk.panelCounter, item.line);
      walk.panel.description = value;
      if (value) walk.panel.mentionText.push(value);
      return;
    }
    case 'CAPTION': {
      const entry: CaptionEntry = { kind: 'caption', ...(item.qualifier ? { speaker: item.qualifier } : {}), text: value, line: item.line };
      if (pushLettering(walk, entry, true) && item.qualifier) walk.panel?.mentionText.push(item.qualifier);
      return;
    }
    case 'SFX': {
      const { tag, rest } = splitTag(value);
      pushLettering(walk, { kind: 'sfx', text: rest, ...(tag !== undefined ? { tag } : {}), line: item.line }, false);
      return;
    }
    case 'LAYOUT':
      if (walk.panel) walk.panel.layout = value;
      else if (walk.page) walk.page.layout = value;
      return;
    case 'SHOT':
    case 'POSE':
    case 'LIGHT': {
      const panel = walk.panel;
      if (!panel) return; // Inert outside a panel, like POSE: before a SHOT:.
      if (item.keyword === 'SHOT') panel.shot = splitTag(value).rest;
      else if (item.keyword === 'POSE') panel.pose = value;
      else panel.light = value;
      panel.mentionText.push(item.keyword === 'SHOT' ? splitTag(value).rest : value);
      return;
    }
    default:
      return;
  }
}

/** Split a leading slug-shaped `[tag]` off prefix-line text (same shape as `fountain/conventions.ts`' `matchLeadingTag`). */
function splitTag(text: string): { tag?: string; rest: string } {
  const match = /^\[([a-z0-9]+(?:-[a-z0-9]+)*)\][ \t]*(.*)$/.exec(text);
  return match ? { tag: match[1], rest: match[2].trim() } : { rest: text.trim() };
}

/** Apply an action line: panel direction, or a page note before the first panel. */
function applyAction(walk: Walk, text: string, line: number, blockStart: boolean): void {
  const target = walk.panel ? walk.panel.action : walk.page?.notes;
  if (!target) {
    walk.lastActionLine = undefined;
    return;
  }
  if (walk.panel) walk.panel.mentionText.push(text);
  const last = target[target.length - 1];
  if (!blockStart && last !== undefined && walk.lastActionLine === line - 1) {
    last.text = `${last.text}\n${text}`;
  } else {
    target.push({ text, line });
  }
  walk.lastActionLine = line;
}

/** Apply one run of dialogue as a balloon. */
function applyDialogue(walk: Walk, speaker: CharacterItem, text: string, line: number): void {
  const pendingDirections = walk.pending && walk.pending.speaker === speaker ? walk.pending.directions : [];
  if (walk.pending && walk.pending.speaker === speaker) walk.pending = undefined;
  else flushPending(walk);

  const offPanel = speaker.extensions.some((extension) => OFF_PANEL_EXTENSIONS.has(extension.trim().toUpperCase()));
  const balloon: BalloonEntry = {
    kind: 'balloon',
    speaker: speaker.name,
    extensions: [...speaker.extensions],
    ...(offPanel ? { offPanel: true as const } : {}),
    ...(speaker.simultaneous ? { simultaneous: true as const } : {}),
    directions: [...pendingDirections],
    text,
    line,
  };
  const placed = pushLettering(walk, balloon, false);
  if (placed) {
    walk.panel?.mentionText.push(speaker.name);
    walk.lastBalloon = { balloon, speaker };
  }
}

/** Attach parentheticals that no later balloon in their speech claimed to that speech's last balloon. */
function flushPending(walk: Walk): void {
  const pending = walk.pending;
  walk.pending = undefined;
  if (!pending) return;
  if (walk.lastBalloon && walk.lastBalloon.speaker === pending.speaker) {
    walk.lastBalloon.balloon.directions.push(...pending.directions);
  }
}

/**
 * The panel lettering goes in: the open panel, else an implicit panel 0 on
 * the open page (reported), else `undefined` when no page is open.
 *
 * @param report - Whether to report lettering outside a panel when no panel is open. Dialogue and `SFX:` outside any page are ignored silently; a `CAPTION:` outside any page is always reported.
 */
function panelForLettering(walk: Walk, line: number, report: boolean): ComicPanel | undefined {
  if (walk.panel) return walk.panel;
  if (!walk.page) {
    if (report) {
      walk.issues.push({
        code: 'content-outside-panel',
        severity: 'warning',
        line,
        path: `lines[${line}]`,
        message: `Line ${line + 1} is comic lettering written before any PAGE: or PANEL:, so it was left out. Put it under a PANEL:.`,
      });
    }
    return undefined;
  }
  walk.issues.push({
    code: 'content-outside-panel',
    severity: 'warning',
    line,
    path: `lines[${line}]`,
    message: `Line ${line + 1} is lettering written under PAGE: but before its first PANEL:, so no panel owns it. Put it under a PANEL: so the artist can place it.`,
  });
  walk.panel = newPanel(walk, 0, line);
  return walk.panel;
}

/** Push lettering into its panel; returns whether it was placed. */
function pushLettering(walk: Walk, entry: LetteringEntry, reportOutsidePage: boolean): boolean {
  // An implicit panel 0, once created, is the open panel, so this reports once per run of lettering, not once per line.
  const panel = panelForLettering(walk, entry.line, walk.page !== undefined || reportOutsidePage);
  if (!panel) return false;
  panel.lettering.push(entry);
  return true;
}

/** A fresh panel in the current scene. */
function newPanel(walk: Walk, number: number, line: number): ComicPanel {
  return {
    number,
    action: [],
    lettering: [],
    scene: walk.scene,
    ...(walk.sceneHeading !== undefined && walk.scene > 0 ? { sceneHeading: walk.sceneHeading } : {}),
    lines: { start: line, end: line },
    mentionText: [],
  };
}

/** Close the open panel into its page, ending its line range at `endLine`. */
function closePanel(walk: Walk, endLine: number): void {
  const panel = walk.panel;
  if (!panel || !walk.page) {
    walk.panel = undefined;
    return;
  }
  panel.lines.end = Math.max(panel.lines.start, endLine);
  walk.page.panels.push(panel);
  walk.panel = undefined;
}

/** Close the open page, ending its line range at `endLine`; panel numbering restarts for the next page. */
function closePage(walk: Walk, endLine: number): void {
  closePanel(walk, endLine);
  const page = walk.page;
  if (page) {
    page.lines.end = Math.max(page.lines.start, endLine);
    walk.pages.push(page);
  }
  walk.page = undefined;
  walk.panelCounter = 0;
}

/** The index of the script's last line, ignoring a single trailing newline. */
function lastLineIndex(text: string): number {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') return lines.length - 2;
  return lines.length - 1;
}
