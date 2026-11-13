import { describe, expect, it } from 'vitest';
import {
  COMIC_PRESET_NAMES,
  COMIC_PRESETS,
  comicSettingsFromConfig,
  DEFAULT_PAGE_LIMITS,
  describeLimitSource,
  PAGE_LIMIT_KEYS,
  resolveComicSettings,
} from '../src/comics/limits';
import { buildPageMap } from '../src/comics/pageMap';

describe('COMIC_PRESETS', () => {
  it('defines every preset with all four limits', () => {
    for (const name of COMIC_PRESET_NAMES) {
      expect(Object.keys(COMIC_PRESETS[name]).sort()).toEqual([...PAGE_LIMIT_KEYS].sort());
    }
  });

  it('has the agreed western values, and DEFAULT_PAGE_LIMITS is western', () => {
    expect(COMIC_PRESETS.western).toEqual({ maxPanelsPerPage: 9, maxBalloonsPerPanel: 3, maxWordsPerBalloon: 25, maxWordsPerPanel: 35 });
    expect(DEFAULT_PAGE_LIMITS).toBe(COMIC_PRESETS.western);
  });

  it('allows 8 panels on a manga page, none checked for webtoon, and nothing for custom', () => {
    expect(COMIC_PRESETS.manga.maxPanelsPerPage).toBe(8);
    expect(COMIC_PRESETS.webtoon.maxPanelsPerPage).toBeNull();
    expect(Object.values(COMIC_PRESETS.custom).every((value) => value === null)).toBe(true);
  });
});

describe('comicSettingsFromConfig', () => {
  it('reads a full block', () => {
    const { settings, issues } = comicSettingsFromConfig({ comic: { preset: 'manga', sfxAsCue: true, limits: { maxPanelsPerPage: 6, maxWordsPerBalloon: null } } });
    expect(issues).toEqual([]);
    expect(settings).toEqual({ preset: 'manga', sfxAsCue: true, limits: { maxPanelsPerPage: 6, maxWordsPerBalloon: null } });
  });

  it('returns nothing, and no issue, when the block is absent', () => {
    expect(comicSettingsFromConfig({})).toEqual({ settings: {}, issues: [] });
  });

  it('drops bad parts, reports each, and keeps the good ones', () => {
    const { settings, issues } = comicSettingsFromConfig({
      comic: { preset: 'superhero', sfxAsCue: 'yes', limits: { maxPanelsPerPage: 0, maxBalloonsPerPanel: 2.5, bogus: 1, maxWordsPerPanel: 40 } },
    });
    expect(settings).toEqual({ limits: { maxWordsPerPanel: 40 } });
    expect(issues).toHaveLength(5);
  });

  it('ignores a block that is not an object, and a limits value that is not an object', () => {
    expect(comicSettingsFromConfig({ comic: 'manga' }).issues).toHaveLength(1);
    expect(comicSettingsFromConfig({ comic: { limits: [1] } }).issues).toHaveLength(1);
  });
});

describe('resolveComicSettings', () => {
  it('falls back to the built-in western default', () => {
    expect(resolveComicSettings()).toMatchObject({ preset: 'western', presetSource: 'default', limits: COMIC_PRESETS.western, overriddenLimits: [], sfxAsCue: false });
  });

  it('prefers the user-level preset over the default, and the project preset over both', () => {
    expect(resolveComicSettings(undefined, 'manga')).toMatchObject({ preset: 'manga', presetSource: 'user' });
    expect(resolveComicSettings({ preset: 'webtoon' }, 'manga')).toMatchObject({ preset: 'webtoon', presetSource: 'project' });
  });

  it('ignores an unknown user-level preset', () => {
    expect(resolveComicSettings(undefined, 'nonsense').preset).toBe('western');
  });

  it('applies comic.limits over the preset per limit, including null, and records which', () => {
    const resolved = resolveComicSettings({ preset: 'manga', limits: { maxPanelsPerPage: null, maxBalloonsPerPanel: 4 } });
    expect(resolved.limits).toEqual({ maxPanelsPerPage: null, maxBalloonsPerPanel: 4, maxWordsPerBalloon: 25, maxWordsPerPanel: 35 });
    expect(resolved.overriddenLimits).toEqual(['maxPanelsPerPage', 'maxBalloonsPerPanel']);
  });

  it('carries sfxAsCue', () => {
    expect(resolveComicSettings({ sfxAsCue: true }).sfxAsCue).toBe(true);
  });
});

describe('describeLimitSource', () => {
  it('names the project override or the preset', () => {
    expect(describeLimitSource('manga', ['maxPanelsPerPage'], 'maxPanelsPerPage')).toBe('comic.limits.maxPanelsPerPage');
    expect(describeLimitSource('manga', ['maxPanelsPerPage'], 'maxWordsPerPanel')).toBe('manga preset');
  });
});

describe('word-budget notes under a preset', () => {
  const tenPanels = ['PAGE: 1', ...Array.from({ length: 10 }, (_, i) => `\nPANEL: Panel ${i}.`)].join('\n');
  const codes = (text: string, resolved = resolveComicSettings()): string[] =>
    buildPageMap(text, [], { preset: resolved.preset, limits: resolved.limits, overriddenLimits: resolved.overriddenLimits }).issues.map((i) => i.code);

  it('flags 10 panels on a western or manga page but not on webtoon, european or custom', () => {
    expect(codes(tenPanels)).toEqual(['many-panels']);
    expect(codes(tenPanels, resolveComicSettings({ preset: 'manga' }))).toEqual(['many-panels']);
    for (const preset of ['webtoon', 'european', 'custom'] as const) {
      expect(codes(tenPanels, resolveComicSettings({ preset }))).toEqual([]);
    }
  });

  it('switches a single note off with null while the others still fire', () => {
    const long = Array.from({ length: 40 }, () => 'word').join(' ');
    const text = `PAGE: 1\n\nPANEL: Talky.\n\nMARA\n${long}\n`;
    expect(codes(text)).toEqual(expect.arrayContaining(['long-balloon', 'long-panel-dialogue']));
    expect(codes(text, resolveComicSettings({ limits: { maxWordsPerBalloon: null } }))).toEqual(['long-panel-dialogue']);
  });
});
