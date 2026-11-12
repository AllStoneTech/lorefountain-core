/**
 * Builds the per-page "page map" written to a comic script's `.pages.json`
 * sidecar (`pageSidecar.ts`): each page with its panels, each panel's line
 * range, lettering in reading order, entity mentions and word counts, plus
 * the script issues found along the way. It is the comic counterpart of
 * `shots/shotMap.ts` and `.shots.json`.
 *
 * Exports {@link buildPageMap}, its entry/issue types, and
 * {@link DEFAULT_PAGE_LIMITS}. Pure: entity knowledge comes in as
 * {@link ShotMapEntity}s built by the caller from the index.
 *
 * Issues (all collect-and-continue; nothing here changes what is read):
 * - Warnings: `panel-before-page`, `content-outside-panel`,
 *   `missing-page-label` (from `parseComic.ts`), `duplicate-page-number`,
 *   `page-out-of-order`.
 * - Info: `page-number-gap`, `empty-page`, `missing-panel-description`,
 *   `splash-multiple-panels`, `spread-without-range`, the word-budget notes
 *   `many-panels`, `many-balloons`, `long-balloon`, `long-panel-dialogue`
 *   (thresholds in {@link PageLimits}; they never fail a run), and
 *   `misread-as-character` (a convention line other Fountain apps would print
 *   as a character cue).
 *
 * Gotchas:
 * - `entities` are mentions in a panel's own direction text (description,
 *   shot, pose, light, action, speaker names), never balloon or caption text,
 *   matching the shot map.
 * - Word counts cover balloons and captions only; sound effects are lettering
 *   but not part of a word budget. Parentheticals aren't counted.
 * - Numbers: a `PAGE:` label `2-3` occupies pages 2 and 3 for duplicate and
 *   sequence checks.
 */

import { matchComicLine, matchPrefixLine } from '../fountain/conventions';
import { blankBoneyard } from '../fountain/boneyard';
import { extractMentionTargets, type MentionCandidate } from '../index/mentions';
import type { ValidationIssue } from '../model/errors';
import type { ShotMapEntity } from '../shots/shotMap';
import {
  countWords,
  extractComic,
  type ComicPage,
  type ComicPanel,
  type ComicStructureIssue,
  type LetteringEntry,
  type PageLabel,
} from './parseComic';

/** Per-panel and per-page counts of what is lettered. */
export interface LetteringCounts {
  balloons: number;
  captions: number;
  /** Sound effects. Lettering, but not part of `words`. */
  sfx: number;
  /** Words in balloons and captions: the word budget writers watch. */
  words: number;
}

/** One panel in the `.pages.json` sidecar. */
export interface PanelMapEntry {
  /** 1-based within the page; 0 for the implicit panel holding lettering written before a page's first `PANEL:`. */
  number: number;
  /** The `PANEL:` text. Absent on panel 0. */
  description?: string;
  shot?: string;
  layout?: string;
  pose?: string;
  light?: string;
  /** Further action blocks inside the panel. */
  action: { text: string; line: number }[];
  /** Balloons, captions and sound effects in reading order. */
  lettering: LetteringEntry[];
  /** Scene number (1-based) where the panel opens; 0 before any scene heading. */
  scene: number;
  sceneHeading?: string;
  /** 0-based, inclusive. */
  lines: { start: number; end: number };
  /** Deduplicated ids of entities mentioned in the panel's own direction text. */
  entities: string[];
  counts: LetteringCounts;
}

/** One page in the `.pages.json` sidecar. */
export interface PageMapEntry extends PageLabel {
  /** 1-based by encounter order; 0 for the implicit page holding panels written before any `PAGE:`. */
  index: number;
  implicit?: true;
  layout?: string;
  /** Action text between the `PAGE:` line and the first panel. */
  notes: { text: string; line: number }[];
  /** 0-based, inclusive. */
  lines: { start: number; end: number };
  panels: PanelMapEntry[];
  /** Deduplicated ids of entities mentioned in any of the page's panels, in first-seen order. */
  entities: string[];
  counts: LetteringCounts & {
    /** Numbered panels (panel 0 is not counted). */
    panels: number;
  };
}

/** Thresholds for the informational word-budget notes. A script author tunes them; none ever fails a run. */
export interface PageLimits {
  /** A page with more numbered panels than this is noted (`many-panels`). */
  maxPanelsPerPage: number;
  /** A panel with more balloons than this is noted (`many-balloons`). */
  maxBalloonsPerPanel: number;
  /** A balloon with more words than this is noted (`long-balloon`). */
  maxWordsPerBalloon: number;
  /** A panel whose balloons and captions hold more words than this is noted (`long-panel-dialogue`). */
  maxWordsPerPanel: number;
}

/** Common comic-craft guidance: up to 9 panels, 5 balloons, 25-word balloons and 40 words in a panel. */
export const DEFAULT_PAGE_LIMITS: PageLimits = {
  maxPanelsPerPage: 9,
  maxBalloonsPerPanel: 5,
  maxWordsPerBalloon: 25,
  maxWordsPerPanel: 40,
};

/** Options for {@link buildPageMap}. */
export interface PageMapOptions {
  /** Overrides for {@link DEFAULT_PAGE_LIMITS}. */
  limits?: Partial<PageLimits>;
}

/** A per-script issue found while building the page map. */
export interface ScriptPageIssue extends ValidationIssue {
  code:
    | ComicStructureIssue['code']
    | 'duplicate-page-number'
    | 'page-out-of-order'
    | 'page-number-gap'
    | 'empty-page'
    | 'missing-panel-description'
    | 'splash-multiple-panels'
    | 'spread-without-range'
    | 'many-panels'
    | 'many-balloons'
    | 'long-balloon'
    | 'long-panel-dialogue'
    | 'misread-as-character';
  /** `warning` is reported like every other non-blocking warning; `info` is a note. */
  severity: 'warning' | 'info';
  /** 0-based line the issue is on. */
  line: number;
}

/** Result of {@link buildPageMap}. */
export interface PageMapResult {
  /** Every page, including an implicit page 0, in document order. */
  pages: PageMapEntry[];
  /** True when the script has at least one explicit `PAGE:` line. A script without one has no page map. */
  hasPages: boolean;
  /** Totals across the whole script (numbered panels only in `panels`). */
  totals: LetteringCounts & { pages: number; panels: number };
  issues: ScriptPageIssue[];
}

/**
 * Build a comic script's page map and per-script page issues.
 *
 * @param scriptText - The `.fountain` file's full text.
 * @param entities - Every known entity, for mention and speaker resolution.
 * @param options - Optional overrides for the word-budget thresholds.
 * @returns The pages, whether any explicit `PAGE:` exists, totals, and any issues found.
 */
export function buildPageMap(
  scriptText: string,
  entities: readonly ShotMapEntity[],
  options: PageMapOptions = {},
): PageMapResult {
  const limits: PageLimits = { ...DEFAULT_PAGE_LIMITS, ...options.limits };
  const structure = extractComic(scriptText);
  const candidates: MentionCandidate[] = entities.map((entity) => ({ id: entity.id, kind: 'entity', names: entity.names }));

  const pages = structure.pages.map((page) => toPageEntry(page, entities, candidates));
  const issues: ScriptPageIssue[] = [...structure.issues];

  if (structure.hasPages) {
    issues.push(...pageIssues(pages, limits), ...misreadIssues(scriptText, pages));
  }
  issues.sort((a, b) => a.line - b.line);

  const totals = { pages: 0, panels: 0, balloons: 0, captions: 0, sfx: 0, words: 0 };
  for (const page of pages) {
    totals.pages += 1;
    totals.panels += page.counts.panels;
    totals.balloons += page.counts.balloons;
    totals.captions += page.counts.captions;
    totals.sfx += page.counts.sfx;
    totals.words += page.counts.words;
  }

  return { pages, hasPages: structure.hasPages, totals, issues };
}

/** Enrich a parsed page into its sidecar entry. */
function toPageEntry(page: ComicPage, entities: readonly ShotMapEntity[], candidates: readonly MentionCandidate[]): PageMapEntry {
  const panels = page.panels.map((panel) => toPanelEntry(panel, entities, candidates));
  const pageEntities = [...new Set(panels.flatMap((panel) => panel.entities))];
  const counts = { panels: panels.filter((panel) => panel.number > 0).length, ...sumCounts(panels.map((panel) => panel.counts)) };

  // Built in sidecar field order. Absent optional fields are omitted.
  const entry: PageMapEntry = {
    index: page.index,
    ...(page.implicit ? { implicit: true as const } : {}),
    label: page.label,
    ...(page.number !== undefined ? { number: page.number } : {}),
    ...(page.endNumber !== undefined ? { endNumber: page.endNumber } : {}),
    modifiers: page.modifiers,
    ...(page.layout !== undefined ? { layout: page.layout } : {}),
    notes: page.notes,
    lines: page.lines,
    panels,
    entities: pageEntities,
    counts,
  };
  return entry;
}

/** Enrich a parsed panel into its sidecar entry. */
function toPanelEntry(panel: ComicPanel, entities: readonly ShotMapEntity[], candidates: readonly MentionCandidate[]): PanelMapEntry {
  const lettering = panel.lettering.map((entry): LetteringEntry => {
    if (entry.kind === 'balloon') {
      const speakerEntity = resolveExactName(entry.speaker, entities);
      return speakerEntity === undefined ? entry : { ...entry, speakerEntity };
    }
    if (entry.kind === 'caption' && entry.speaker !== undefined) {
      const speakerEntity = resolveExactName(entry.speaker, entities);
      return speakerEntity === undefined ? entry : { ...entry, speakerEntity };
    }
    return entry;
  });

  return {
    number: panel.number,
    ...(panel.description !== undefined ? { description: panel.description } : {}),
    ...(panel.shot !== undefined ? { shot: panel.shot } : {}),
    ...(panel.layout !== undefined ? { layout: panel.layout } : {}),
    ...(panel.pose !== undefined ? { pose: panel.pose } : {}),
    ...(panel.light !== undefined ? { light: panel.light } : {}),
    action: panel.action,
    lettering,
    scene: panel.scene,
    ...(panel.sceneHeading !== undefined ? { sceneHeading: panel.sceneHeading } : {}),
    lines: panel.lines,
    entities: extractMentionTargets(panel.mentionText.join('\n'), candidates).map((target) => target.id),
    counts: letteringCounts(lettering),
  };
}

/** Count a panel's lettering. */
function letteringCounts(lettering: readonly LetteringEntry[]): LetteringCounts {
  const counts: LetteringCounts = { balloons: 0, captions: 0, sfx: 0, words: 0 };
  for (const entry of lettering) {
    if (entry.kind === 'balloon') {
      counts.balloons += 1;
      counts.words += countWords(entry.text);
    } else if (entry.kind === 'caption') {
      counts.captions += 1;
      counts.words += countWords(entry.text);
    } else {
      counts.sfx += 1;
    }
  }
  return counts;
}

/** Add up lettering counts. */
function sumCounts(all: readonly LetteringCounts[]): LetteringCounts {
  return all.reduce<LetteringCounts>(
    (sum, counts) => ({
      balloons: sum.balloons + counts.balloons,
      captions: sum.captions + counts.captions,
      sfx: sum.sfx + counts.sfx,
      words: sum.words + counts.words,
    }),
    { balloons: 0, captions: 0, sfx: 0, words: 0 },
  );
}

/** Resolve a whole name to the one entity whose name or alias equals it (case-insensitive, trimmed); never guesses. */
function resolveExactName(name: string, entities: readonly ShotMapEntity[]): string | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  const ids = new Set<string>();
  for (const entity of entities) {
    if (entity.names.some((candidate) => candidate.trim().toLowerCase() === key)) ids.add(entity.id);
  }
  return ids.size === 1 ? [...ids][0] : undefined;
}

/** A page issue anchored at a line. */
function issue(code: ScriptPageIssue['code'], severity: ScriptPageIssue['severity'], line: number, message: string): ScriptPageIssue {
  return { code, severity, line, path: `lines[${line}]`, message };
}

/** The page numbers a label covers (capped by the parser's range limit). */
function coveredNumbers(page: PageLabel): number[] {
  if (page.number === undefined) return [];
  const end = page.endNumber ?? page.number;
  const numbers: number[] = [];
  for (let n = page.number; n <= end; n += 1) numbers.push(n);
  return numbers;
}

/** Numbering, structure and word-budget checks across the explicit pages. */
function pageIssues(pages: readonly PageMapEntry[], limits: PageLimits): ScriptPageIssue[] {
  const issues: ScriptPageIssue[] = [];
  const seenNumbers = new Map<number, number>();
  const seenLabels = new Map<string, number>();
  let previous: PageMapEntry | undefined;

  for (const page of pages) {
    // Panels written before any page sit on implicit page 0, which has no label to check.
    if (!page.implicit) {
      const line = page.lines.start;
      const numbers = coveredNumbers(page);
      const duplicate = numbers.find((n) => seenNumbers.has(n));
      const labelKey = page.label.toUpperCase();
      if (duplicate !== undefined) {
        issues.push(
          issue('duplicate-page-number', 'warning', line, `PAGE: ${page.label} (line ${line + 1}) repeats page ${duplicate}, first used on line ${(seenNumbers.get(duplicate) ?? 0) + 1}. Page numbers should be unique.`),
        );
      } else if (numbers.length === 0 && page.label !== '' && seenLabels.has(labelKey)) {
        issues.push(
          issue('duplicate-page-number', 'warning', line, `PAGE: ${page.label} (line ${line + 1}) repeats a label first used on line ${(seenLabels.get(labelKey) ?? 0) + 1}.`),
        );
      } else if (previous?.number !== undefined && page.number !== undefined) {
        const last = previous.endNumber ?? previous.number;
        if (page.number < last) {
          issues.push(
            issue('page-out-of-order', 'warning', line, `PAGE: ${page.label} (line ${line + 1}) comes after page ${last}. Pages should run in ascending order.`),
          );
        } else if (page.number > last + 1) {
          issues.push(
            issue('page-number-gap', 'info', line, `PAGE: ${page.label} (line ${line + 1}) skips from page ${last}: ${page.number - last - 1} page number(s) missing.`),
          );
        }
      }
      for (const n of numbers) if (!seenNumbers.has(n)) seenNumbers.set(n, line);
      if (numbers.length === 0 && page.label !== '' && !seenLabels.has(labelKey)) seenLabels.set(labelKey, line);
      previous = page;

      if (page.counts.panels === 0 && page.panels.length === 0) {
        issues.push(issue('empty-page', 'info', line, `PAGE: ${page.label} (line ${line + 1}) has no panels yet.`));
      }
      if (page.modifiers.includes('SPLASH') && page.counts.panels > 1) {
        issues.push(issue('splash-multiple-panels', 'info', line, `PAGE: ${page.label} (line ${line + 1}) is marked SPLASH but has ${page.counts.panels} panels. A splash page is usually a single panel.`));
      }
      if (page.modifiers.includes('SPREAD') && page.endNumber === undefined) {
        issues.push(issue('spread-without-range', 'info', line, `PAGE: ${page.label} (line ${line + 1}) is marked SPREAD but its label isn't a range such as 2-3.`));
      }
      if (page.counts.panels > limits.maxPanelsPerPage) {
        issues.push(issue('many-panels', 'info', line, `PAGE: ${page.label} (line ${line + 1}) has ${page.counts.panels} panels; more than ${limits.maxPanelsPerPage} is hard to lay out.`));
      }
    }

    for (const panel of page.panels) {
      const line = panel.lines.start;
      if (panel.number > 0 && (panel.description ?? '') === '') {
        issues.push(issue('missing-panel-description', 'info', line, `PANEL: (line ${line + 1}) has no description for the artist.`));
      }
      if (panel.counts.balloons > limits.maxBalloonsPerPanel) {
        issues.push(issue('many-balloons', 'info', line, `Panel ${panel.number}${pageRef(page)} (line ${line + 1}) has ${panel.counts.balloons} balloons; more than ${limits.maxBalloonsPerPanel} crowds a panel.`));
      }
      if (panel.counts.words > limits.maxWordsPerPanel) {
        issues.push(issue('long-panel-dialogue', 'info', line, `Panel ${panel.number}${pageRef(page)} (line ${line + 1}) letters ${panel.counts.words} words; more than ${limits.maxWordsPerPanel} is heavy for one panel.`));
      }
      for (const entry of panel.lettering) {
        if (entry.kind === 'balloon' && countWords(entry.text) > limits.maxWordsPerBalloon) {
          issues.push(issue('long-balloon', 'info', entry.line, `${entry.speaker}'s balloon (line ${entry.line + 1}) has ${countWords(entry.text)} words; more than ${limits.maxWordsPerBalloon} is hard to letter.`));
        }
      }
    }
  }
  return issues;
}

/** " on page N" for messages, or empty for an unnumbered page. */
function pageRef(page: PageMapEntry): string {
  return page.label ? ` on page ${page.label}` : '';
}

/**
 * Convention lines that Fountain itself reads as character cues: no
 * lowercase letter, a blank line (or the file start) before, and text directly
 * after. Other Fountain apps would print them as speakers. LoreFountain still
 * reads them correctly (`shots/scanScript.ts`), so this is a note, not an error.
 */
function misreadIssues(scriptText: string, pages: readonly PageMapEntry[]): ScriptPageIssue[] {
  const firstPageLine = pages.find((page) => !page.implicit)?.lines.start ?? pages[0]?.lines.start ?? 0;
  const lines = blankBoneyard(scriptText).split(/\r\n|\r|\n/);
  const isBlank = (index: number): boolean => (lines[index] ?? '').trim() === '';
  const issues: ScriptPageIssue[] = [];
  for (let index = Math.min(firstPageLine, lines.length); index < lines.length; index += 1) {
    const text = lines[index];
    const match = matchComicLine(text) ?? matchPrefixLine(text);
    if (!match || /\p{Ll}/u.test(text)) continue;
    if (!(index === 0 || isBlank(index - 1)) || index + 1 >= lines.length || isBlank(index + 1)) continue;
    issues.push(
      issue(
        'misread-as-character',
        'info',
        index,
        `"${text.trim()}" (line ${index + 1}) is all capitals with text directly under it, so other Fountain apps read it as a character cue. Leave a blank line after it, or keep a lowercase word in the line.`,
      ),
    );
  }
  return issues;
}
