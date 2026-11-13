/**
 * The `.fountain` export writer (Core ADR-0006): the export filter's output,
 * which is already standard Fountain, so any Fountain app opens it.
 *
 * Exports {@link writeFountain}.
 */

import { filterScript, type FilterResult } from './filter';
import type { ExportContent } from './options';

/**
 * Write a script as standard Fountain with the chosen content.
 *
 * @param scriptText - The `.fountain` file's full text.
 * @param content - What the export includes.
 * @returns The exported text (ending with a line break) and counts of what changed.
 */
export function writeFountain(scriptText: string, content: ExportContent): FilterResult {
  const result = filterScript(scriptText, content);
  const eol = /\r\n|\r|\n/.exec(result.text)?.[0] ?? '\n';
  const text = result.text.endsWith('\n') || result.text === '' ? result.text : `${result.text}${eol}`;
  return { ...result, text };
}
