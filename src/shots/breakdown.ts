/**
 * The per-script breakdown: for each scene, who is in it and in which looks,
 * where it is set, which objects it mentions, the sound cues it starts, and
 * the on-screen text it shows. It is derived from the shot map, so it never
 * disagrees with `.shots.json`; products write it as `<script>.breakdown.json`.
 *
 * Exports {@link buildBreakdown}, {@link breakdownPathFor} and the result
 * types. Pure: entity knowledge and cues come in from the caller.
 *
 * Rules:
 * - **Cast** is every character entity that speaks in the scene or is
 *   mentioned in a shot's own text, in order of first appearance. A character's
 *   `looks` are the distinct looks in effect across the scene's shots (a look
 *   carries over from earlier scenes until the character's next `LOOK:`), so
 *   a shot counts the look it starts in as well as the one it ends in.
 * - **Props** are mentioned entities of type `object`.
 * - **Locations** are the scene heading's resolved location ids plus any
 *   location entity a shot names.
 * - **Sounds** are the `SFX:`/`MUSIC:`/`AMB:` cues that start in the scene's
 *   shots. Content before the first scene heading is scene 0.
 */

import type { CueEntry } from '../cues/parseCues';
import type { ShotMapEntity, ShotMapEntry, ShotMapResult } from './shotMap';

/** A character in a scene and the looks they wear in it. */
export interface BreakdownCast {
  /** The character entity's id. */
  entity: string;
  /** Distinct looks in effect across the scene's shots, in order; empty when none was written. */
  looks: string[];
}

/** A sound cue that starts in a scene. */
export interface BreakdownSound {
  type: CueEntry['type'];
  tag?: string;
  description: string;
  line: number;
}

/** A piece of on-screen text in a scene. */
export interface BreakdownText {
  kind: string;
  tag?: string;
  text: string;
  line: number;
}

/** One scene's breakdown. */
export interface SceneBreakdown {
  /** Scene number (1-based), or 0 for content before the first heading. */
  scene: number;
  sceneHeading?: string;
  /** Shot tags in the scene, in order; `scene.shot` (e.g. `3.2`) for an untagged shot. */
  shots: string[];
  cast: BreakdownCast[];
  /** Location entity ids. */
  locations: string[];
  /** Object entity ids. */
  props: string[];
  sounds: BreakdownSound[];
  onScreen: BreakdownText[];
}

/** A whole script's breakdown. */
export interface ScriptBreakdown {
  scenes: SceneBreakdown[];
}

/**
 * The breakdown sidecar's path for a script: `<script>.breakdown.json`
 * beside it, like `.shots.json` and `.cues.json`.
 *
 * @param scriptPath - The `.fountain` file's path.
 * @returns The sidecar path.
 */
export function breakdownPathFor(scriptPath: string): string {
  return `${scriptPath.replace(/\.fountain$/i, '')}.breakdown.json`;
}

/** Push a value onto a list once. */
function addOnce<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

/**
 * Build a script's breakdown from its shot map.
 *
 * @param shotMap - The script's shot map, from `buildShotMap`.
 * @param entities - Every known entity, to tell characters, locations and objects apart.
 * @param cues - The script's cues, from `extractCues` (with the same `sfxAsCue` option as the shot map), by line.
 * @returns One entry per scene, in script order.
 */
export function buildBreakdown(shotMap: ShotMapResult, entities: readonly ShotMapEntity[], cues: readonly CueEntry[]): ScriptBreakdown {
  const typeOf = new Map(entities.map((entity) => [entity.id, entity.type]));
  const scenes = new Map<number, ShotMapEntry[]>();
  for (const shot of shotMap.shots) {
    const list = scenes.get(shot.scene) ?? [];
    list.push(shot);
    scenes.set(shot.scene, list);
  }

  const previous = new Map<ShotMapEntry, ShotMapEntry | undefined>(shotMap.shots.map((shot, index) => [shot, shotMap.shots[index - 1]]));
  const result: SceneBreakdown[] = [];
  for (const [scene, shots] of scenes) {
    const cast = new Map<string, string[]>();
    const locations: string[] = [];
    const props: string[] = [];
    const sounds: BreakdownSound[] = [];
    const onScreen: BreakdownText[] = [];

    const castMember = (id: string): string[] => {
      let looks = cast.get(id);
      if (!looks) {
        looks = [];
        cast.set(id, looks);
      }
      return looks;
    };

    for (const shot of shots) {
      // The look each character is in when the shot starts is the previous shot's end state, even from an earlier scene.
      for (const active of previous.get(shot)?.activeLooks ?? []) addOnce(castMember(active.characterEntity), active.look);
      shot.locations.forEach((id) => addOnce(locations, id));
      for (const entry of shot.spoken) {
        if ('speakerEntity' in entry && entry.speakerEntity !== undefined && typeOf.get(entry.speakerEntity) === 'character') castMember(entry.speakerEntity);
      }
      for (const id of shot.entities) {
        const type = typeOf.get(id);
        if (type === 'character') castMember(id);
        else if (type === 'object') addOnce(props, id);
        else if (type === 'location') addOnce(locations, id);
      }
      // A character's look can be set on a shot where nothing else names them.
      for (const active of shot.activeLooks ?? []) {
        addOnce(castMember(active.characterEntity), active.look);
      }
      for (const cue of cues) {
        if (shot.cues.includes(cue.line)) {
          sounds.push({ type: cue.type, ...(cue.tag !== undefined ? { tag: cue.tag } : {}), description: cue.description, line: cue.line });
        }
      }
      for (const text of shot.onScreen) {
        onScreen.push({ kind: text.kind, ...(text.tag !== undefined ? { tag: text.tag } : {}), text: text.text, line: text.line });
      }
    }

    // Only characters that appear in the scene keep their carried-over look: a character who is nowhere in it has none to report.
    const appearing = new Set<string>();
    for (const shot of shots) {
      for (const entry of shot.spoken) if ('speakerEntity' in entry && entry.speakerEntity !== undefined) appearing.add(entry.speakerEntity);
      shot.entities.forEach((id) => appearing.add(id));
      (shot.looks ?? []).forEach((look) => appearing.add(look.characterEntity));
    }

    result.push({
      scene,
      ...(shots[0].sceneHeading !== undefined ? { sceneHeading: shots[0].sceneHeading } : {}),
      shots: shots.map((shot) => shot.tag ?? `${shot.scene}.${shot.shot}`),
      cast: [...cast]
        .filter(([id]) => appearing.has(id))
        .map(([entity, looks]) => ({ entity, looks })),
      locations,
      props,
      sounds,
      onScreen,
    });
  }
  return { scenes: result };
}
