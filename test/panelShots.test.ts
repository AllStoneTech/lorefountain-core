/**
 * Tests for "panels as shots" (ADR-0003): panel tags, `DURATION:`/`MOVE:`/`TURN`
 * parsing, `comics/panelShots.ts` derivation (spoken, cues, narrator captions,
 * precedence), unchanged screenplay and print-comic behavior, the
 * `.pages.json` schema additions, and a golden narrated-comic script checked
 * against a strict schema of the `.shots.json` entry contract.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { resolveComicSettings, comicSettingsFromConfig } from '../src/comics/limits';
import { buildPageMap } from '../src/comics/pageMap';
import { buildPageSidecar, pageSidecarSchema } from '../src/comics/pageSidecar';
import { COMIC_NARRATOR_SPEAKER, buildShotMapFromPages } from '../src/comics/panelShots';
import { defaultPanelTag, resolvePanelTags } from '../src/comics/panelTags';
import { extractComic, motionFromMoveText } from '../src/comics/parseComic';
import { matchComicLine } from '../src/fountain/conventions';
import { buildShotMap, type ShotMapEntity } from '../src/shots/shotMap';

const ENTITIES: ShotMapEntity[] = [
  { id: 'winona', type: 'character', names: ['Winona'] },
  { id: 'harbor', type: 'location', names: ['The Harbor'] },
  { id: 'narrator', type: 'character', names: ['Narrator'] },
];

const text = (...parts: string[]): string => `${parts.join('\n')}\n`;

describe('MOVE: and the panel additions (parsing)', () => {
  it('reads MOVE: as a comic line only', () => {
    expect(matchComicLine('MOVE: slow zoom in')).toEqual({ keyword: 'MOVE', rest: 'slow zoom in', forced: false });
    expect(matchComicLine('!MOVE: slow zoom in')).toEqual({ keyword: 'MOVE', rest: 'slow zoom in', forced: true });
    expect(matchComicLine('MOVE (x): a')).toBeUndefined();
    expect(matchComicLine('move: a')).toBeUndefined();
  });

  it('reads an explicit [tag], DURATION:, MOVE: and TURN on a panel', () => {
    const structure = extractComic(
      text(
        'PAGE: 6 (TURN)',
        '',
        'PANEL: [harbor-wide] Wide shot of the harbor.',
        'DURATION: about 4 seconds',
        'MOVE: slow zoom in',
        '',
        'PANEL: A gull.',
        'DURATION: quick',
      ),
    );
    const [first, second] = structure.pages[0].panels;
    expect(first).toMatchObject({
      tag: 'harbor-wide',
      description: 'Wide shot of the harbor.',
      durationText: 'about 4 seconds',
      durationSeconds: 4,
      moveText: 'slow zoom in',
      motion: 'ken-burns-in',
      pageTurn: true,
    });
    expect(second.tag).toBeUndefined();
    expect(second).toMatchObject({ durationText: 'quick' });
    expect(second.durationSeconds).toBeUndefined();
    expect(second.pageTurn).toBeUndefined();
  });

  it('puts pageTurn only on the first panel of a TURN page', () => {
    const panels = extractComic(text('PAGE: 1', '', 'PANEL: a', '', 'PAGE: 2 (TURN)', '', 'PANEL: b', '', 'PANEL: c')).pages.flatMap((p) => p.panels);
    expect(panels.map((p) => p.pageTurn === true)).toEqual([false, true, false]);
  });

  it('keeps unknown MOVE text as written and ignores MOVE:/DURATION: outside a panel', () => {
    expect(motionFromMoveText('  swoop dramatically ')).toBe('swoop dramatically');
    const structure = extractComic(text('PAGE: 1', 'MOVE: drift', 'DURATION: 3s', '', 'PANEL: a'));
    expect(structure.pages[0].panels[0].motion).toBeUndefined();
    expect(structure.pages[0].panels[0].durationText).toBeUndefined();
  });

  it.each([
    ['slow zoom in', 'ken-burns-in'],
    ['push in slowly', 'ken-burns-in'],
    ['slow zoom out', 'ken-burns-out'],
    ['pull back', 'ken-burns-out'],
    ['slow pan left', 'pan-left'],
    ['pan right', 'pan-right'],
    ['gentle drift', 'drift'],
    ['held', 'none'],
    ['hold on the face', 'none'],
  ])('maps "%s" to %s', (move, motion) => {
    expect(motionFromMoveText(move)).toBe(motion);
  });

  it('is not misled by a [[note]] or a description starting with [[', () => {
    const [panel] = extractComic(text('PAGE: 1', '', 'PANEL: [[note]] Wide.')).pages[0].panels;
    expect(panel.tag).toBeUndefined();
    expect(panel.description).toBe('[[note]] Wide.');
  });

  it('keeps MOVE: lines inert in a non-comic scan (shot map unchanged)', () => {
    const script = text('INT. ROOM - DAY', '', 'MOVE: slow zoom in', '', 'Nothing here.');
    expect(buildShotMap(script, ENTITIES).shots[0].action.map((a) => a.text)).toContain('MOVE: slow zoom in');
  });
});

describe('panel tags', () => {
  it('derives the default from prefix, page and panel', () => {
    expect(defaultPanelTag('1x03', 1, 7, 2)).toBe('1x03-p7-2');
    expect(defaultPanelTag(undefined, 1, 7, 2)).toBe('p7-2');
    expect(defaultPanelTag('Not A Slug', 1, 7, 2)).toBe('p7-2');
    expect(defaultPanelTag('1x03', 3, undefined, 1)).toBe('1x03-pg3-1');
  });

  it('uses an explicit tag over the default and skips panel 0', () => {
    const { tags } = resolvePanelTags(
      [
        { pageIndex: 1, pageNumber: 1, panel: 0, line: 2 },
        { pageIndex: 1, pageNumber: 1, panel: 1, tag: 'opening', line: 4 },
        { pageIndex: 1, pageNumber: 1, panel: 2, line: 8 },
      ],
      '1x01',
    );
    expect(tags).toEqual([undefined, { tag: 'opening', explicit: true }, { tag: '1x01-p1-2', explicit: false }]);
  });

  it('reports a repeated explicit tag, and an explicit tag that collides with a default', () => {
    const script = text('PAGE: 1', '', 'PANEL: [a-b] one', '', 'PANEL: [a-b] two', '', 'PANEL: [x-p1-1] three', '', 'PANEL: four');
    const dup = buildPageMap(script, []).issues.filter((i) => i.code === 'duplicate-panel-tag');
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ severity: 'warning', line: 4 });

    const collide = text('PAGE: 1', '', 'PANEL: one', '', 'PANEL: [x-p1-1] two');
    expect(buildPageMap(collide, [], { tagPrefix: 'x' }).issues.map((i) => i.code)).toEqual(['duplicate-panel-tag']);
    expect(buildPageMap(collide, []).issues).toEqual([]);
  });

  it('repeats default tags when a page number repeats', () => {
    const script = text('PAGE: 1', '', 'PANEL: a', '', 'PAGE: 1', '', 'PANEL: b');
    expect(buildPageMap(script, []).issues.map((i) => i.code)).toEqual(['duplicate-page-number', 'duplicate-panel-tag']);
  });

  it('names the derived shot in the missing-description note only when panelsAsShots', () => {
    const script = text('PAGE: 1', '', 'PANEL:');
    expect(buildPageMap(script, []).issues[0].message).toContain('for the artist');
    expect(buildPageMap(script, [], { panelsAsShots: true }).issues[0]).toMatchObject({
      code: 'missing-panel-description',
      severity: 'info',
    });
    expect(buildPageMap(script, [], { panelsAsShots: true }).issues[0].message).toContain('comic.panelsAsShots');
  });
});

describe('comic.panelsAsShots config', () => {
  it('reads and resolves it, defaulting to false', () => {
    expect(resolveComicSettings().panelsAsShots).toBe(false);
    const read = comicSettingsFromConfig({ comic: { panelsAsShots: true } } as never);
    expect(read.settings.panelsAsShots).toBe(true);
    expect(resolveComicSettings(read.settings).panelsAsShots).toBe(true);
    const bad = comicSettingsFromConfig({ comic: { panelsAsShots: 'yes' } } as never);
    expect(bad.settings.panelsAsShots).toBeUndefined();
    expect(bad.issues[0]).toContain('comic.panelsAsShots');
  });
});

/** A small narrated comic: lines are numbered in comments (0-based). */
const NARRATED = text(
  'Title: The Harbor', // 0
  'Production Code: 1x01', // 1
  '', // 2
  'INT. THE HARBOR - DAWN', // 3
  '', // 4
  'PAGE: 1', // 5
  '', // 6
  'PANEL: [harbor-wide] Wide shot of the harbor. WINONA stands on the pier.', // 7
  'POSE: Winona, arms folded', // 8
  'LIGHT: low gold sun', // 9
  'DURATION: 5s', // 10
  'MOVE: slow zoom in', // 11
  'MUSIC: [dawn-theme] IN', // 12
  '', // 13
  'CAPTION: Dawn, 1925.', // 14
  '', // 15
  'SFX: [gull-cry] KRAAAW', // 16
  '', // 17
  'PANEL: Close on Winona.', // 18
  '', // 19
  'WINONA (O.P.)', // 20
  '(whispering)', // 21
  'We should go.', // 22
  '', // 23
  'CAPTION (WINONA): She never looked back.', // 24
  '', // 25
  'PAGE: 2 (TURN)', // 26
  '', // 27
  'PANEL: The boat is gone.', // 28
);

describe('buildShotMapFromPages', () => {
  const map = buildShotMapFromPages(NARRATED, ENTITIES, { tagPrefix: '1x01' });

  it('derives one shot per panel with tags, scene, order and hints', () => {
    expect(map.derivedFromPanels).toBe(true);
    expect(map.hasExplicitShots).toBe(false);
    expect(map.shots.map((s) => [s.scene, s.shot, s.tag, s.page, s.panel])).toEqual([
      [1, 1, 'harbor-wide', 1, 1],
      [1, 2, '1x01-p1-2', 1, 2],
      [1, 3, '1x01-p2-1', 2, 1],
    ]);
    const [a, b, c] = map.shots;
    expect(a).toMatchObject({
      sceneHeading: 'INT. THE HARBOR - DAWN',
      intExt: 'INT',
      locations: ['harbor'],
      description: 'Wide shot of the harbor. WINONA stands on the pier.',
      pose: 'Winona, arms folded',
      light: 'low gold sun',
      durationText: '5s',
      durationSeconds: 5,
      motion: 'ken-burns-in',
      pageLabel: '1',
      entities: ['harbor', 'winona'],
      lines: { start: 7, end: 17 },
    });
    expect(a.pageTurn).toBeUndefined();
    expect(b.motion).toBeUndefined();
    expect(c.pageTurn).toBe(true);
  });

  it('makes balloons and captions spoken lines in reading order, directions first', () => {
    const [a, b] = map.shots;
    expect(a.spoken).toEqual([
      { speaker: 'NARRATOR', speakerEntity: 'narrator', extensions: ['V.O.'], text: 'Dawn, 1925.', caption: true, line: 14 },
    ]);
    expect(b.spoken).toEqual([
      { direction: '(whispering)', speaker: 'WINONA', speakerEntity: 'winona', line: 22 },
      { speaker: 'WINONA', speakerEntity: 'winona', extensions: ['O.P.'], text: 'We should go.', line: 22 },
      { speaker: 'WINONA', speakerEntity: 'winona', extensions: ['V.O.'], text: 'She never looked back.', caption: true, line: 24 },
    ]);
  });

  it('resolves a plain caption to a NARRATOR entity when one exists', () => {
    const narrated = buildShotMapFromPages(text('PAGE: 1', '', 'PANEL: a', '', 'CAPTION: Hi.'), ENTITIES);
    expect(COMIC_NARRATOR_SPEAKER).toBe('NARRATOR');
    expect(narrated.shots[0].spoken[0]).toMatchObject({ speaker: 'NARRATOR', speakerEntity: 'narrator', caption: true });
    const none = buildShotMapFromPages(text('PAGE: 1', '', 'PANEL: a', '', 'CAPTION: Hi.'), []);
    expect(none.shots[0].spoken[0]).not.toHaveProperty('speakerEntity');
  });

  it('turns a pause parenthetical into a speaker pause', () => {
    const shot = buildShotMapFromPages(text('PAGE: 1', '', 'PANEL: a', '', 'WINONA', '(beat)', 'Go.'), ENTITIES).shots[0];
    expect(shot.spoken[0]).toMatchObject({ pause: 'speaker', direction: '(beat)', speaker: 'WINONA' });
  });

  it('links MUSIC: by line range and lists lettered SFX: as a cue only when sfxAsCue is true', () => {
    expect(map.shots[0].cues).toEqual([12]);
    const asCue = buildShotMapFromPages(NARRATED, ENTITIES, { tagPrefix: '1x01', sfxAsCue: true });
    expect(asCue.shots[0].cues).toEqual([12, 16]);
    expect(asCue.shots[0].spoken.some((entry) => 'text' in entry && entry.text === 'KRAAAW')).toBe(false);
  });

  it('works without a prefix and for a page with a text label', () => {
    const shots = buildShotMapFromPages(text('PAGE: INSIDE FRONT COVER', '', 'PANEL: a', '', 'PAGE: 7', '', 'PANEL: b'), []).shots;
    expect(shots.map((s) => s.tag)).toEqual(['pg1-1', 'p7-1']);
    expect(shots[0].page).toBeUndefined();
    expect(shots[0].pageLabel).toBe('INSIDE FRONT COVER');
  });

  it('numbers shots per scene and drops lettering that sits outside any panel', () => {
    const script = text('INT. A - DAY', '', 'PAGE: 1', '', 'PANEL: a', '', 'INT. B - NIGHT', '', 'PANEL: b', '', 'PAGE: 2', 'CAPTION: loose', '', 'PANEL: c');
    const shots = buildShotMapFromPages(script, []).shots;
    expect(shots.map((s) => [s.scene, s.shot])).toEqual([[1, 1], [2, 1], [2, 2]]);
  });
});

describe('precedence and unchanged scripts', () => {
  it('lets explicit SHOT: lines win and says panels were not derived', () => {
    const script = text('INT. ROOM - DAY', '', 'PAGE: 1', '', 'PANEL: a', 'SHOT: [only-shot] WIDE', '', 'PANEL: b');
    const result = buildShotMapFromPages(script, []);
    const plain = buildShotMap(script, []);
    expect(result.derivedFromPanels).toBeUndefined();
    expect(result.hasExplicitShots).toBe(true);
    expect(result.shots).toEqual(plain.shots);
    expect(result.issues.filter((i) => i.code === 'panels-not-derived')).toHaveLength(1);
    expect(result.issues.filter((i) => i.code !== 'panels-not-derived')).toEqual(plain.issues);
  });

  it('leaves a screenplay (no pages) exactly as buildShotMap makes it', () => {
    const script = text('INT. ROOM - DAY', '', 'SHOT: [a-b] WIDE', 'DURATION: 3s', '', 'WINONA', 'Hello.');
    expect(buildShotMapFromPages(script, ENTITIES)).toEqual(buildShotMap(script, ENTITIES));
    const noShots = text('INT. ROOM - DAY', '', 'WINONA', 'Hello.');
    expect(buildShotMapFromPages(noShots, ENTITIES)).toEqual(buildShotMap(noShots, ENTITIES));
  });

  it('keeps a print comic (setting off) unchanged: the ordinary builder writes no shots for it', () => {
    const result = buildShotMap(NARRATED, ENTITIES);
    expect(result.hasExplicitShots).toBe(false);
    expect(result.derivedFromPanels).toBeUndefined();
  });
});

describe('.pages.json additions', () => {
  it('records tag, duration, move and pageTurn on the panel and validates', () => {
    const result = buildPageMap(NARRATED, ENTITIES, { tagPrefix: '1x01' });
    const sidecar = buildPageSidecar('1x01.fountain', result);
    expect(pageSidecarSchema.safeParse(sidecar).success).toBe(true);
    const [first] = result.pages[0].panels;
    expect(first).toMatchObject({ tag: 'harbor-wide', durationSeconds: 5, moveText: 'slow zoom in', motion: 'ken-burns-in' });
    expect(result.pages[1].panels[0].pageTurn).toBe(true);
  });

  it('still validates a sidecar from before the additions', () => {
    const result = buildPageMap(text('PAGE: 1', '', 'PANEL: plain'), []);
    const panel = result.pages[0].panels[0];
    expect(Object.keys(panel)).not.toContain('tag');
    expect(pageSidecarSchema.safeParse(buildPageSidecar('a.fountain', result)).success).toBe(true);
  });
});

/**
 * Core publishes no Zod schema for `.shots.json` (the extension's `ShotSidecar`
 * is an interface), so this test-local strict schema states the contract the
 * Producer reads, including the additive panel hints.
 */
const lineNumber = z.number().int().min(0);
const spokenSchema = z.union([
  z
    .object({
      speaker: z.string(),
      speakerEntity: z.string().optional(),
      extensions: z.array(z.string()),
      text: z.string(),
      simultaneous: z.literal(true).optional(),
      caption: z.literal(true).optional(),
      line: lineNumber,
    })
    .strict(),
  z.object({ direction: z.string(), speaker: z.string(), speakerEntity: z.string().optional(), line: lineNumber }).strict(),
  z.object({ pause: z.literal('speaker'), direction: z.string(), speaker: z.string(), speakerEntity: z.string().optional(), line: lineNumber }).strict(),
  z.object({ pause: z.literal('scene'), durationText: z.string().optional(), durationSeconds: z.number().optional(), line: lineNumber }).strict(),
  z.object({ lyric: z.string(), line: lineNumber }).strict(),
]);
const shotEntrySchema = z
  .object({
    scene: z.number().int().min(0),
    shot: z.number().int().min(0),
    tag: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    sceneHeading: z.string().optional(),
    intExt: z.string().optional(),
    timeOfDay: z.string().optional(),
    setting: z.array(z.string()),
    locations: z.array(z.string()),
    description: z.string().optional(),
    pose: z.string().optional(),
    light: z.string().optional(),
    durationText: z.string().optional(),
    durationSeconds: z.number().optional(),
    lines: z.object({ start: lineNumber, end: lineNumber }).strict(),
    spoken: z.array(spokenSchema),
    action: z.array(z.object({ text: z.string(), line: lineNumber }).strict()),
    onScreen: z.array(z.object({ kind: z.string(), tag: z.string().optional(), text: z.string(), line: lineNumber }).strict()),
    transition: z.string().optional(),
    entities: z.array(z.string()),
    cues: z.array(lineNumber),
    page: z.number().int().min(0).optional(),
    pageLabel: z.string().optional(),
    panel: z.number().int().min(1).optional(),
    motion: z.string().optional(),
    pageTurn: z.literal(true).optional(),
  })
  .strict();

describe('golden narrated comic', () => {
  it('derives a .shots.json whose entries match the contract, with unique tags', () => {
    const result = buildShotMapFromPages(NARRATED, ENTITIES, { tagPrefix: '1x01', sfxAsCue: true });
    const sidecar = { schema_version: 1, script: '1x01.fountain', shots: JSON.parse(JSON.stringify(result.shots)) as unknown };
    const parsed = z.object({ schema_version: z.literal(1), script: z.string(), shots: z.array(shotEntrySchema) }).strict().safeParse(sidecar);
    expect(parsed.error?.issues ?? []).toEqual([]);
    const tags = result.shots.map((shot) => shot.tag);
    expect(new Set(tags).size).toBe(tags.length);
    // Lines are within the file and ordered.
    const starts = result.shots.map((shot) => shot.lines.start);
    expect([...starts].sort((x, y) => x - y)).toEqual(starts);
  });

  it('keeps the entry key order stable', () => {
    const [shot] = buildShotMapFromPages(NARRATED, ENTITIES, { tagPrefix: '1x01' }).shots;
    expect(Object.keys(shot)).toEqual([
      'scene', 'shot', 'tag', 'sceneHeading', 'intExt', 'timeOfDay', 'setting', 'locations', 'description', 'pose', 'light',
      'durationText', 'durationSeconds', 'lines', 'spoken', 'action', 'onScreen', 'entities', 'cues',
      'page', 'pageLabel', 'panel', 'motion',
    ]);
  });
});
