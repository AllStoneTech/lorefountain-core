/**
 * Word-budget limits for comic scripts, their presets, and how a project's
 * settings are resolved (ADR-0001, decision 2).
 *
 * Exports {@link PageLimits}, {@link COMIC_PRESETS} (named sets of limits),
 * {@link comicSettingsFromConfig} (tolerant reader for the `comic` block of
 * `lorefountain.config.json`), {@link resolveComicSettings} and
 * {@link describeLimitSource}.
 *
 * The numbers are GUIDANCE, not rules: they only ever produce informational
 * notes that never fail a run. Most are rules of thumb from writers' guides
 * and creator handbooks, not measured norms, so every value below says where
 * it came from, or that it is an unsourced starting value. Treat them as
 * defaults to tune. A limit set to `null` is switched off.
 *
 * Resolution order, highest first: the project's `comic.limits` (per limit),
 * then the project's `comic.preset`, then a user-level default preset passed in
 * by the caller (the extension's `lorefountain.comic.defaultPreset` setting),
 * then the built-in default (`western`). Headless callers have no user-level
 * setting and pass none.
 *
 * Gotchas: reading never throws. A bad `preset` or limit is dropped and
 * reported in `issues`, and the rest still applies.
 */

import type { LoreFountainConfig } from '../config/readConfig';

/** Thresholds for the informational word-budget notes. `null` switches a note off. None ever fails a run. */
export interface PageLimits {
  /** A page with more numbered panels than this is noted (`many-panels`). `null`: not checked. */
  maxPanelsPerPage: number | null;
  /** A panel with more balloons than this is noted (`many-balloons`). `null`: not checked. */
  maxBalloonsPerPanel: number | null;
  /** A balloon with more words than this is noted (`long-balloon`). `null`: not checked. */
  maxWordsPerBalloon: number | null;
  /** A panel whose balloons and captions hold more words than this is noted (`long-panel-dialogue`). `null`: not checked. */
  maxWordsPerPanel: number | null;
}

/** The four limit names, in a stable order. */
export const PAGE_LIMIT_KEYS = ['maxPanelsPerPage', 'maxBalloonsPerPanel', 'maxWordsPerBalloon', 'maxWordsPerPanel'] as const;

/** One limit's name. */
export type PageLimitKey = (typeof PAGE_LIMIT_KEYS)[number];

/** Names of the built-in presets. */
export const COMIC_PRESET_NAMES = ['western', 'manga', 'european', 'webtoon', 'custom'] as const;

/** A preset's name. */
export type ComicPresetName = (typeof COMIC_PRESET_NAMES)[number];

/** The preset used when nothing chooses one. */
export const DEFAULT_COMIC_PRESET: ComicPresetName = 'western';

/**
 * The built-in presets. Sources, by value (web research, November 2026; read
 * the caveats in ADR-0001 before treating any figure as a standard):
 *
 * - ~25 words per balloon: the common figure in the Dark Horse submission
 *   script guide and several writers' advice.
 * - Words per panel: guidance runs from ~35 (Buzz Dixon, counting captions and
 *   SFX) to ~50 (the Dark Horse ceiling). We count balloons and captions only,
 *   not SFX, so 35 is the conservative end.
 * - Balloons per panel: about 3. WEBTOON's creator handbook says 3 or fewer per
 *   panel; Creative Bloq's manga advice says a maximum of 3. Dan Jolley's rule
 *   of thumb is page-density based (4 on pages of up to 4 panels, 3 on five,
 *   2 on six or more), which a single number can't express.
 * - Panels per page: NO source found for a typical or maximum count for
 *   Western comics. Manga pages are reported to average about 5 to 8 (sources
 *   disagree: 4-6 to 6-8; seinen runs denser than shoujo). Franco-Belgian
 *   albums are typically 46-48 pages, with no confirmed panels-per-page norm.
 *   WEBTOON is a vertical scroll with no pages at all.
 */
export const COMIC_PRESETS: Readonly<Record<ComicPresetName, Readonly<PageLimits>>> = {
  western: {
    // Unsourced starting value: the previous default (9). No source found for a Western maximum.
    maxPanelsPerPage: 9,
    // Source: WEBTOON creator handbook (3 or fewer per panel); Creative Bloq manga advice (max 3).
    maxBalloonsPerPanel: 3,
    // Source: Dark Horse submission script guide; several writers (~25 words per balloon).
    maxWordsPerBalloon: 25,
    // Source: Buzz Dixon (~35 words, counting captions and SFX). Dark Horse allows up to ~50.
    maxWordsPerPanel: 35,
  },
  manga: {
    // Partly sourced: manga pages are reported at about 5 to 8 panels (sources disagree), so 8 is the upper end.
    maxPanelsPerPage: 8,
    // Source: Creative Bloq manga advice (max 3).
    maxBalloonsPerPanel: 3,
    // Unsourced starting value: the Western ~25-word figure carried over; no manga-specific figure found.
    maxWordsPerBalloon: 25,
    // Unsourced starting value: the Western figure carried over; no manga-specific figure found.
    maxWordsPerPanel: 35,
  },
  european: {
    // Disabled: no panels-per-page norm for Franco-Belgian albums was confirmed.
    maxPanelsPerPage: null,
    // Unsourced starting value: the Western figure carried over.
    maxBalloonsPerPanel: 3,
    // Unsourced starting value: the Western figure carried over.
    maxWordsPerBalloon: 25,
    // Unsourced starting value: the Western figure carried over.
    maxWordsPerPanel: 35,
  },
  webtoon: {
    // Disabled: WEBTOON is a vertical scroll with no pages, and no per-episode standard was found.
    maxPanelsPerPage: null,
    // Source: WEBTOON creator handbook (3 or fewer per panel).
    maxBalloonsPerPanel: 3,
    // Unsourced starting value: the handbook says 1-2 sentences per bubble, which is not a word count; Western ~25 carried over.
    maxWordsPerBalloon: 25,
    // Unsourced starting value: the Western figure carried over.
    maxWordsPerPanel: 35,
  },
  custom: {
    // No built-in limits: only the limits written in `comic.limits` apply.
    maxPanelsPerPage: null,
    maxBalloonsPerPanel: null,
    maxWordsPerBalloon: null,
    maxWordsPerPanel: null,
  },
};

/** The Western preset's limits, kept under their older name. */
export const DEFAULT_PAGE_LIMITS: Readonly<PageLimits> = COMIC_PRESETS[DEFAULT_COMIC_PRESET];

/** The `comic` block of `lorefountain.config.json`, after tolerant reading. Every field is optional. */
export interface ComicProjectSettings {
  /** Which preset's limits to start from. */
  preset?: ComicPresetName;
  /** Per-limit overrides: a whole number of at least 1, or `null` to switch that note off. */
  limits?: Partial<PageLimits>;
  /** When true, `SFX:` lines in comic panels are also audio cues (`.cues.json`). Default false. */
  sfxAsCue?: boolean;
  /** When true, a comic script with no `SHOT:` lines gets a derived `.shots.json`, one shot per panel (ADR-0003). Default false. */
  panelsAsShots?: boolean;
}

/** What {@link comicSettingsFromConfig} found. */
export interface ComicSettingsReadResult {
  /** The valid parts of the block. */
  settings: ComicProjectSettings;
  /** One message per part that was dropped. Empty when the block is absent or fully valid. */
  issues: string[];
}

/** The settings a script is actually checked and extracted with. */
export interface ResolvedComicSettings {
  preset: ComicPresetName;
  /** Where the preset name came from. */
  presetSource: 'project' | 'user' | 'default';
  /** The final limits: the preset's, with `comic.limits` applied. */
  limits: PageLimits;
  /** Which limits `comic.limits` set, so messages can say so. */
  overriddenLimits: PageLimitKey[];
  sfxAsCue: boolean;
  panelsAsShots: boolean;
}

/** True for a known preset name. */
export function isComicPresetName(value: unknown): value is ComicPresetName {
  return typeof value === 'string' && (COMIC_PRESET_NAMES as readonly string[]).includes(value);
}

/**
 * Read the `comic` block from a parsed config. Tolerant: an unknown preset, a
 * bad limit value or a non-boolean `sfxAsCue` is dropped and reported, and the
 * valid remainder is kept. Never throws.
 *
 * @param config - A parsed config.
 * @returns The valid settings and a message for each dropped part.
 */
export function comicSettingsFromConfig(config: LoreFountainConfig): ComicSettingsReadResult {
  const raw: unknown = config.comic;
  const settings: ComicProjectSettings = {};
  const issues: string[] = [];
  if (raw === undefined) return { settings, issues };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { settings, issues: ['comic: expected an object; ignoring it.'] };
  }
  const block = raw as Record<string, unknown>;

  if (block.preset !== undefined) {
    if (isComicPresetName(block.preset)) settings.preset = block.preset;
    else issues.push(`comic.preset: "${String(block.preset)}" is not one of ${COMIC_PRESET_NAMES.join(', ')}; ignoring it.`);
  }

  if (block.sfxAsCue !== undefined) {
    if (typeof block.sfxAsCue === 'boolean') settings.sfxAsCue = block.sfxAsCue;
    else issues.push('comic.sfxAsCue: expected true or false; ignoring it.');
  }

  if (block.panelsAsShots !== undefined) {
    if (typeof block.panelsAsShots === 'boolean') settings.panelsAsShots = block.panelsAsShots;
    else issues.push('comic.panelsAsShots: expected true or false; ignoring it.');
  }

  if (block.limits !== undefined) {
    if (typeof block.limits !== 'object' || block.limits === null || Array.isArray(block.limits)) {
      issues.push('comic.limits: expected an object; ignoring it.');
    } else {
      const limits: Partial<PageLimits> = {};
      for (const [key, value] of Object.entries(block.limits as Record<string, unknown>)) {
        if (!(PAGE_LIMIT_KEYS as readonly string[]).includes(key)) {
          issues.push(`comic.limits.${key}: unknown limit; ignoring it.`);
        } else if (value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1)) {
          limits[key as PageLimitKey] = value;
        } else {
          issues.push(`comic.limits.${key}: expected a whole number of at least 1, or null to switch it off; ignoring it.`);
        }
      }
      if (Object.keys(limits).length > 0) settings.limits = limits;
    }
  }
  return { settings, issues };
}

/**
 * Resolve the settings for a project: `comic.limits` over `comic.preset` over
 * the user-level default preset over the built-in default.
 *
 * @param project - The project's `comic` block (as read by {@link comicSettingsFromConfig}), if any.
 * @param userDefaultPreset - A user-level default preset name (VS Code's `lorefountain.comic.defaultPreset`); anything unrecognized is ignored. Headless callers omit it.
 * @returns The preset, the final limits, which limits the project overrode, and `sfxAsCue`.
 */
export function resolveComicSettings(project?: ComicProjectSettings, userDefaultPreset?: string): ResolvedComicSettings {
  let preset: ComicPresetName = DEFAULT_COMIC_PRESET;
  let presetSource: ResolvedComicSettings['presetSource'] = 'default';
  if (project?.preset !== undefined) {
    preset = project.preset;
    presetSource = 'project';
  } else if (isComicPresetName(userDefaultPreset)) {
    preset = userDefaultPreset;
    presetSource = 'user';
  }

  const limits: PageLimits = { ...COMIC_PRESETS[preset] };
  const overriddenLimits: PageLimitKey[] = [];
  for (const key of PAGE_LIMIT_KEYS) {
    const value = project?.limits?.[key];
    if (value !== undefined) {
      limits[key] = value;
      overriddenLimits.push(key);
    }
  }
  return { preset, presetSource, limits, overriddenLimits, sfxAsCue: project?.sfxAsCue ?? false, panelsAsShots: project?.panelsAsShots ?? false };
}

/**
 * Say where a limit came from, for issue messages.
 *
 * @param preset - The preset in effect.
 * @param overridden - The limits the project's `comic.limits` set.
 * @param key - The limit that fired.
 * @returns For example `western preset` or `comic.limits.maxWordsPerBalloon`.
 */
export function describeLimitSource(preset: ComicPresetName, overridden: readonly PageLimitKey[], key: PageLimitKey): string {
  return overridden.includes(key) ? `comic.limits.${key}` : `${preset} preset`;
}
