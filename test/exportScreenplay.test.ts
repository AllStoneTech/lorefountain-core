/**
 * Unit tests for `export/screenplay.ts` (Core ADR-0006, section 4): the
 * document model and inline formatting.
 */

import { describe, expect, it } from 'vitest';
import { buildScreenplay, parseInline, plainText } from '../src/export/screenplay';

describe('parseInline', () => {
  it('reads every emphasis style and plain text between them', () => {
    expect(parseInline('a *i* **b** ***bi*** _u_ z')).toEqual([
      { text: 'a ' },
      { text: 'i', italic: true },
      { text: ' ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'bi', bold: true, italic: true },
      { text: ' ' },
      { text: 'u', underline: true },
      { text: ' z' },
    ]);
  });

  it('nests emphasis', () => {
    expect(parseInline('_under *both*_')).toEqual([
      { text: 'under ', underline: true },
      { text: 'both', underline: true, italic: true },
    ]);
  });

  it('marks notes, and plainText leaves them out', () => {
    const runs = parseInline('He sits [[check]] down.');
    expect(runs).toEqual([{ text: 'He sits ' }, { text: 'check', note: true }, { text: ' down.' }]);
    expect(plainText(runs)).toBe('He sits  down.');
  });

  it('leaves unmatched markers as text', () => {
    expect(parseInline('5 * 3 and a lone _')).toEqual([{ text: '5 * 3 and a lone _' }]);
  });
});

describe('buildScreenplay', () => {
  it('keeps backslash-escaped emphasis characters literal (fountain-js would italicize them)', () => {
    const { elements } = buildScreenplay('He walks \\*not\\* away, \\_really\\_, a \\\\ b.\n');
    expect(elements).toEqual([{ kind: 'action', lines: [{ runs: [{ text: 'He walks *not* away, _really_, a \\ b.' }] }] }]);
  });

  it('builds the title page with readable labels and multi-line values', () => {
    const { titlePage } = buildScreenplay('Title: **The** Night\nDraft date: 1/1\nContact:\n   1 Main\n   City\n\nText.\n');
    expect(titlePage).toEqual([
      { key: 'title', label: 'Title', lines: [[{ text: 'The', bold: true }, { text: ' Night' }]] },
      { key: 'draft_date', label: 'Draft date', lines: [[{ text: '1/1' }]] },
      { key: 'contact', label: 'Contact', lines: [[{ text: '1 Main' }], [{ text: 'City' }]] },
    ]);
  });

  it('builds headings with numbers, speeches, transitions and centered text', () => {
    const { elements } = buildScreenplay(
      'INT. A - DAY #2#\n\nMARA (V.O.) (CONT\'D)\n(quietly)\nHello\nthere.\n~La la\n\nCUT TO:\n\n> THE END <\n',
    );
    expect(elements).toEqual([
      { kind: 'scene-heading', runs: [{ text: 'INT. A - DAY' }], number: '2' },
      {
        kind: 'dialogue',
        block: {
          cue: [{ text: "MARA (V.O.) (CONT'D)" }],
          name: 'MARA',
          extensions: ['V.O.'],
          parts: [
            { kind: 'parenthetical', runs: [{ text: '(quietly)' }] },
            { kind: 'dialogue', lines: [[{ text: 'Hello' }], [{ text: 'there.' }]] },
            { kind: 'lyric', lines: [[{ text: 'La la' }]] },
          ],
        },
      },
      { kind: 'transition', runs: [{ text: 'CUT TO:' }] },
      { kind: 'centered', lines: [[{ text: 'THE END' }]] },
    ]);
  });

  it('pairs dual dialogue', () => {
    const { elements } = buildScreenplay('BRICK\nScrew it.\n\nSTEEL ^\nScrew it.\n\nThey stop.\n');
    expect(elements.map((element) => element.kind)).toEqual(['dual-dialogue', 'action']);
    const dual = elements[0];
    expect(dual.kind === 'dual-dialogue' && [dual.left.name, dual.right.name]).toEqual(['BRICK', 'STEEL']);
  });

  it('keeps a forced character name without its @', () => {
    const { elements } = buildScreenplay('@McCLANE\nYippee.\n');
    expect(elements[0]).toMatchObject({ kind: 'dialogue', block: { name: 'McCLANE', cue: [{ text: 'McCLANE' }] } });
  });

  it('tags convention lines in action', () => {
    const { elements } = buildScreenplay('!SHOT: CLOSE-UP\nPOSE: Mara kneels\nShe waits.\n');
    expect(elements).toEqual([
      {
        kind: 'action',
        lines: [
          { runs: [{ text: 'SHOT: CLOSE-UP' }], convention: 'SHOT' },
          { runs: [{ text: 'POSE: Mara kneels' }], convention: 'POSE' },
          { runs: [{ text: 'She waits.' }] },
        ],
      },
    ]);
  });

  it('reads structure: page breaks, sections, synopses and notes (one-line and multi-line)', () => {
    const { elements } = buildScreenplay('# Act One\n\n= The setup\n\n[[solo]]\n\n[[two\nlines]]\n\n===\n\nText.\n');
    expect(elements).toEqual([
      { kind: 'section', depth: 1, text: 'Act One' },
      { kind: 'synopsis', text: 'The setup' },
      { kind: 'note', lines: [[{ text: 'solo', note: true }]] },
      { kind: 'note', lines: [[{ text: 'two', note: true }], [{ text: 'lines', note: true }]] },
      { kind: 'page-break' },
      { kind: 'action', lines: [{ runs: [{ text: 'Text.' }] }] },
    ]);
  });

  it('reads a lyric outside any speech, and one directly under a cue', () => {
    expect(buildScreenplay('~Willy Wonka!\n').elements).toEqual([{ kind: 'lyric', lines: [[{ text: 'Willy Wonka!' }]] }]);
    const { elements } = buildScreenplay('WONKA\n~Come with me\n');
    expect(elements[0]).toMatchObject({ kind: 'dialogue', block: { parts: [{ kind: 'lyric', lines: [[{ text: 'Come with me' }]] }] } });
  });
});
