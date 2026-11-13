/**
 * Unit tests for the style bible: the pure model (`src/model/styleBible.ts`),
 * the reader that resolves reference images (`src/project/styleBible.ts`) and
 * its integration into `loadProject`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePaletteEntry,
  parseStyleBibleFile,
  resolveStyleBible,
  serializeStyleBible,
  styleAppliesTo,
} from '../src/model/styleBible';
import { isNonEntityDoc, isProjectDocument } from '../src/project/files';
import { loadProject } from '../src/project/loadProject';
import { findStyleBibleFile, readStyleBible, resolveReferenceImage } from '../src/project/styleBible';

const PATH = '/p/world/style.lf.md';

function file(frontmatterLines: string[], body = ''): string {
  return ['---', ...frontmatterLines, '---', '', body].join('\n');
}

const COMIC_STYLE = file(
  [
    'medium: [comic, video]',
    'art_style: Inked 1920s pulp, flat colour',
    'palette:',
    '  - "Harbor teal #2A7F8E"',
    '  - "#d9a441"',
    '  - Bone white',
    'reference_images:',
    '  - assets/style/cover-mood.png',
    'avoid: [photorealism, 3D render]',
    'format:',
    '  comic: { trim_size: 6.625x10.25 in }',
    '  video: { aspect_ratio: "16:9" }',
    'lettering: Hand-lettered, all caps, rounded balloons',
    'era_reference: 1925 pulp covers',
  ],
  '## Overall look\n\nInk and flat colour.\n',
);

describe('parseStyleBibleFile', () => {
  it('accepts a fully populated style bible', () => {
    const result = parseStyleBibleFile(COMIC_STYLE, PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.style.frontmatter.art_style).toBe('Inked 1920s pulp, flat colour');
    expect(result.style.body).toContain('## Overall look');
  });

  it('accepts an empty frontmatter block and a file with none, keeping the full text as the body', () => {
    expect(parseStyleBibleFile('---\n---\n\nBody', PATH).ok).toBe(true);
    const plain = '# Look\n\nWatercolour, soft edges.\n';
    const result = parseStyleBibleFile(plain, PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.style.body).toBe(plain);
    expect(result.style.frontmatter.medium).toBeUndefined();
  });

  it('accepts a single string wherever a list is allowed', () => {
    const result = parseStyleBibleFile(file(['medium: comic', 'avoid: text in images', 'lettering: all caps']), PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resolved = resolveStyleBible(result.style.frontmatter);
    expect(resolved.medium).toEqual(['comic']);
    expect(resolved.avoid).toEqual(['text in images']);
    expect(resolved.lettering).toEqual(['all caps']);
  });

  it('reports malformed YAML rather than throwing', () => {
    const result = parseStyleBibleFile('---\nart_style: [unterminated\n---\n\nbody', PATH);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed-yaml');
  });

  it('reports invalid-schema with the path of the wrong field', () => {
    const result = parseStyleBibleFile(file(['art_style:', '  - not a string', 'palette: 7']), PATH);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-schema');
    const paths = result.issues?.map((issue) => issue.path) ?? [];
    expect(paths).toContain('art_style');
    expect(paths).toContain('palette');
  });

  it('explains an unquoted hex colour (a YAML comment) in the message', () => {
    const result = parseStyleBibleFile(file(['palette:', '  - #2a7f8e', '  - Bone white']), PATH);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.issues?.find((i) => i.path === 'palette');
    expect(issue?.message).toContain('quote hex colours');
  });

  it('rejects a format entry that is neither a string nor an object', () => {
    const result = parseStyleBibleFile(file(['format:', '  comic: [a, b]']), PATH);
    expect(result.ok).toBe(false);
  });

  it('preserves unknown frontmatter fields, and round-trips through serialize/parse', () => {
    const result = parseStyleBibleFile(file(['art_style: Ink', 'house_rule: kept', 'format:', '  video: { aspect_ratio: 1.78, fps: 24 }']), PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.style.frontmatter.house_rule).toBe('kept');
    const reparsed = parseStyleBibleFile(serializeStyleBible(result.style), PATH);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.style.frontmatter).toEqual(result.style.frontmatter);
    expect(reparsed.style.body).toBe(result.style.body);
  });
});

describe('parsePaletteEntry', () => {
  it.each([
    ['#2A7F8E', { raw: '#2A7F8E', hex: '#2a7f8e' }],
    ['Harbor teal #2a7f8e', { raw: 'Harbor teal #2a7f8e', name: 'Harbor teal', hex: '#2a7f8e' }],
    ['#d9a441 (brass)', { raw: '#d9a441 (brass)', name: 'brass', hex: '#d9a441' }],
    ['Rust: #b7410e', { raw: 'Rust: #b7410e', name: 'Rust', hex: '#b7410e' }],
    ['#fff', { raw: '#fff', hex: '#fff' }],
    ['Bone white', { raw: 'Bone white', name: 'Bone white' }],
    ['#12345', { raw: '#12345', name: '#12345' }],
  ])('splits %j', (input, expected) => {
    expect(parsePaletteEntry(input)).toEqual(expected);
  });
});

describe('resolveStyleBible', () => {
  it('normalizes lists, media and per-medium format hints', () => {
    const parsed = parseStyleBibleFile(
      file([
        'medium: [Comic, " video ", comic, ""]',
        'palette: ["#fff", "  "]',
        'format:',
        '  Comic: { trim_size: 6.625x10.25 in, bleed: 0.125 in }',
        '  video: { aspect_ratio: 1.78 }',
        '  illustrated-book: Square, 8 x 8 in',
        'era_reference: "  "',
      ]),
      PATH,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const resolved = resolveStyleBible(parsed.style.frontmatter);
    expect(resolved.medium).toEqual(['comic', 'video']);
    expect(resolved.palette).toEqual([{ raw: '#fff', hex: '#fff' }]);
    expect(resolved.format.comic).toEqual({ trimSize: '6.625x10.25 in', other: { bleed: '0.125 in' } });
    expect(resolved.format.video).toEqual({ aspectRatio: '1.78', other: {} });
    expect(resolved.format['illustrated-book']).toEqual({ note: 'Square, 8 x 8 in', other: {} });
    expect(resolved.eraReference).toBeUndefined();
    expect(resolved.artStyle).toBeUndefined();
  });

  it('resolves an empty style to empty lists', () => {
    const resolved = resolveStyleBible({});
    expect(resolved).toEqual({ medium: [], palette: [], referenceImages: [], avoid: [], format: {}, lettering: [] });
  });
});

describe('styleAppliesTo', () => {
  it('covers every medium when none is named, and only the named ones otherwise', () => {
    expect(styleAppliesTo(resolveStyleBible({}), 'comic')).toBe(true);
    const comicOnly = resolveStyleBible({ medium: 'comic' });
    expect(styleAppliesTo(comicOnly, ' Comic ')).toBe(true);
    expect(styleAppliesTo(comicOnly, 'video')).toBe(false);
  });
});

describe('resolveReferenceImage', () => {
  const root = join(tmpdir(), 'lf-project');
  it('resolves a project-relative path', () => {
    expect(resolveReferenceImage('assets/style/a.png', root)).toEqual({
      path: 'assets/style/a.png',
      kind: 'file',
      absolutePath: join(root, 'assets', 'style', 'a.png'),
    });
  });
  it('flags a path that leaves the project, and the project root itself', () => {
    expect(resolveReferenceImage('../elsewhere/a.png', root).kind).toBe('outside-project');
    expect(resolveReferenceImage(join(tmpdir(), 'other', 'a.png'), root).kind).toBe('outside-project');
    expect(resolveReferenceImage('.', root).kind).toBe('outside-project');
  });
  it('treats a URL as remote and does not resolve it', () => {
    expect(resolveReferenceImage('https://example.com/a.png', root)).toEqual({ path: 'https://example.com/a.png', kind: 'remote' });
  });
});

describe('isProjectDocument and isNonEntityDoc', () => {
  it('treats any *.lf.md as a project document, in any case and any folder', () => {
    expect(isProjectDocument('/p/world/style.lf.md')).toBe(true);
    expect(isProjectDocument('/p/lore/STYLE.LF.MD')).toBe(true);
    expect(isProjectDocument('/p/world/notes/future-thing.lf.md')).toBe(true);
    expect(isProjectDocument('style.lf.md')).toBe(true);
  });

  it('does not treat other files, or a bare ".lf.md", as project documents', () => {
    expect(isProjectDocument('/p/world/style.md')).toBe(false);
    expect(isProjectDocument('/p/world/style.lf.mdx')).toBe(false);
    expect(isProjectDocument('/p/world/lf.md')).toBe(false);
    expect(isProjectDocument('/p/world/.lf.md')).toBe(false);
    expect(isProjectDocument('/p/world/mara.md')).toBe(false);
  });

  it('keeps README.md and OVERVIEW.md excluded, adds project documents, and frees a real entity called Style', () => {
    expect(isNonEntityDoc('/p/world/README.md')).toBe(true);
    expect(isNonEntityDoc('/p/world/overview.MD')).toBe(true);
    expect(isNonEntityDoc('/p/world/style.lf.md')).toBe(true);
    expect(isNonEntityDoc('/p/world/style.md')).toBe(false);
    expect(isNonEntityDoc('/p/world/stylist.md')).toBe(false);
  });
});

describe('readStyleBible and loadProject', () => {
  let root: string;

  /** Write `text` to `relativePath` under the project root, creating folders. */
  function put(relativePath: string, text: string): void {
    const filePath = join(root, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, text, 'utf8');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lorefountain-style-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is absent when there is no file or no world folder', async () => {
    expect(await readStyleBible(join(root, 'world'), root)).toEqual({ status: 'absent' });
    mkdirSync(join(root, 'world'));
    expect(await readStyleBible(join(root, 'world'), root)).toEqual({ status: 'absent' });
  });

  it('loads the file in any letter case and reports missing reference images', async () => {
    put('world/Style.LF.md', COMIC_STYLE.replace('assets/style/cover-mood.png', 'assets/style/cover-mood.png\n  - assets/style/gone.png\n  - ../outside.png\n  - https://example.com/x.png'));
    put('assets/style/cover-mood.png', 'png');

    const result = await readStyleBible(join(root, 'world'), root);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.style.resolved.medium).toEqual(['comic', 'video']);
    expect(result.style.referenceImages.map((ref) => [ref.path, ref.kind, ref.exists])).toEqual([
      ['assets/style/cover-mood.png', 'file', true],
      ['assets/style/gone.png', 'file', false],
      ['../outside.png', 'outside-project', undefined],
      ['https://example.com/x.png', 'remote', undefined],
    ]);
    expect(result.style.missingReferenceImages).toEqual(['assets/style/gone.png']);
  });

  it('finds the file in any letter case, only directly in the world folder', async () => {
    put('world/notes/style.lf.md', 'nested');
    expect(await findStyleBibleFile(join(root, 'world'))).toBeUndefined();
    put('world/STYLE.LF.MD', 'x');
    expect(await findStyleBibleFile(join(root, 'world'))).toBe(join(root, 'world', 'STYLE.LF.MD'));
  });

  it('does not count a directory as a reference image', async () => {
    put('world/style.lf.md', file(['reference_images: [assets/style]']));
    mkdirSync(join(root, 'assets', 'style'), { recursive: true });
    const result = await readStyleBible(join(root, 'world'), root);
    expect(result.status === 'ok' && result.style.missingReferenceImages).toEqual(['assets/style']);
  });

  it('reports a malformed file as invalid without throwing', async () => {
    put('world/style.lf.md', '---\nart_style: [oops\n---\n');
    const result = await readStyleBible(join(root, 'world'), root);
    expect(result).toMatchObject({ status: 'invalid', reason: 'malformed-yaml' });
  });

  it('loadProject exposes the style, keeps it out of the entities, and files a bad one as an issue', async () => {
    put('world/mara.md', '---\nname: Mara\ntype: character\n---\nA salvager.\n');
    put('world/style.lf.md', COMIC_STYLE);

    const project = await loadProject(root);
    expect(project.entities.map((loaded) => loaded.entity.id)).toEqual(['mara']);
    expect(project.style?.resolved.artStyle).toBe('Inked 1920s pulp, flat colour');
    expect(project.style?.missingReferenceImages).toEqual(['assets/style/cover-mood.png']);
    expect(project.issues).toEqual([]);

    put('world/style.lf.md', '---\npalette: 7\n---\n');
    const broken = await loadProject(root);
    expect(broken.style).toBeUndefined();
    expect(broken.issues.map((issue) => [issue.kind, issue.reason])).toEqual([['style', 'invalid-schema']]);
  });

  it('loadProject indexes a real entity named Style and skips any *.lf.md, even in glossary and notes', async () => {
    put('world/style.md', '---\nname: Style\ntype: concept\n---\nAn idea about being stylish.\n');
    put('world/style.lf.md', COMIC_STYLE);
    put('world/glossary/terms.lf.md', 'not a glossary term');
    put('world/timeline/era.lf.md', 'not an event');

    const project = await loadProject(root);
    expect(project.entities.map((loaded) => loaded.entity.id)).toEqual(['style']);
    expect(project.issues).toEqual([]);
    expect(project.style?.filePath).toBe(join(root, 'world', 'style.lf.md'));
  });

  it('loadProject leaves style undefined when there is no style.lf.md', async () => {
    const project = await loadProject(root);
    expect(project.style).toBeUndefined();
  });
});
