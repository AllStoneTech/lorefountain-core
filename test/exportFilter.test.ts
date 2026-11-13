/**
 * Unit tests for `export/options.ts` and `export/filter.ts` (Core ADR-0006):
 * presets, validation, and the filter that turns a script into the standard
 * Fountain an export is built from.
 */

import { describe, expect, it } from 'vitest';
import { filterScript } from '../src/export/filter';
import { EXPORT_PRESETS, parseExportContent, presetContent, type ExportContent } from '../src/export/options';
import { DEFAULT_EXPORT_SETTINGS, exportSettingsFromConfig } from '../src/export/settings';
import { findMisreadConventionLines } from '../src/fountain/misread';
import { parseFountain } from '../src/fountain/parse';

const lines = (...parts: string[]): string => parts.join('\n');
const filter = (text: string, overrides: Partial<ExportContent> = {}, preset: 'pure' | 'production' | 'audio' = 'production'): string =>
  filterScript(text, { ...presetContent(preset), ...overrides }).text;

const SCRIPT = lines(
  'Title: The Long Night',
  'Order: 3',
  'Production Code: 1x03',
  'Author: Ada',
  '',
  'INT. ARCHIVE - NIGHT',
  '',
  'SHOT: [1x03-wide] WIDE, establishing',
  'LIGHT: Cold blue moonlight',
  '',
  'AMB: [rain-tin-roof] rain on a tin roof',
  'Sango climbs down.',
  '',
  'SANGO',
  'I kept every ledger.',
  '',
  'PAUSE: 2s',
  '',
  'MUSIC: [archive-theme] STING - the ledger is blank',
  '',
  '[[check this beat]]',
  '',
  '# Act One',
  '',
  '= The archive scene',
  '',
  'Rain against the glass.',
  '',
);

describe('export presets', () => {
  it('keeps notes, sections and synopses in Pure Fountain, and boneyard off everywhere', () => {
    expect(EXPORT_PRESETS.pure.content).toMatchObject({ notes: true, sections: true, synopses: true, shots: false, sound: false, tags: false });
    for (const preset of Object.values(EXPORT_PRESETS)) expect(preset.content.boneyard).toBe(false);
  });

  it('returns a copy the caller can change', () => {
    const content = presetContent('pure');
    content.shots = true;
    expect(EXPORT_PRESETS.pure.content.shots).toBe(false);
  });

  it('validates content from outside, rejecting missing and unknown fields', () => {
    expect(parseExportContent(presetContent('audio'))).toEqual({ ok: true, content: presetContent('audio') });
    expect(parseExportContent({ ...presetContent('audio'), extra: 1 }).ok).toBe(false);
    const missing: Partial<ExportContent> = presetContent('audio');
    delete missing.shots;
    expect(parseExportContent(missing).ok).toBe(false);
    expect(parseExportContent({ ...presetContent('audio'), sceneNumbers: 'roman' }).ok).toBe(false);
    expect(parseExportContent('nope').ok).toBe(false);
  });
});

describe('filterScript', () => {
  it('leaves everything in a Production draft, apart from the boneyard', () => {
    expect(filter(SCRIPT)).toBe(SCRIPT);
  });

  it('removes every LoreFountain line, tag and title key for Pure Fountain, keeping standard Fountain', () => {
    expect(filter(SCRIPT, {}, 'pure')).toBe(
      lines(
        'Title: The Long Night',
        'Author: Ada',
        '',
        'INT. ARCHIVE - NIGHT',
        '',
        'Sango climbs down.',
        '',
        'SANGO',
        'I kept every ledger.',
        '',
        '[[check this beat]]',
        '',
        '# Act One',
        '',
        '= The archive scene',
        '',
        'Rain against the glass.',
        '',
      ),
    );
  });

  it('keeps sound and pauses without tags for an Audio draft', () => {
    const result = filter(SCRIPT, {}, 'audio');
    expect(result).toContain('AMB: rain on a tin roof\nSango climbs down.');
    expect(result).toContain('PAUSE: 2s');
    expect(result).toContain('MUSIC: STING - the ledger is blank');
    expect(result).not.toContain('SHOT:');
    expect(result).not.toMatch(/\[[a-z0-9-]+\]/);
    expect(result).toContain('Order: 3');
  });

  it('drops only the tag when tags are off', () => {
    expect(filter('INT. A - DAY\n\nSHOT: [a-b] WIDE\n', { tags: false })).toBe('INT. A - DAY\n\nSHOT: WIDE\n');
    expect(filter('INT. A - DAY\n\n!SFX: [door] a door\n', { tags: false })).toBe('INT. A - DAY\n\n!SFX: a door\n');
  });

  it('removes a convention line inside an action block without splitting the block', () => {
    expect(filter('Rain.\nSFX: thunder\nMore rain.\n', { sound: false })).toBe('Rain.\nMore rain.\n');
  });

  it('collapses the blank lines a removed block leaves behind', () => {
    expect(filter('Rain.\n\nSFX: thunder\n\nMore rain.\n', { sound: false })).toBe('Rain.\n\nMore rain.\n');
  });

  it('keeps blank runs the writer wrote', () => {
    expect(filter('Rain.\n\n\nMore rain.\n', { sound: false })).toBe('Rain.\n\n\nMore rain.\n');
  });

  it('removes comic lines only when comic is off', () => {
    const comic = 'PAGE: 1\n\nPANEL: Wide shot.\n\nCAPTION (MARA): Later.\n';
    expect(filter(comic)).toBe(comic);
    expect(filter('PAGE: 1\nPANEL: Wide shot.\n')).toBe('!PAGE: 1\nPANEL: Wide shot.\n');
    expect(filter(comic, { comic: false })).toBe('');
  });

  it('treats a panel camera MOVE: as production direction, kept and dropped with shots', () => {
    const panel = 'PAGE: 1\n\nPANEL: Wide shot.\nMOVE: slow zoom in\n';
    expect(filter(panel)).toBe(panel);
    expect(filter(panel, { shots: false })).toBe('PAGE: 1\n\nPANEL: Wide shot.\n');
  });

  describe('boneyard', () => {
    const cut = lines('MARA', 'Hi.', '/* Bye. */', 'Again.', '', 'He /* never */ waits.', '', '/*', 'SHOT: WIDE', '*/', '', 'End.', '');

    it('removes boneyard lines whole, so a speech never gains a blank line', () => {
      const result = filter(cut);
      expect(result).toBe(lines('MARA', 'Hi.', 'Again.', '', 'He  waits.', '', 'End.', ''));
      expect(parseFountain(result).filter((token) => token.type === 'dialogue').map((token) => token.text)).toEqual(['Hi.\nAgain.']);
    });

    it('keeps it untouched when asked, convention lines inside included', () => {
      expect(filter(cut, { boneyard: true, shots: false })).toBe(cut);
    });
  });

  describe('notes', () => {
    it('removes note lines whole and inline notes in place', () => {
      expect(filter('He sits [[a note]] down.\n\n[[A note\nspanning lines]]\n\nUp.\n', { notes: false })).toBe('He sits  down.\n\nUp.\n');
    });

    it('never removes a note across a blank line', () => {
      expect(filter('[[open\n\nclose]]\n', { notes: false })).toBe('[[open\n\nclose]]\n');
    });
  });

  it('removes sections and synopses, never a page break', () => {
    expect(filter('# Act\n\n= Synopsis\n\n===\n\nText.\n', { sections: false, synopses: false })).toBe('===\n\nText.\n');
  });

  describe('scene numbers', () => {
    const scenes = 'INT. A - DAY #4#\n\nText.\n\n.FLASHBACK\n\nMore.\n\nEXT. B - NIGHT\nnot a heading\n';

    it('keeps them as written by default', () => {
      expect(filter(scenes)).toBe(scenes);
    });

    it('drops them', () => {
      expect(filter(scenes, { sceneNumbers: 'none' })).toBe(scenes.replace(' #4#', ''));
    });

    it('numbers every real scene heading, forced ones included', () => {
      expect(filter(scenes, { sceneNumbers: 'auto' })).toBe('INT. A - DAY #1#\n\nText.\n\n.FLASHBACK #2#\n\nMore.\n\nEXT. B - NIGHT\nnot a heading\n');
    });
  });

  it('forces a kept convention line that would read as a character cue, and reports it', () => {
    const result = filterScript('INT. A - DAY\n\nSHOT: CLOSE-UP\nPOSE: MARA KNEELS\n', presetContent('production'));
    expect(result.text).toBe('INT. A - DAY\n\n!SHOT: CLOSE-UP\nPOSE: MARA KNEELS\n');
    expect(result.forcedLines).toBe(1);
    expect(findMisreadConventionLines(result.text, { comic: true })).toEqual([]);
  });

  it('counts removed convention lines', () => {
    expect(filterScript(SCRIPT, presetContent('pure')).removedConventionLines).toBe(5);
  });

  it('keeps Windows line endings', () => {
    expect(filter('Rain.\r\nSFX: thunder\r\nMore.\r\n', { sound: false })).toBe('Rain.\r\nMore.\r\n');
  });

  it('removes a continued title-page value with its key', () => {
    expect(filter('Title: A\nProduction Code:\n   1x01\nAuthor: B\n\nText.\n', { loreFountainTitleKeys: false })).toBe('Title: A\nAuthor: B\n\nText.\n');
  });
});

describe('exportSettingsFromConfig', () => {
  it('returns the defaults when there is no export section', () => {
    expect(exportSettingsFromConfig({})).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  it('reads valid settings', () => {
    const custom = { ...presetContent('pure'), shots: true };
    expect(exportSettingsFromConfig({ export: { preset: 'custom', format: 'fdx', paper: 'a4', titlePage: false, custom } })).toEqual({
      preset: 'custom',
      format: 'fdx',
      paper: 'a4',
      titlePage: false,
      layout: 'auto',
      comicPageSides: false,
      language: 'en',
      custom,
    });
  });

  it('reads the layout, page sides and language (ADR-0008)', () => {
    const settings = exportSettingsFromConfig({ export: { layout: 'comic', comicPageSides: true, language: 'yo' } });
    expect(settings).toMatchObject({ layout: 'comic', comicPageSides: true, language: 'yo' });
  });

  it('rejects a language that is not a BCP 47 tag', () => {
    expect(exportSettingsFromConfig({ export: { language: 'not a tag!' } }).language).toBe('en');
    expect(exportSettingsFromConfig({ export: { language: '' } }).language).toBe('en');
    expect(exportSettingsFromConfig({ export: { layout: 'manga' } }).layout).toBe('auto');
  });

  it('falls back field by field, never failing the whole section', () => {
    const settings = exportSettingsFromConfig({ export: { preset: 'nope', format: 'docx', paper: 'legal', custom: { shots: true } } });
    expect(settings).toEqual({ ...DEFAULT_EXPORT_SETTINGS, format: 'docx' });
    expect(exportSettingsFromConfig({ export: 'garbage' })).toEqual(DEFAULT_EXPORT_SETTINGS);
  });
});
