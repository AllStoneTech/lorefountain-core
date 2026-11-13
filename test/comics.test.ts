/**
 * Unit tests for the comic script convention (`comics/parseComic.ts`,
 * `comics/pageMap.ts`, `comics/pageSidecar.ts`) and its hooks in
 * `fountain/conventions.ts` and `shots/scanScript.ts`: page-line parsing,
 * structure, lettering order, entity and count enrichment, issues, coexistence
 * with SHOT:/SFX:/MUSIC:, and the sidecar schema.
 */

import { describe, expect, it } from 'vitest';
import { extractCues } from '../src/cues/parseCues';
import { matchComicLine } from '../src/fountain/conventions';
import { buildPageMap, DEFAULT_PAGE_LIMITS, type ScriptPageIssue } from '../src/comics/pageMap';
import { countWords, extractComic, parsePageLine } from '../src/comics/parseComic';
import { buildPageSidecar, pageSidecarPathFor, pageSidecarSchema, parsePageSidecarText } from '../src/comics/pageSidecar';
import { buildShotMap } from '../src/shots/shotMap';
import { scanScript } from '../src/shots/scanScript';

const WINONA = { id: 'winona', type: 'character', names: ['Winona'] };
const HARBOR = { id: 'harbor', type: 'location', names: ['The Harbor'] };

const codes = (issues: readonly ScriptPageIssue[]): string[] => issues.map((i) => i.code);
const lines = (...parts: string[]): string => parts.join('\n');

describe('matchComicLine', () => {
  it('reads PAGE, PANEL and LAYOUT lines', () => {
    expect(matchComicLine('PAGE: 7 (SPLASH)')).toEqual({ keyword: 'PAGE', rest: '7 (SPLASH)' });
    expect(matchComicLine('  PANEL: Wide shot.')).toEqual({ keyword: 'PANEL', rest: 'Wide shot.' });
    expect(matchComicLine('LAYOUT: three tiers')).toEqual({ keyword: 'LAYOUT', rest: 'three tiers' });
  });

  it('reads a CAPTION speaker only on CAPTION', () => {
    expect(matchComicLine('CAPTION (LUCIEN): Years later.')).toEqual({ keyword: 'CAPTION', qualifier: 'LUCIEN', rest: 'Years later.' });
    expect(matchComicLine('CAPTION: Dawn.')).toEqual({ keyword: 'CAPTION', rest: 'Dawn.' });
    expect(matchComicLine('CAPTION (): Dawn.')).toEqual({ keyword: 'CAPTION', rest: 'Dawn.' });
    expect(matchComicLine('PAGE (x): 3')).toBeUndefined();
  });

  it.each(['Page: 1', 'PAGE 1', 'PAGE TURN', 'PAGE : 1', 'PANELS: x', 'see PAGE: 2'])('is case- and shape-exact: %s', (line) => {
    expect(matchComicLine(line)).toBeUndefined();
  });
});

describe('parsePageLine', () => {
  it('reads a number, a range and modifiers', () => {
    expect(parsePageLine('7')).toEqual({ label: '7', number: 7, modifiers: [] });
    expect(parsePageLine('7 (splash)')).toEqual({ label: '7', number: 7, modifiers: ['SPLASH'] });
    expect(parsePageLine('2-3 (SPREAD, turn)')).toEqual({ label: '2-3', number: 2, endNumber: 3, modifiers: ['SPREAD', 'TURN'] });
    expect(parsePageLine('2–3')).toMatchObject({ number: 2, endNumber: 3 });
  });

  it('keeps a non-numeric label whole', () => {
    expect(parsePageLine('INSIDE FRONT COVER')).toEqual({ label: 'INSIDE FRONT COVER', modifiers: [] });
    expect(parsePageLine('')).toEqual({ label: '', modifiers: [] });
  });

  it('does not read a backwards or huge range as a range', () => {
    expect(parsePageLine('5-3')).toEqual({ label: '5-3', number: 5, modifiers: [] });
    expect(parsePageLine('1-100000')).toEqual({ label: '1-100000', number: 1, modifiers: [] });
  });
});

describe('countWords', () => {
  it('counts word-like tokens only', () => {
    expect(countWords('We should go.')).toBe(3);
    expect(countWords('Wait — what... ?')).toBe(2);
    expect(countWords('')).toBe(0);
    expect(countWords("Don't stop 42 times")).toBe(4);
  });

  it('ignores Fountain notes', () => {
    expect(countWords('Go [[Winona]] home')).toBe(2);
  });
});

describe('scanScript comic option', () => {
  const script = 'INT. A - DAY\n\nPAGE: 1\n\nPANEL: Wide.\n';

  it('leaves PAGE:/PANEL: as action by default', () => {
    expect(scanScript(script).map((item) => item.kind)).toEqual(['heading', 'action', 'action']);
  });

  it('reads them as directives with comic: true', () => {
    const items = scanScript(script, { comic: true });
    expect(items.map((item) => item.kind === 'directive' && item.keyword)).toEqual([false, 'PAGE', 'PANEL']);
  });

  it('turns an all-caps PAGE: line Fountain misreads as a character cue back into directives', () => {
    const items = scanScript('INT. A - DAY\n\nPAGE: 7 (SPLASH)\nPANEL: Wide.\nSANGO waits.\n', { comic: true });
    expect(items.map((item) => item.kind)).toEqual(['heading', 'directive', 'directive', 'action']);
  });
});

describe('extractComic', () => {
  it('returns nothing for a script without pages', () => {
    const result = extractComic('Title: X\n\nINT. A - DAY\n\nMARA\nHi.\n');
    expect(result.pages).toEqual([]);
    expect(result.hasPages).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it('builds pages, panels and line ranges', () => {
    const script = lines('PAGE: 1', '', 'PANEL: First.', '', 'PANEL: Second.', '', 'PAGE: 2', '', 'PANEL: Third.', '');
    const { pages } = extractComic(script);
    expect(pages.map((p) => [p.label, p.lines])).toEqual([
      ['1', { start: 0, end: 5 }],
      ['2', { start: 6, end: 8 }],
    ]);
    expect(pages[0].panels.map((p) => [p.number, p.description, p.lines])).toEqual([
      [1, 'First.', { start: 2, end: 3 }],
      [2, 'Second.', { start: 4, end: 5 }],
    ]);
    expect(pages[1].panels[0].number).toBe(1);
  });

  it('puts lettering in reading order with captions, sfx and balloons', () => {
    const script = lines(
      'PAGE: 1', '', 'PANEL: A door.', '', 'CAPTION (LUCIEN): It began here.', '', 'MARA', 'Hello.', '',
      'SFX: [door-slam] SLAM', '', 'CAPTION: Later.', '',
    );
    const [panel] = extractComic(script).pages[0].panels;
    expect(panel.lettering.map((l) => l.kind)).toEqual(['caption', 'balloon', 'sfx', 'caption']);
    expect(panel.lettering[0]).toMatchObject({ speaker: 'LUCIEN', text: 'It began here.' });
    expect(panel.lettering[2]).toMatchObject({ text: 'SLAM', tag: 'door-slam' });
  });

  it('reads balloon extensions, off-panel, dual dialogue and parentheticals', () => {
    const script = lines(
      'PAGE: 1', '', 'PANEL: Two talk.', '', 'MARA (O.P.)', '(whispering)', 'We go now.', '',
      'THEO ^', 'No.', '', "MARA (THOUGHT) (CONT'D)", 'Fine.', '(sighs)', '',
    );
    const balloons = extractComic(script).pages[0].panels[0].lettering.filter((l) => l.kind === 'balloon');
    expect(balloons[0]).toMatchObject({ speaker: 'MARA', extensions: ['O.P.'], offPanel: true, directions: ['(whispering)'], text: 'We go now.' });
    expect(balloons[1]).toMatchObject({ speaker: 'THEO', simultaneous: true, directions: [] });
    expect(balloons[2]).toMatchObject({ extensions: ['THOUGHT'], directions: ['(sighs)'] });
    expect(balloons[2]).not.toHaveProperty('offPanel');
  });

  it('reads panel detail lines and merges action blocks', () => {
    const script = lines(
      'PAGE: 1', 'Page note line.', 'LAYOUT: 3 tiers', '', 'PANEL: Wide.', 'LAYOUT: top tier, wide',
      'SHOT: [wide-a] WIDE, low angle', 'POSE: Winona, arms folded', 'LIGHT: cold dawn', 'More direction.', 'Still more.', '',
    );
    const [page] = extractComic(script).pages;
    expect(page.layout).toBe('3 tiers');
    expect(page.notes).toEqual([{ text: 'Page note line.', line: 1 }]);
    expect(page.panels[0]).toMatchObject({ layout: 'top tier, wide', shot: 'WIDE, low angle', pose: 'Winona, arms folded', light: 'cold dawn' });
    expect(page.panels[0].action).toEqual([{ text: 'More direction.\nStill more.', line: 9 }]);
  });

  it('keeps the last value when a panel detail repeats, and ignores details outside a panel', () => {
    const [page] = extractComic('PAGE: 1\nPOSE: ignored\n\nPANEL: P.\nPOSE: one\nPOSE: two\n').pages;
    expect(page.panels[0].pose).toBe('two');
  });

  it('treats scene headings as transparent and records the scene on each panel', () => {
    const script = lines(
      'INT. HOUSE - DAY', '', 'PAGE: 1', '', 'PANEL: In the house.', '', 'EXT. THE HARBOR - DAWN', '',
      'PANEL: At the harbor.', '', 'PAGE: 2', '', 'PANEL: Still at the harbor.', '',
    );
    const { pages } = extractComic(script);
    expect(pages).toHaveLength(2);
    expect(pages[0].panels.map((p) => [p.scene, p.sceneHeading])).toEqual([
      [1, 'INT. HOUSE - DAY'],
      [2, 'EXT. THE HARBOR - DAWN'],
    ]);
    expect(pages[1].panels[0].scene).toBe(2);
  });

  it('records scene 0 with no heading before the first scene heading', () => {
    const [panel] = extractComic('PAGE: 1\n\nPANEL: P.\n').pages[0].panels;
    expect(panel.scene).toBe(0);
    expect(panel).not.toHaveProperty('sceneHeading');
  });

  it('ignores PAGE:/PANEL:/lettering inside a boneyard', () => {
    const script = 'PAGE: 1\n\nPANEL: Real.\n\n/*\nPAGE: 2\n\nPANEL: Cut.\n\nMARA\nCut line.\n*/\n\nPAGE: 3\n\nPANEL: Also real.\n';
    const { pages } = extractComic(script);
    expect(pages.map((p) => p.label)).toEqual(['1', '3']);
    expect(pages[0].panels[0].lettering).toEqual([]);
  });

  it('reads a stacked all-caps PAGE:/PANEL: block that Fountain misreads as a character', () => {
    const script = 'INT. A - DAY\n\nPAGE: 7 (SPLASH)\nPANEL: WIDE ON THE PIER\nWinona stands there.\n\nMARA\nHi.\n';
    const [page] = extractComic(script).pages;
    expect(page.label).toBe('7');
    expect(page.modifiers).toEqual(['SPLASH']);
    expect(page.panels[0].description).toBe('WIDE ON THE PIER');
    expect(page.panels[0].action[0].text).toBe('Winona stands there.');
    expect(page.panels[0].lettering).toHaveLength(1);
  });

  it('handles CRLF line endings', () => {
    const [panel] = extractComic('PAGE: 1\r\n\r\nPANEL: P.\r\n\r\nMARA\r\nHi.\r\n').pages[0].panels;
    expect(panel.lettering[0]).toMatchObject({ text: 'Hi.', line: 5 });
  });

  describe('malformed ordering', () => {
    it('keeps a panel before any page on an implicit page 0 and reports it', () => {
      const result = extractComic('PANEL: Orphan.\n\nPAGE: 1\n\nPANEL: Real.\n');
      expect(result.pages.map((p) => [p.index, p.implicit, p.label])).toEqual([
        [0, true, ''],
        [1, undefined, '1'],
      ]);
      expect(result.issues.map((i) => i.code)).toEqual(['panel-before-page']);
      expect(result.hasPages).toBe(true);
    });

    it('is not a comic when only an implicit page exists', () => {
      expect(extractComic('PANEL: Orphan.\n').hasPages).toBe(false);
    });

    it("puts lettering before a page's first panel in panel 0, reported once per run", () => {
      const result = extractComic('PAGE: 1\n\nCAPTION: Early.\n\nMARA\nHi.\n\nPANEL: Now.\n');
      const panels = result.pages[0].panels;
      expect(panels.map((p) => p.number)).toEqual([0, 1]);
      expect(panels[0].lettering).toHaveLength(2);
      expect(panels[0]).not.toHaveProperty('description');
      expect(result.issues.map((i) => i.code)).toEqual(['content-outside-panel']);
    });

    it('does not make a panel 0 for action alone', () => {
      const result = extractComic('PAGE: 1\nJust a note.\n\nPANEL: P.\n');
      expect(result.pages[0].panels.map((p) => p.number)).toEqual([1]);
      expect(result.issues).toEqual([]);
    });

    it('ignores dialogue and SFX before any page, but reports a CAPTION', () => {
      const result = extractComic('MARA\nHi.\n\nSFX: BANG\n\nCAPTION: Stray.\n\nPAGE: 1\n\nPANEL: P.\n');
      expect(result.pages[0].panels[0].lettering).toEqual([]);
      expect(result.issues.map((i) => [i.code, i.line])).toEqual([['content-outside-panel', 5]]);
    });

    it('reports a PAGE: with no label', () => {
      const result = extractComic('PAGE:\n\nPANEL: P.\n');
      expect(result.issues.map((i) => i.code)).toEqual(['missing-page-label']);
      expect(result.pages[0].label).toBe('');
    });

    it('handles back-to-back pages with no panels', () => {
      const { pages } = extractComic('PAGE: 1\nPAGE: 2\n');
      expect(pages.map((p) => [p.label, p.panels.length, p.lines])).toEqual([
        ['1', 0, { start: 0, end: 0 }],
        ['2', 0, { start: 1, end: 1 }],
      ]);
    });
  });
});

describe('buildPageMap', () => {
  const script = lines(
    'Title: Winona', '', 'INT. THE HARBOR - DAWN', '', 'PAGE: 1', '',
    'PANEL: Wide shot of the harbor. WINONA stands on the pier.', 'POSE: Winona, arms folded', '',
    'CAPTION: Dawn, 1925.', '', 'SFX: [gull-cry] KRAAAW', '', 'WINONA (O.P.)', '(whispering)', 'We should go.', '',
    'PAGE: 2-3 (SPREAD)', '', 'PANEL: Close on the lamp.', '',
  );

  it('builds pages with counts, entities and speaker resolution', () => {
    const result = buildPageMap(script, [WINONA, HARBOR]);
    expect(result.hasPages).toBe(true);
    const [one, spread] = result.pages;
    expect(one.counts).toEqual({ panels: 1, balloons: 1, captions: 1, sfx: 1, words: 5 });
    expect(one.entities).toEqual(['harbor', 'winona']);
    expect(one.panels[0].lettering[2]).toMatchObject({ kind: 'balloon', speakerEntity: 'winona' });
    expect(spread).toMatchObject({ label: '2-3', number: 2, endNumber: 3, modifiers: ['SPREAD'] });
    expect(result.totals).toEqual({ pages: 2, panels: 2, balloons: 1, captions: 1, sfx: 1, words: 5 });
  });

  it('does not count dialogue or caption text as entity mentions', () => {
    const text = 'PAGE: 1\n\nPANEL: A door.\n\nCAPTION: Winona was here.\n\nMARA\nWinona?\n';
    expect(buildPageMap(text, [WINONA]).pages[0].panels[0].entities).toEqual([]);
  });

  it('counts a caption speaker as a mention', () => {
    const text = 'PAGE: 1\n\nPANEL: A door.\n\nCAPTION (WINONA): Hush.\n';
    expect(buildPageMap(text, [WINONA]).pages[0].panels[0].entities).toEqual(['winona']);
  });

  it('never guesses an ambiguous speaker', () => {
    const entities = [WINONA, { id: 'winona-2', type: 'character', names: ['winona'] }];
    const text = 'PAGE: 1\n\nPANEL: A door.\n\nWINONA\nHi.\n';
    expect(buildPageMap(text, entities).pages[0].panels[0].lettering[0]).not.toHaveProperty('speakerEntity');
  });

  it('has no pages and no issues for a plain screenplay or an empty script', () => {
    expect(buildPageMap('INT. A - DAY\n\nMARA\nHi.\n', [])).toMatchObject({ pages: [], hasPages: false, issues: [] });
    expect(buildPageMap('', [])).toMatchObject({ pages: [], hasPages: false, issues: [] });
  });

  describe('issues', () => {
    const issuesFor = (text: string, options?: Parameters<typeof buildPageMap>[2]): ScriptPageIssue[] => buildPageMap(text, [], options).issues;

    it('reports duplicate and overlapping page numbers', () => {
      expect(codes(issuesFor('PAGE: 1\n\nPANEL: a\n\nPAGE: 1\n\nPANEL: b\n'))).toContain('duplicate-page-number');
      expect(codes(issuesFor('PAGE: 2-3\n\nPANEL: a\n\nPAGE: 3\n\nPANEL: b\n'))).toContain('duplicate-page-number');
      expect(codes(issuesFor('PAGE: COVER\n\nPANEL: a\n\nPAGE: cover\n\nPANEL: b\n'))).toContain('duplicate-page-number');
    });

    it('reports out-of-order pages as a warning and gaps as info', () => {
      const out = issuesFor('PAGE: 3\n\nPANEL: a\n\nPAGE: 2\n\nPANEL: b\n');
      expect(out.find((i) => i.code === 'page-out-of-order')).toMatchObject({ severity: 'warning', line: 4 });
      const gap = issuesFor('PAGE: 1\n\nPANEL: a\n\nPAGE: 4\n\nPANEL: b\n');
      expect(gap.find((i) => i.code === 'page-number-gap')).toMatchObject({ severity: 'info', line: 4 });
      expect(codes(issuesFor('PAGE: 1\n\nPANEL: a\n\nPAGE: 2-3\n\nPANEL: b\n\nPAGE: 4\n\nPANEL: c\n'))).toEqual([]);
    });

    it('reports empty pages, empty panels, a multi-panel splash and a spread without a range', () => {
      expect(codes(issuesFor('PAGE: 1\n'))).toEqual(['empty-page']);
      expect(codes(issuesFor('PAGE: 1\n\nPANEL:\n'))).toEqual(['missing-panel-description']);
      expect(codes(issuesFor('PAGE: 1 (SPLASH)\n\nPANEL: a\n\nPANEL: b\n'))).toEqual(['splash-multiple-panels']);
      expect(codes(issuesFor('PAGE: 2 (SPREAD)\n\nPANEL: a\n'))).toEqual(['spread-without-range']);
    });

    it('treats TURN as a plain modifier with no issue', () => {
      expect(issuesFor('PAGE: 5 (TURN)\n\nPANEL: The reveal.\n')).toEqual([]);
    });

    it('reports word-budget notes as info only, past the default limits', () => {
      const many = ['PAGE: 1', ...Array.from({ length: (DEFAULT_PAGE_LIMITS.maxPanelsPerPage ?? 0) + 1 }, (_, i) => `\nPANEL: Panel ${i}.`)].join('\n');
      expect(codes(issuesFor(many))).toEqual(['many-panels']);

      const balloons = Array.from({ length: 6 }, () => '\nMARA\nHi.\n').join('');
      expect(codes(issuesFor(`PAGE: 1\n\nPANEL: Crowd.\n${balloons}`))).toEqual(['many-balloons']);

      const long = Array.from({ length: 45 }, () => 'word').join(' ');
      const found = issuesFor(`PAGE: 1\n\nPANEL: Talky.\n\nMARA\n${long}\n`);
      expect(codes(found)).toEqual(expect.arrayContaining(['long-balloon', 'long-panel-dialogue']));
      expect(found.every((i) => i.severity === 'info')).toBe(true);
    });

    it('names the limit and preset that fired, and the override when the project set one', () => {
      const text = 'PAGE: 1\n\nPANEL: Crowd.\n\nMARA\nHi.\n\nMARA\nHi.\n\nMARA\nHi.\n\nMARA\nHi.\n';
      expect(issuesFor(text)[0].message).toContain('maxBalloonsPerPanel, western preset');
      expect(issuesFor(text, { preset: 'manga' })[0].message).toContain('manga preset');
      expect(issuesFor(text, { limits: { maxBalloonsPerPanel: 2 } })[0].message).toContain('comic.limits.maxBalloonsPerPanel');
    });

    it('lets a script author override the limits', () => {
      const text = 'PAGE: 1\n\nPANEL: a\n\nPANEL: b\n\nPANEL: c\n';
      expect(codes(issuesFor(text))).toEqual([]);
      expect(codes(issuesFor(text, { limits: { maxPanelsPerPage: 2 } }))).toEqual(['many-panels']);
    });

    it('notes a convention line other Fountain apps would read as a character cue', () => {
      const found = issuesFor('PAGE: 1\nPANEL: a\n\nPAGE: 2\n\nPANEL: b\n\nSFX: BOOM\nMARA\nHi.\n');
      expect(found.filter((i) => i.code === 'misread-as-character').map((i) => i.line)).toEqual([0, 7]);
    });

    it('does not note a convention line with a lowercase word, a blank line after it, or inside a boneyard', () => {
      const misread = (text: string): ScriptPageIssue[] => issuesFor(text).filter((i) => i.code === 'misread-as-character');
      expect(misread('PAGE: 1\n\nPANEL: a\n')).toEqual([]);
      expect(misread('PAGE: 1\n\nPANEL: Wide shot\nMARA\n')).toEqual([]);
      expect(misread('PAGE: 1\n\nPANEL: a\n\n/*\nSFX: BOOM\nx\n*/\n')).toEqual([]);
    });

    it('sorts issues by line', () => {
      const found = issuesFor('PANEL:\n\nPAGE: 3\n\nPANEL: a\n\nPAGE: 1\n\nPANEL: b\n').map((i) => i.line);
      expect(found).toEqual([...found].sort((a, b) => a - b));
    });
  });

  describe('coexistence', () => {
    const mixed = lines(
      'INT. THE HARBOR - DAWN', '', 'PAGE: 1', '', 'PANEL: Wide shot of the pier.', 'SHOT: [pier-wide] WIDE',
      'MUSIC: STING - the reveal', 'AMB: gulls and wind', '', 'SFX: [gull-cry] KRAAAW', '', 'MARA', 'Hello.', '',
    );

    it('keeps SHOT:, SFX:, MUSIC: and AMB: working in their own maps', () => {
      const shots = buildShotMap(mixed, []);
      expect(shots.hasExplicitShots).toBe(true);
      expect(shots.shots.find((s) => s.tag === 'pier-wide')).toBeDefined();
      // The SFX is lettering in a comic, so only MUSIC and AMB are audio cues unless `sfxAsCue` is set.
      expect(extractCues(mixed).map((c) => c.type)).toEqual(['music', 'amb']);
      expect(extractCues(mixed, { sfxAsCue: true }).map((c) => c.type)).toEqual(['music', 'amb', 'sfx']);
    });

    it('records SHOT: on the panel and ignores MUSIC:/AMB: there', () => {
      const [panel] = buildPageMap(mixed, []).pages[0].panels;
      expect(panel.shot).toBe('WIDE');
      expect(panel.lettering.map((l) => l.kind)).toEqual(['sfx', 'balloon']);
    });
  });
});

describe('page sidecar', () => {
  const script = 'INT. A - DAY\n\nPAGE: 1 (SPLASH)\n\nPANEL: Wide.\n\nMARA (O.P.)\n(soft)\nHi there.\n\nSFX: [x-y] BANG\n\nCAPTION (MARA): Then.\n';

  it('builds an object that satisfies its own schema', () => {
    const sidecar = buildPageSidecar('ep.fountain', buildPageMap(script, [{ id: 'mara', type: 'character', names: ['Mara'] }]));
    expect(pageSidecarSchema.safeParse(sidecar).success).toBe(true);
    expect(sidecar).toMatchObject({ schema_version: 1, script: 'ep.fountain' });
    expect(sidecar.totals).toMatchObject({ pages: 1, panels: 1, balloons: 1, captions: 1, sfx: 1 });
  });

  it('round-trips through JSON and the tolerant parser, including issues and an implicit page', () => {
    const sidecar = buildPageSidecar('ep.fountain', buildPageMap('PANEL: a\n\nPAGE: 1\n\nPANEL: b\n', []));
    expect(sidecar.issues.map((i) => i.code)).toContain('panel-before-page');
    expect(parsePageSidecarText(JSON.stringify(sidecar))).toEqual({ ok: true, sidecar });
  });

  it('reports malformed JSON, a newer version and a bad shape without throwing', () => {
    expect(parsePageSidecarText('{nope')).toMatchObject({ ok: false, reason: 'malformed-json' });
    expect(parsePageSidecarText('{"schema_version": 2}')).toMatchObject({ ok: false, reason: 'newer-version' });
    expect(parsePageSidecarText('{"schema_version": 1, "pages": 3}')).toMatchObject({ ok: false, reason: 'invalid-schema' });
    expect(parsePageSidecarText('[]')).toMatchObject({ ok: false, reason: 'invalid-schema' });
  });

  it('rejects unknown fields (strict)', () => {
    const sidecar = buildPageSidecar('ep.fountain', buildPageMap(script, []));
    expect(parsePageSidecarText(JSON.stringify({ ...sidecar, extra: 1 })).ok).toBe(false);
  });

  it('derives the sidecar path beside the script', () => {
    expect(pageSidecarPathFor('/p/scripts/ep1.fountain')).toBe('/p/scripts/ep1.pages.json');
  });
});
