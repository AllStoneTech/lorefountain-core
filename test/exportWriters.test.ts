/**
 * Unit tests for the dependency-free export writers (Core ADR-0006):
 * `export/fountain.ts`, `export/html.ts` and `export/fdx.ts`.
 */

import { describe, expect, it } from 'vitest';
import { writeFdx } from '../src/export/fdx';
import { filterScript } from '../src/export/filter';
import { writeFountain } from '../src/export/fountain';
import { escapeHtml, writeHtml } from '../src/export/html';
import { presetContent } from '../src/export/options';
import { buildScreenplay } from '../src/export/screenplay';
import { parseFountain } from '../src/fountain/parse';

const SCRIPT = [
  'Title: The *Long* Night',
  'Author: Ada <Lovelace>',
  'Production Code: 1x03',
  '',
  'INT. ARCHIVE - NIGHT #1#',
  '',
  'SHOT: [1x03-wide] WIDE, establishing',
  'SFX: a ladder creaks',
  'Sango climbs down & waits.',
  '',
  'SANGO',
  '(quietly)',
  'I kept **every** ledger.',
  '',
  'BRICK',
  'Now.',
  '',
  'STEEL ^',
  'Now.',
  '',
  '[[check this]]',
  '',
  '===',
  '',
  '> THE END <',
  '',
  'CUT TO:',
  '',
].join('\n');

const screenplayFor = (preset: 'pure' | 'production' | 'audio'): ReturnType<typeof buildScreenplay> =>
  buildScreenplay(filterScript(SCRIPT, presetContent(preset)).text);

/** Every opening tag has a matching close, in order (a light well-formedness check for the XML). */
function tagsBalance(xml: string): boolean {
  const stack: string[] = [];
  for (const match of xml.matchAll(/<(\/?)([A-Za-z][\w]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

describe('writeFountain', () => {
  it('writes standard Fountain that parses, ending with a line break', () => {
    const { text } = writeFountain(SCRIPT.trimEnd(), presetContent('pure'));
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('SHOT:');
    expect(text).not.toContain('Production Code');
    expect(() => parseFountain(text)).not.toThrow();
  });

  it('writes an empty script as empty', () => {
    expect(writeFountain('', presetContent('pure')).text).toBe('');
  });
});

describe('writeHtml', () => {
  const html = writeHtml(screenplayFor('production'), { fallbackTitle: '1x03' });

  it('is a complete, self-contained page with the title as its only h1', () => {
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html).toContain('<title>The Long Night</title>');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="title-page__title">The <em>Long</em> Night</h1>');
    expect(html).not.toMatch(/<script|style="/);
  });

  it('escapes script text', () => {
    expect(html).toContain('Ada &lt;Lovelace&gt;');
    expect(html).toContain('Sango climbs down &amp; waits.');
    expect(escapeHtml('<a href="x">\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;');
  });

  it('marks up headings, speeches, dual dialogue, transitions and notes', () => {
    expect(html).toContain('<h2 class="scene-heading"><span class="visually-hidden">Scene 1: </span>INT. ARCHIVE - NIGHT<span class="scene-heading__number" aria-hidden="true">1</span></h2>');
    expect(html).toContain('<p class="dialogue__parenthetical">(quietly)</p>');
    expect(html).toContain('I kept <strong>every</strong> ledger.');
    expect(html).toContain('<div class="dual-dialogue">');
    expect(html).toContain('<p class="transition">CUT TO:</p>');
    expect(html).toContain('<aside class="note" aria-label="Note">check this</aside>');
    expect(html).toContain('<hr class="page-break">');
  });

  it('keeps convention lines in a Production draft and drops them for Pure Fountain', () => {
    expect(html).toContain('SHOT: [1x03-wide] WIDE, establishing');
    expect(writeHtml(screenplayFor('pure'), { fallbackTitle: 'x' })).not.toContain('SHOT:');
  });

  it('falls back to the given title, and can hide scene numbers', () => {
    const page = writeHtml(buildScreenplay('INT. A - DAY #4#\n\nText.\n'), { fallbackTitle: 'my-script', sceneNumbers: false });
    expect(page).toContain('<title>my-script</title>');
    expect(page).not.toContain('<span class="scene-heading__number"');
  });
});

describe('writeFdx', () => {
  const fdx = writeFdx(screenplayFor('production'));

  it('is a Final Draft 5 document with balanced tags', () => {
    expect(fdx.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="5">')).toBe(true);
    expect(tagsBalance(fdx)).toBe(true);
  });

  it('uses Final Draft paragraph types, with the scene number and styles', () => {
    expect(fdx).toContain('<Paragraph Number="1" Type="Scene Heading">\n      <Text>INT. ARCHIVE - NIGHT</Text>');
    expect(fdx).toContain('<Paragraph Type="Character">\n      <Text>SANGO</Text>');
    expect(fdx).toContain('<Paragraph Type="Parenthetical">\n      <Text>(quietly)</Text>');
    expect(fdx).toContain('<Text>I kept </Text><Text Style="Bold">every</Text><Text> ledger.</Text>');
    expect(fdx).toContain('<Paragraph Type="Transition">\n      <Text>CUT TO:</Text>');
  });

  it('turns SHOT: into a Shot paragraph and keeps other convention lines as Action', () => {
    expect(fdx).toContain('<Paragraph Type="Shot">\n      <Text>[1x03-wide] WIDE, establishing</Text>');
    expect(fdx).toContain('<Paragraph Type="Action">\n      <Text>SFX: a ladder creaks</Text>');
    expect(writeFdx(buildScreenplay('!SHOT: CLOSE-UP\n'))).toContain('<Paragraph Type="Shot">\n      <Text>CLOSE-UP</Text>');
  });

  it('groups dual dialogue, starts a new page after a page break, centers centered text', () => {
    expect(fdx).toMatch(/<Paragraph>\n {6}<DualDialogue>[\s\S]*BRICK[\s\S]*STEEL[\s\S]*<\/DualDialogue>/);
    expect(fdx).toContain('<Paragraph Alignment="Center" StartsNewPage="Yes" Type="Action">\n      <Text>THE END</Text>');
  });

  it('leaves notes out and escapes text', () => {
    expect(fdx).not.toContain('check this');
    expect(fdx).toContain('Sango climbs down &amp; waits.');
    expect(fdx).toContain('<TitlePage>');
    expect(fdx).toContain('Ada &lt;Lovelace&gt;');
  });

  it('writes lyrics as italic dialogue and drops characters XML forbids', () => {
    const lyric = writeFdx(buildScreenplay('WONKA\n~Come with me\u0007\n'));
    expect(lyric).toContain('<Paragraph Type="Dialogue">\n      <Text Style="Italic">Come with me</Text>');
  });
});
