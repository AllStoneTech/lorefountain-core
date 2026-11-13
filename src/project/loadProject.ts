/**
 * Read-only loading of a whole LoreFountain project: its config, entities,
 * glossary terms, timeline events, scripts (each with its shot map and cues
 * built in memory) and asset manifests.
 *
 * Exports {@link loadProject}, {@link shotMapEntitiesFrom} and the result
 * types. This is what a product other than the extension uses to read a
 * project the way the extension does.
 *
 * Gotchas:
 * - It never writes. The extension's index build also regenerates sidecars;
 *   this doesn't, and it never reads them either: shot maps and cues are
 *   rebuilt from the script text, so a stale sidecar can't mislead.
 * - Nothing throws for a bad file. Malformed entities, unreadable scripts
 *   and invalid manifests are collected in `issues`; an invalid manifest
 *   is treated as empty, as the extension does.
 * - It doesn't run the extension's cross-file checks (dangling relations,
 *   duplicate `Order` or Production Code, mentions). It loads; checks
 *   that need the whole project belong to the caller.
 */

import * as fsp from 'node:fs/promises';
import { readAudioManifest, type AudioManifest } from '../assets/audioManifest';
import {
  readCharacterAssetManifest,
  readLocationAssetManifest,
  readObjectAssetManifest,
  readVoiceAssetManifest,
  type CharacterAssetManifest,
  type DressedAssetManifest,
  type VoiceAssetManifest,
} from '../assets/entityManifest';
import type { ReadManifestFileResult } from '../assets/manifestFile';
import { readShotManifest, type ShotManifest } from '../assets/shotManifest';
import { resolveWorkspaceFolders, type WorkspaceFolders } from '../config/folders';
import { comicSettingsFromConfig, resolveComicSettings, type ResolvedComicSettings } from '../comics/limits';
import { folderSettingsFromConfig, readLoreFountainConfig } from '../config/readConfig';
import { extractCues, type CueEntry } from '../cues/parseCues';
import { parseEntityFile, type Entity, type EntityWarning } from '../model/entity';
import { parseGlossaryFile, type GlossaryTerm } from '../model/glossary';
import { parseScriptTitlePage, type Script, type ScriptWarning } from '../model/script';
import { idFromFilePath } from '../model/slug';
import { parseTimelineEventFile, type TimelineEvent } from '../model/timeline';
import { buildShotMap, type ShotMapEntity, type ShotMapResult } from '../shots/shotMap';
import { ENTITY_EXCLUDED_SUBDIRS, isNonEntityDoc, listFilesWithExtension } from './files';
import { readStyleBible, type LoadedStyleBible } from './styleBible';

/** What part of the project a load issue concerns. */
export type ProjectLoadIssueKind = 'config' | 'entity' | 'glossary' | 'event' | 'script' | 'manifest' | 'style';

/** A file that couldn't be loaded, or loaded only partly. */
export interface ProjectLoadIssue {
  kind: ProjectLoadIssueKind;
  /** Absolute path, or for a manifest its label such as `assets/manifests/shots.json`. */
  filePath: string;
  reason: string;
  message: string;
}

/** An entity that loaded, with any non-blocking warnings about it. */
export interface LoadedEntity {
  entity: Entity;
  warnings: EntityWarning[];
}

/** A script, with everything derived from its text in memory. */
export interface LoadedScript {
  filePath: string;
  text: string;
  /** Title-page metadata (title, `Order`, Production Code). */
  script: Script;
  /** Non-blocking title-page warnings. */
  titleWarnings: ScriptWarning[];
  /** The shot map, exactly as the extension would write it to `.shots.json`, plus its script issues. */
  shotMap: ShotMapResult;
  cues: CueEntry[];
}

/** Every asset manifest; an absent or invalid one is empty. */
export interface LoadedManifests {
  audio: AudioManifest;
  characters: CharacterAssetManifest;
  locations: DressedAssetManifest;
  objects: DressedAssetManifest;
  voice: VoiceAssetManifest;
  shots: ShotManifest;
}

/** Result of {@link loadProject}. */
export interface LoadedProject {
  root: string;
  folders: WorkspaceFolders;
  /** True when `lorefountain.config.json` exists. */
  configFound: boolean;
  /** The comic settings in effect (project config over built-in defaults; no user-level setting here). */
  comic: ResolvedComicSettings;
  entities: LoadedEntity[];
  glossary: GlossaryTerm[];
  events: TimelineEvent[];
  /** Scripts sorted by path. */
  scripts: LoadedScript[];
  manifests: LoadedManifests;
  /** The style bible (`world/style.lf.md`), when the project has a valid one. Missing reference images are listed on it, not in `issues`. */
  style?: LoadedStyleBible;
  issues: ProjectLoadIssue[];
}

/**
 * Load a project from disk, read only.
 *
 * @param root - Absolute path to the project root (the folder holding `lorefountain.config.json`).
 * @returns Everything that loaded, plus the issues found. Never throws for a bad project file.
 * @throws Only for unexpected filesystem errors while listing folders (not a missing folder).
 */
export async function loadProject(root: string): Promise<LoadedProject> {
  const issues: ProjectLoadIssue[] = [];

  const configResult = await readLoreFountainConfig(root);
  if (!configResult.ok) {
    issues.push({ kind: 'config', filePath: 'lorefountain.config.json', reason: configResult.reason, message: configResult.message });
  }
  const folders = resolveWorkspaceFolders(root, configResult.ok ? folderSettingsFromConfig(configResult.config) : {});
  const comicRead = configResult.ok ? comicSettingsFromConfig(configResult.config) : undefined;
  for (const message of comicRead?.issues ?? []) {
    issues.push({ kind: 'config', filePath: 'lorefountain.config.json', reason: 'invalid-schema', message });
  }
  const comic = resolveComicSettings(comicRead?.settings);

  const entities = await loadEntities(folders, issues);
  const glossary = await loadMarkdown(folders.glossary, 'glossary', issues, (text, opts) => {
    const result = parseGlossaryFile(text, opts);
    return result.ok ? { ok: true, value: result.term } : result;
  });
  const events = await loadMarkdown(folders.timeline, 'event', issues, (text, opts) => {
    const result = parseTimelineEventFile(text, opts);
    return result.ok ? { ok: true, value: result.event } : result;
  });

  const manifests = await loadManifests(folders.assets, issues);
  const styleRead = await readStyleBible(folders.world, root);
  if (styleRead.status === 'invalid') {
    issues.push({ kind: 'style', filePath: styleRead.filePath, reason: styleRead.reason, message: styleRead.message });
  } else if (styleRead.status === 'read-error') {
    issues.push({ kind: 'style', filePath: styleRead.filePath, reason: 'read-error', message: styleRead.message });
  }
  const shotEntities = shotMapEntitiesFrom(entities.map((loaded) => loaded.entity));

  const scripts: LoadedScript[] = [];
  for (const filePath of await listFilesWithExtension(folders.scripts, '.fountain')) {
    let text: string;
    try {
      text = await fsp.readFile(filePath, 'utf8');
    } catch (err) {
      issues.push({ kind: 'script', filePath, reason: 'read-error', message: errorMessage(err) });
      continue;
    }
    try {
      const { script, warnings } = parseScriptTitlePage(text, { id: idFromFilePath(filePath), filePath });
      scripts.push({
        filePath,
        text,
        script,
        titleWarnings: warnings,
        shotMap: buildShotMap(text, shotEntities),
        cues: extractCues(text, { sfxAsCue: comic.sfxAsCue }),
      });
    } catch (err) {
      // The Fountain parser can throw on some inputs; report the script rather than fail the load.
      issues.push({ kind: 'script', filePath, reason: 'parse-error', message: errorMessage(err) });
    }
  }

  return {
    root,
    folders,
    configFound: configResult.ok && configResult.found,
    comic,
    entities,
    glossary,
    events,
    scripts,
    manifests,
    ...(styleRead.status === 'ok' ? { style: styleRead.style } : {}),
    issues,
  };
}

/**
 * Turn entities into the shape the shot map resolves names against: id,
 * type, and the name plus every alias.
 *
 * @param entities - Loaded entities.
 * @returns One {@link ShotMapEntity} per entity.
 */
export function shotMapEntitiesFrom(entities: readonly Entity[]): ShotMapEntity[] {
  return entities.map((entity) => ({
    id: entity.id,
    type: entity.frontmatter.type,
    names: [entity.frontmatter.name, ...(entity.frontmatter.aliases ?? [])],
  }));
}

/** Load every entity file under the world folder. */
async function loadEntities(folders: WorkspaceFolders, issues: ProjectLoadIssue[]): Promise<LoadedEntity[]> {
  const files = (await listFilesWithExtension(folders.world, '.md', ENTITY_EXCLUDED_SUBDIRS)).filter(
    (filePath) => !isNonEntityDoc(filePath),
  );
  const loaded: LoadedEntity[] = [];
  for (const filePath of files) {
    const text = await readText(filePath, 'entity', issues);
    if (text === undefined) continue;
    const result = parseEntityFile(text, { id: idFromFilePath(filePath), filePath });
    if (result.ok) loaded.push({ entity: result.entity, warnings: result.warnings });
    else issues.push({ kind: 'entity', filePath, reason: result.reason, message: result.message });
  }
  return loaded;
}

/** A parse outcome normalized for {@link loadMarkdown}. */
type MarkdownParse<T> = { ok: true; value: T } | { ok: false; reason: string; message: string };

/** Load every `.md` file in one folder with `parse`, collecting failures. */
async function loadMarkdown<T>(
  dir: string,
  kind: ProjectLoadIssueKind,
  issues: ProjectLoadIssue[],
  parse: (text: string, opts: { id: string; filePath: string }) => MarkdownParse<T>,
): Promise<T[]> {
  const files = (await listFilesWithExtension(dir, '.md')).filter((filePath) => !isNonEntityDoc(filePath));
  const loaded: T[] = [];
  for (const filePath of files) {
    const text = await readText(filePath, kind, issues);
    if (text === undefined) continue;
    const result = parse(text, { id: idFromFilePath(filePath), filePath });
    if (result.ok) loaded.push(result.value);
    else issues.push({ kind, filePath, reason: result.reason, message: result.message });
  }
  return loaded;
}

/** Read a file's text, recording a read error as an issue. */
async function readText(filePath: string, kind: ProjectLoadIssueKind, issues: ProjectLoadIssue[]): Promise<string | undefined> {
  try {
    return await fsp.readFile(filePath, 'utf8');
  } catch (err) {
    issues.push({ kind, filePath, reason: 'read-error', message: errorMessage(err) });
    return undefined;
  }
}

/** Read every asset manifest, treating an invalid one as empty and reporting it. */
async function loadManifests(assetsRoot: string, issues: ProjectLoadIssue[]): Promise<LoadedManifests> {
  const [audio, characters, locations, objects, voice, shots] = await Promise.all([
    readAudioManifest(assetsRoot),
    readCharacterAssetManifest(assetsRoot),
    readLocationAssetManifest(assetsRoot),
    readObjectAssetManifest(assetsRoot),
    readVoiceAssetManifest(assetsRoot),
    readShotManifest(assetsRoot),
  ]);
  const take = <T>(label: string, result: ReadManifestFileResult<T>, empty: T): T => {
    if (result.ok) return result.manifest;
    issues.push({ kind: 'manifest', filePath: label, reason: result.reason, message: result.message });
    return empty;
  };
  return {
    audio: take('assets/manifests/audio.json', audio, {}),
    characters: take('assets/manifests/characters.json', characters, {}),
    locations: take('assets/manifests/locations.json', locations, {}),
    objects: take('assets/manifests/objects.json', objects, {}),
    voice: take('assets/manifests/voice.json', voice, {}),
    shots: take('assets/manifests/shots.json', shots, {}),
  };
}

/** Extract a message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
