/**
 * Unit tests for `project/loadProject.ts` and `project/files.ts`: loading a
 * project read only, from a temporary folder.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isNonEntityDoc, listFilesWithExtension } from '../src/project/files';
import { loadProject } from '../src/project/loadProject';

let root: string;

/** Write `text` to `relativePath` under the project root, creating folders. */
function put(relativePath: string, text: string): void {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

/** Every file under `dir`, relative, sorted. */
function snapshot(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? snapshot(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
    )
    .sort();
}

const MARA = '---\nname: Mara\ntype: character\naliases: [Mara Vey]\n---\nA salvager.\n';
const SCRIPT = [
  'Title: Signal',
  'Production Code: 1x01',
  '',
  'INT. HOLLOW HOUSE - NIGHT',
  '',
  'SHOT: [1x01-wide] WIDE',
  '',
  'Mara Vey waits.',
  '',
  'MARA',
  'Hello?',
  '',
  'SFX: [door] a door slams',
  '',
].join('\n');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lorefountain-load-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('loadProject', () => {
  it('loads entities, glossary, events, scripts with shot maps and cues, and manifests', async () => {
    put('world/mara.md', MARA);
    put('world/README.md', '# not an entity\n');
    put('world/OVERVIEW.md', 'A story.\n');
    put('world/glossary/salvage.md', '---\nterm: Salvage\ndefinition: Recovered wreckage.\n---\n');
    put('scripts/Season 01/1x01-signal/1x01-signal.fountain', SCRIPT);
    put('assets/manifests/shots.json', '{ "1x01-wide": { "file": "stills/wide.png", "kind": "still" } }');

    const project = await loadProject(root);

    expect(project.configFound).toBe(false);
    expect(project.issues).toEqual([]);
    expect(project.entities.map((loaded) => loaded.entity.id)).toEqual(['mara']);
    expect(project.glossary.map((term) => term.id)).toEqual(['salvage']);
    expect(project.scripts).toHaveLength(1);
    const [script] = project.scripts;
    expect(script.script.frontmatter.productionCode).toBe('1x01');
    expect(script.shotMap.shots[0]).toMatchObject({ tag: '1x01-wide', entities: ['mara'] });
    expect(script.shotMap.shots[0].spoken).toEqual([
      { speaker: 'MARA', speakerEntity: 'mara', extensions: [], text: 'Hello?', line: 10 },
    ]);
    expect(script.cues.map((cue) => cue.tag)).toEqual(['door']);
    expect(project.manifests.shots['1x01-wide']).toMatchObject({ kind: 'still' });
    expect(project.manifests.audio).toEqual({});
  });

  it('honors folder names from lorefountain.config.json', async () => {
    put('lorefountain.config.json', '{ "folders": { "world": "lore", "scripts": "episodes" } }');
    put('lore/mara.md', MARA);
    put('episodes/1x01.fountain', SCRIPT);
    put('world/ignored.md', MARA);

    const project = await loadProject(root);

    expect(project.configFound).toBe(true);
    expect(project.folders.world).toBe(join(root, 'lore'));
    expect(project.entities).toHaveLength(1);
    expect(project.scripts).toHaveLength(1);
  });

  it('collects bad files as issues instead of throwing, and treats a bad manifest as empty', async () => {
    put('world/broken.md', '---\nname: [unclosed\n---\n');
    put('world/no-type.md', '---\nname: Nobody\n---\n');
    put('assets/manifests/audio.json', '{ not json');
    put('lorefountain.config.json', '{ "folders": { "world": 7 } }');

    const project = await loadProject(root);

    expect(project.issues.map((issue) => [issue.kind, issue.reason])).toEqual([
      ['config', 'invalid-schema'],
      ['entity', 'malformed-yaml'],
      ['entity', 'invalid-schema'],
      ['manifest', 'malformed-json'],
    ]);
    expect(project.manifests.audio).toEqual({});
    expect(project.folders.world).toBe(join(root, 'world'));
  });

  it('loads a script with a lyric directly under a character cue (fountain-js 1.2.4 crashes on it; Core ADR-0005)', async () => {
    put('scripts/a.fountain', 'INT. A - DAY\n\nMARA\n~Sing a song\n\nShe stops.\n');
    put('scripts/b.fountain', SCRIPT);

    const project = await loadProject(root);

    expect(project.scripts.map((script) => script.script.id)).toEqual(['a', 'b']);
    expect(project.issues).toEqual([]);
  });

  it('never writes anything, not even sidecars', async () => {
    put('world/mara.md', MARA);
    put('scripts/1x01.fountain', SCRIPT);
    const before = snapshot(root);

    await loadProject(root);

    expect(snapshot(root)).toEqual(before);
  });

  it('loads an empty folder as an empty project', async () => {
    const project = await loadProject(root);
    expect(project).toMatchObject({ entities: [], glossary: [], events: [], scripts: [], issues: [] });
  });
});

describe('project files', () => {
  it('lists matching files sorted, skipping excluded folders, and an absent folder as empty', async () => {
    put('world/b.md', '');
    put('world/a.md', '');
    put('world/glossary/term.md', '');
    put('world/nested/c.md', '');

    expect(await listFilesWithExtension(join(root, 'world'), '.md', ['glossary'])).toEqual([
      join(root, 'world', 'a.md'),
      join(root, 'world', 'b.md'),
      join(root, 'world', 'nested', 'c.md'),
    ]);
    expect(await listFilesWithExtension(join(root, 'missing'), '.md')).toEqual([]);
  });

  it('recognizes README.md and OVERVIEW.md in any case as non-entity docs', () => {
    expect(isNonEntityDoc('/p/world/ReadMe.md')).toBe(true);
    expect(isNonEntityDoc('/p/world/overview.MD')).toBe(true);
    expect(isNonEntityDoc('/p/world/mara.md')).toBe(false);
  });
});
