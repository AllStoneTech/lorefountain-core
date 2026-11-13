/**
 * The `.fdx` export writer (Core ADR-0003, section 6): Final Draft's XML
 * format, version 5, which Final Draft 8 and later open, as do Fade In,
 * WriterDuet, Highland and most screenwriting tools.
 *
 * Exports {@link writeFdx}.
 *
 * Mapping:
 * - Scene headings, action, character, parenthetical, dialogue and
 *   transitions use Final Draft's own paragraph types; scene numbers go in
 *   the heading's `Number` attribute.
 * - A `SHOT:` line becomes a Shot paragraph holding the framing text, a
 *   Final Draft element Fountain has no syntax for. Other convention lines
 *   stay Action.
 * - Each line of an action block is its own Action paragraph, since a Final
 *   Draft paragraph has no line breaks.
 * - Lyrics are italic Dialogue (in a speech) or italic Action. Centered text
 *   is centered Action. A page break sets `StartsNewPage` on the next paragraph.
 * - Dual dialogue is a `DualDialogue` group.
 * - Notes, sections and synopses are left out. They are never printed, and
 *   Final Draft's ScriptNote structure ties a note to a text range that
 *   Fountain doesn't record.
 */

import { matchPrefixLine } from '../fountain/conventions';
import { escapeHtml } from './html';
import type { DialogueBlock, RunLine, Screenplay, TextRun } from './screenplay';

/** One paragraph's attributes and runs, before serialization. */
interface Paragraph {
  type: string;
  runs: RunLine;
  number?: string;
  alignment?: 'Center' | 'Right';
  /** Extra style applied to every run (`Italic` for lyrics). */
  italic?: true;
}

/**
 * Write a screenplay as a Final Draft `.fdx` document.
 *
 * @param screenplay - The script model, built from filtered text.
 * @returns The XML document.
 */
export function writeFdx(screenplay: Screenplay): string {
  const content: string[] = [];
  let newPage = false;
  const emit = (paragraph: Paragraph): void => {
    content.push(paragraphXml(paragraph, newPage));
    newPage = false;
  };

  for (const element of screenplay.elements) {
    switch (element.kind) {
      case 'scene-heading':
        emit({ type: 'Scene Heading', runs: element.runs, ...(element.number ? { number: element.number } : {}) });
        break;
      case 'action':
        for (const line of element.lines) {
          if (line.convention === 'SHOT') {
            emit({ type: 'Shot', runs: shotRuns(line.runs) });
          } else if (line.runs.some((run) => !run.note && run.text.trim() !== '')) {
            emit({ type: 'Action', runs: line.runs });
          }
        }
        break;
      case 'dialogue':
        for (const paragraph of dialogueParagraphs(element.block)) emit(paragraph);
        break;
      case 'dual-dialogue': {
        const inner = [...dialogueParagraphs(element.left), ...dialogueParagraphs(element.right)].map((paragraph) => paragraphXml(paragraph, false));
        content.push(`    <Paragraph${newPage ? ' StartsNewPage="Yes"' : ''}>\n      <DualDialogue>\n${inner.map((xml) => `  ${xml}`).join('\n')}\n      </DualDialogue>\n    </Paragraph>`);
        newPage = false;
        break;
      }
      case 'lyric':
        for (const line of element.lines) emit({ type: 'Action', runs: line, italic: true });
        break;
      case 'transition':
        emit({ type: 'Transition', runs: element.runs });
        break;
      case 'centered':
        for (const line of element.lines) emit({ type: 'Action', runs: line, alignment: 'Center' });
        break;
      case 'page-break':
        newPage = true;
        break;
      case 'section':
      case 'synopsis':
      case 'note':
        break;
    }
  }

  const titlePage = screenplay.titlePage.flatMap((entry) =>
    entry.lines.map((line) => paragraphXml({ type: 'General', runs: line, alignment: 'Center' }, false)),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="5">',
    '  <Content>',
    ...content,
    '  </Content>',
    ...(titlePage.length > 0 ? ['  <TitlePage>', '    <Content>', ...titlePage.map((xml) => `    ${xml}`), '    </Content>', '  </TitlePage>'] : []),
    '</FinalDraft>',
    '',
  ].join('\n');
}

/** A speech's paragraphs: character, then its parentheticals, dialogue and lyrics in order. */
function dialogueParagraphs(block: DialogueBlock): Paragraph[] {
  const paragraphs: Paragraph[] = [{ type: 'Character', runs: block.cue }];
  for (const part of block.parts) {
    if (part.kind === 'parenthetical') {
      paragraphs.push({ type: 'Parenthetical', runs: part.runs });
    } else {
      // Dialogue lines join with a space: a Final Draft paragraph wraps on its own.
      const runs = part.lines.flatMap((line, index) => (index === 0 ? line : [{ text: ' ' }, ...line]));
      paragraphs.push({ type: 'Dialogue', runs, ...(part.kind === 'lyric' ? { italic: true as const } : {}) });
    }
  }
  return paragraphs;
}

/** A `SHOT:` line's runs without the keyword (and `!`), for a Shot paragraph. */
function shotRuns(runs: RunLine): RunLine {
  const [first, ...rest] = runs;
  if (!first) return runs;
  const match = matchPrefixLine(first.text);
  if (!match) return runs;
  return match.rest ? [{ ...first, text: match.rest }, ...rest] : rest;
}

/** Serialize one paragraph. Note runs are left out. */
function paragraphXml(paragraph: Paragraph, startsNewPage: boolean): string {
  const attributes = [
    paragraph.alignment ? ` Alignment="${paragraph.alignment}"` : '',
    paragraph.number ? ` Number="${escapeHtml(paragraph.number)}"` : '',
    startsNewPage ? ' StartsNewPage="Yes"' : '',
    ` Type="${paragraph.type}"`,
  ].join('');
  const texts = paragraph.runs
    .filter((run) => !run.note)
    .map((run) => textXml(paragraph.italic ? { ...run, italic: true } : run));
  return `    <Paragraph${attributes}>\n      ${texts.length > 0 ? texts.join('') : '<Text></Text>'}\n    </Paragraph>`;
}

/** One run as a `Text` element with Final Draft's `Style` attribute. */
function textXml(run: TextRun): string {
  const styles = [run.bold ? 'Bold' : '', run.italic ? 'Italic' : '', run.underline ? 'Underline' : ''].filter(Boolean);
  const style = styles.length > 0 ? ` Style="${styles.join('+')}"` : '';
  return `<Text${style}>${escapeXmlText(run.text)}</Text>`;
}

/** Escape text for XML content, dropping characters XML 1.0 forbids. */
function escapeXmlText(text: string): string {
  return Array.from(escapeHtml(text))
    .filter((char) => isXmlChar(char.codePointAt(0) ?? 0))
    .join('');
}

/**
 * True for a code point XML 1.0 allows in content: tab, line feed, carriage
 * return, and everything from U+0020 except U+FFFE and U+FFFF.
 */
function isXmlChar(code: number): boolean {
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code !== 0xfffe && code !== 0xffff);
}
