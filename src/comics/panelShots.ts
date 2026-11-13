/**
 * "Panels as shots" (ADR-0003): derive a normal shot map from a comic's
 * panels, so a narrated or "motion" comic (panel art slides with voice and
 * sound over them) feeds LoreFountain-Producer through the existing
 * `.shots.json` contract, with no change on the Producer side.
 *
 * Exports {@link buildShotMapFromPages}, {@link COMIC_NARRATOR_SPEAKER} and
 * {@link PanelShotOptions}. Pure: entity knowledge comes in as
 * {@link ShotMapEntity}s, and writing the sidecar stays in the extension.
 *
 * Rules (full detail in ADR-0003):
 * - Precedence: explicit `SHOT:` lines win. A script that has any `SHOT:` is
 *   returned exactly as `buildShotMap` makes it, and its panels are not
 *   derived (an info note says so). A script with no `PAGE:` line is returned
 *   unchanged: `derivedFromPanels` is absent.
 * - One shot per numbered panel, in document order. `shot` counts panels
 *   within the scene the panel opens in; a page boundary is not a scene boundary.
 * - Balloons become `spoken` lines (speaker, extensions, text, parentheticals as
 *   separate direction/pause entries, as for dialogue). A caption becomes a
 *   `spoken` line with `caption: true` and the V.O. extension, spoken by its
 *   `CAPTION (SPEAKER):` speaker, or by {@link COMIC_NARRATOR_SPEAKER}.
 * - Lettered `SFX:` is never `spoken`. It is a cue (`cues`) only when
 *   `sfxAsCue` is true; `MUSIC:`/`AMB:` cues are linked by line range as for shots.
 *
 * Gotchas:
 * - A panel's parentheticals carry the balloon's line (the page map keeps
 *   no per-parenthetical line) and come before the balloon's text.
 * - Lettering written under a page before its first `PANEL:` (panel 0) belongs
 *   to no shot; the page map already warns about it.
 */

import { buildPageMap, type PageMapEntry, type PanelMapEntry } from './pageMap';
import { resolvePanelTags, type PanelTagSource } from './panelTags';
import type { LetteringEntry } from './parseComic';
import { extractCues } from '../cues/parseCues';
import { scanScript, type CharacterItem } from '../shots/scanScript';
import { parseSceneHeading } from '../shots/sceneHeading';
import {
  buildShotMap,
  isSpeakerPause,
  resolveExactName,
  resolveLocations,
  speakerDirection,
  speakerPause,
  spokenLine,
  type ShotMapEntity,
  type ShotMapEntry,
  type ShotMapResult,
  type SpokenEntry,
} from '../shots/shotMap';

/**
 * The speaker of a plain `CAPTION:` (no `(SPEAKER)`): a stable id the Producer
 * casts like any character. If the project has an entity named `NARRATOR`, its
 * id is set as `speakerEntity`, so the narrator can have a voice and a look.
 */
export const COMIC_NARRATOR_SPEAKER = 'NARRATOR';

/** The cue-line extension carried by caption lines: narration is voice-over. */
const CAPTION_EXTENSION = 'V.O.';

/** Options for {@link buildShotMapFromPages}. */
export interface PanelShotOptions {
  /** The project's `comic.sfxAsCue`: lettered `SFX:` is a cue (and so listed in a shot's `cues`). Default false. */
  sfxAsCue?: boolean;
  /** Prefix for default panel tags, a slug (the script's production code, e.g. `1x03`). Omitted or not a slug: no prefix. */
  tagPrefix?: string;
}

/**
 * Build a script's shot map, deriving shots from comic panels when the script
 * is a comic with no explicit `SHOT:` lines.
 *
 * @param scriptText - The `.fountain` file's full text.
 * @param entities - Every known entity, for mention, speaker and location resolution.
 * @param options - `sfxAsCue` and the default-tag prefix; see {@link PanelShotOptions}.
 * @returns The ordinary shot map when the script has explicit shots or no pages; otherwise one derived shot per panel with `derivedFromPanels: true`.
 */
export function buildShotMapFromPages(
  scriptText: string,
  entities: readonly ShotMapEntity[],
  options: PanelShotOptions = {},
): ShotMapResult {
  const base = buildShotMap(scriptText, entities, { sfxAsCue: options.sfxAsCue });
  const map = buildPageMap(scriptText, entities, { tagPrefix: options.tagPrefix });
  if (!map.hasPages) return base;

  if (base.hasExplicitShots) {
    const firstPage = map.pages.find((page) => !page.implicit) ?? map.pages[0];
    const line = firstPage?.lines.start ?? 0;
    return {
      ...base,
      issues: [
        ...base.issues,
        {
          code: 'panels-not-derived',
          severity: 'info',
          line,
          path: `lines[${line}]`,
          message:
            'This comic has explicit SHOT: lines, so its panels are not turned into shots (comic.panelsAsShots). Remove the SHOT: lines to derive shots from panels.',
        },
      ],
    };
  }

  const cueLines = extractCues(scriptText, { sfxAsCue: options.sfxAsCue }).map((cue) => cue.line);
  const scenes = sceneContexts(scriptText, entities);

  const panels = map.pages.flatMap((page) => page.panels.map((panel) => ({ page, panel })));
  const sources: PanelTagSource[] = panels.map(({ page, panel }) => ({
    pageIndex: page.index,
    ...(page.number !== undefined ? { pageNumber: page.number } : {}),
    panel: panel.number,
    ...(panel.tag !== undefined ? { tag: panel.tag } : {}),
    line: panel.lines.start,
  }));
  const { tags } = resolvePanelTags(sources, options.tagPrefix);

  const shotInScene = new Map<number, number>();
  const shots: ShotMapEntry[] = [];
  panels.forEach(({ page, panel }, index) => {
    const resolved = tags[index];
    if (!resolved) return; // Panel 0: lettering outside any panel.
    const shot = (shotInScene.get(panel.scene) ?? 0) + 1;
    shotInScene.set(panel.scene, shot);
    shots.push(toShot(page, panel, shot, resolved.tag, scenes[panel.scene], entities, cueLines));
  });

  return { shots, hasExplicitShots: false, derivedFromPanels: true, issues: base.issues };
}

/** A scene's heading-derived fields, by scene number (index 0 is "before any heading"). */
interface SceneFields {
  intExt?: ShotMapEntry['intExt'];
  timeOfDay?: string;
  setting: string[];
  locations: string[];
}

/** Resolve every scene heading once: `result[n]` is scene `n`'s fields. */
function sceneContexts(scriptText: string, entities: readonly ShotMapEntity[]): SceneFields[] {
  const contexts: SceneFields[] = [{ setting: [], locations: [] }];
  for (const item of scanScript(scriptText)) {
    if (item.kind !== 'heading') continue;
    const parts = parseSceneHeading(item.text);
    const resolved = resolveLocations(parts.setting, entities, item);
    contexts.push({
      ...(parts.intExt !== undefined ? { intExt: parts.intExt } : {}),
      ...(parts.timeOfDay !== undefined ? { timeOfDay: parts.timeOfDay } : {}),
      setting: parts.setting,
      locations: resolved.ids,
    });
  }
  return contexts;
}

/** One panel as a shot-map entry, with keys in the documented sidecar order. */
function toShot(
  page: PageMapEntry,
  panel: PanelMapEntry,
  shot: number,
  tag: string,
  scene: SceneFields | undefined,
  entities: readonly ShotMapEntity[],
  cueLines: readonly number[],
): ShotMapEntry {
  const fields = scene ?? { setting: [], locations: [] };
  return {
    scene: panel.scene,
    shot,
    tag,
    ...(panel.sceneHeading !== undefined ? { sceneHeading: panel.sceneHeading } : {}),
    ...(fields.intExt !== undefined ? { intExt: fields.intExt } : {}),
    ...(fields.timeOfDay !== undefined ? { timeOfDay: fields.timeOfDay } : {}),
    setting: [...fields.setting],
    locations: [...fields.locations],
    ...(panel.description ? { description: panel.description } : {}),
    ...(panel.pose !== undefined ? { pose: panel.pose } : {}),
    ...(panel.light !== undefined ? { light: panel.light } : {}),
    ...(panel.durationText !== undefined ? { durationText: panel.durationText } : {}),
    ...(panel.durationSeconds !== undefined ? { durationSeconds: panel.durationSeconds } : {}),
    lines: { ...panel.lines },
    spoken: panel.lettering.flatMap((entry) => spokenFor(entry, entities)),
    action: panel.action.map((block) => ({ ...block })),
    onScreen: [],
    entities: [...panel.entities],
    cues: cueLines.filter((line) => line >= panel.lines.start && line <= panel.lines.end),
    ...(page.number !== undefined ? { page: page.number } : {}),
    pageLabel: page.label,
    panel: panel.number,
    ...(panel.motion !== undefined ? { motion: panel.motion } : {}),
    ...(panel.pageTurn ? { pageTurn: true as const } : {}),
  };
}

/** A cue-line speaker for a derived spoken line. */
function speakerFor(name: string, extensions: string[], line: number, simultaneous: boolean): CharacterItem {
  return { kind: 'character', line, name, extensions, simultaneous };
}

/** The `spoken` entries for one piece of lettering: balloons and captions speak, lettered `SFX:` does not. */
function spokenFor(entry: LetteringEntry, entities: readonly ShotMapEntity[]): SpokenEntry[] {
  if (entry.kind === 'sfx') return [];

  if (entry.kind === 'caption') {
    if (entry.text.trim() === '') return [];
    const name = entry.speaker ?? COMIC_NARRATOR_SPEAKER;
    const speakerEntity = resolveExactName(name, entities);
    return [
      {
        speaker: name,
        ...(speakerEntity !== undefined ? { speakerEntity } : {}),
        extensions: [CAPTION_EXTENSION],
        text: entry.text,
        caption: true as const,
        line: entry.line,
      },
    ];
  }

  const speaker = speakerFor(entry.speaker, entry.extensions, entry.line, entry.simultaneous === true);
  const out: SpokenEntry[] = entry.directions.map((direction) =>
    isSpeakerPause(direction)
      ? speakerPause(speaker, direction, entry.line, entities)
      : speakerDirection(speaker, direction, entry.line, entities),
  );
  out.push(spokenLine(speaker, entry.text, entry.line, entities));
  return out;
}
