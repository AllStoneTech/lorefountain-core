/**
 * `project_type` in `lorefountain.config.json`: what kind of writing project
 * this is (a feature screenplay, a comic, a serialized universe, ...).
 *
 * Exports the list of types, a {@link ProjectTypeProfile} for each (its label,
 * summary and the conventions it recommends), {@link projectTypeFromConfig}
 * to read the value tolerantly, and {@link describeProjectType} for help text.
 *
 * It names the *writing format*, never the output format: how a project is
 * rendered (video, podcast master) is the Producer's concern. A type only
 * records and recommends. It never switches a convention off, and it never
 * overrides an explicit setting such as `comic.preset`. A project with no
 * `project_type`, or `custom`, behaves exactly as before the setting existed.
 *
 * Read only, like the rest of Core: writing the config is the extension's job.
 */

import type { LoreFountainConfig } from './readConfig';

/** Every valid `project_type` value, in the order a picker should list them. */
export const PROJECT_TYPES = [
  'screenplay',
  'tv_series',
  'serialized_universe',
  'audio_drama',
  'comic',
  'prose',
  'tabletop',
  'custom',
] as const;

/** One of the {@link PROJECT_TYPES}. */
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** The LoreFountain conventions a project type recommends. Guidance only: nothing is ever disabled. */
export interface ProjectTypeFeatures {
  /** `SFX:` / `MUSIC:` / `AMB:` sound cues. */
  cues: boolean;
  /** `SHOT:` / `POSE:` / `LIGHT:` / `DURATION:` shot maps. */
  shots: boolean;
  /** Arc entities that span several episodes or seasons. */
  arcs: boolean;
  /** The continuity tools: canon status, presence, flags, doubling and the timeline. */
  continuity: boolean;
  /** `PAGE:` / `PANEL:` comic script format. */
  pagePanel: boolean;
  /** The `assets/` folder and its manifests. */
  assets: boolean;
}

/** What one project type means. */
export interface ProjectTypeProfile {
  /** The value stored in `project_type`. */
  id: ProjectType;
  /** The short name a picker shows. */
  label: string;
  /** One sentence on what kind of project this is, for the picker and help. */
  summary: string;
  /** The folder structure under `scripts/` this type is normally written in. */
  structure: string;
  /** Conventions this type recommends. */
  features: ProjectTypeFeatures;
}

const NONE: ProjectTypeFeatures = { cues: false, shots: false, arcs: false, continuity: false, pagePanel: false, assets: false };

/** The profile for every {@link ProjectType}. */
export const PROJECT_TYPE_PROFILES: Readonly<Record<ProjectType, ProjectTypeProfile>> = {
  screenplay: {
    id: 'screenplay',
    label: 'Feature screenplay',
    summary: 'One self-contained film, written in standard screenplay format.',
    structure: 'A single script, or one folder per draft.',
    features: { ...NONE },
  },
  tv_series: {
    id: 'tv_series',
    label: 'TV series or anthology',
    summary: 'A show with a fixed run, or self-contained episodes under one banner.',
    structure: 'One folder per season, one folder per episode.',
    features: { ...NONE, cues: true, shots: true },
  },
  serialized_universe: {
    id: 'serialized_universe',
    label: 'Serialized universe (arcs across seasons)',
    summary: 'A long-running original series, possibly with a frame story, whose arcs and cast carry across seasons.',
    structure: 'One folder per season, one folder per episode, with arcs tying episodes together.',
    features: { cues: true, shots: true, arcs: true, continuity: true, pagePanel: false, assets: true },
  },
  audio_drama: {
    id: 'audio_drama',
    label: 'Audio drama or podcast',
    summary: 'A story told in sound: dialogue, narration, music and effects.',
    structure: 'One folder per season, one folder per episode.',
    features: { ...NONE, cues: true },
  },
  comic: {
    id: 'comic',
    label: 'Comic or graphic novel',
    summary: 'A comic script in the Page/Panel format, written for an artist.',
    structure: 'One folder per issue (or chapter), written as PAGE and PANEL blocks.',
    features: { ...NONE, cues: true, shots: true, pagePanel: true },
  },
  prose: {
    id: 'prose',
    label: 'Novel or serial prose fiction',
    summary: 'Prose chapters, with the story bible alongside as a record of the world.',
    structure: 'One quiet .fountain file per chapter, grouped by part if you like.',
    features: { ...NONE, continuity: true },
  },
  tabletop: {
    id: 'tabletop',
    label: 'Tabletop RPG campaign',
    summary: 'A campaign run by a game master: secrets, hooks and session notes.',
    structure: 'One folder per session or episode of play.',
    features: { ...NONE, continuity: true },
  },
  custom: {
    id: 'custom',
    label: 'Something else, or leave as is',
    summary: 'No recommendation. LoreFountain behaves exactly as it did before project types existed.',
    structure: 'Whatever you already use.',
    features: { ...NONE },
  },
};

/** The outcome of {@link projectTypeFromConfig}. */
export interface ProjectTypeReadResult {
  /** The project's type, or `undefined` if the key is absent, empty or unrecognized. */
  projectType?: ProjectType;
  /** Problems found, as sentences a user can act on. Empty when the value is absent or valid. */
  issues: string[];
}

/**
 * Whether a value is a valid project type.
 *
 * @param value - Any value.
 * @returns `true` when it is one of the {@link PROJECT_TYPES}.
 */
export function isProjectType(value: unknown): value is ProjectType {
  return typeof value === 'string' && (PROJECT_TYPES as readonly string[]).includes(value);
}

/**
 * Read `project_type` from a parsed config, tolerantly: a bad value is reported
 * and ignored, never thrown, so it can't invalidate the rest of the file.
 *
 * @param config - A parsed `lorefountain.config.json`.
 * @returns The type (if valid) and any issues.
 */
export function projectTypeFromConfig(config: LoreFountainConfig): ProjectTypeReadResult {
  const value = config.project_type;
  if (value === undefined) return { issues: [] };
  if (isProjectType(value)) return { projectType: value, issues: [] };
  return {
    issues: [`project_type: expected one of ${PROJECT_TYPES.join(', ')}; ignoring it.`],
  };
}

/**
 * Describe a project type in a few plain lines, for help text and agent docs.
 *
 * @param type - The project type.
 * @returns The label, summary, structure and the recommended conventions, one per line.
 */
export function describeProjectType(type: ProjectType): string {
  const profile = PROJECT_TYPE_PROFILES[type];
  const recommended = (Object.keys(profile.features) as Array<keyof ProjectTypeFeatures>).filter((key) => profile.features[key]);
  return [
    `${profile.label} (${profile.id})`,
    profile.summary,
    `Structure: ${profile.structure}`,
    `Recommended conventions: ${recommended.length > 0 ? recommended.join(', ') : 'none beyond the basics'}`,
  ].join('\n');
}
