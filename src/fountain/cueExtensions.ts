/**
 * Cue-line extensions written as a separate parenthetical.
 *
 * Fountain reads `V.O.`, `O.S.`, `O.C.` and (by industry practice) `FILTERED`
 * only on the character cue line: `THE ARCHIVE (V.O.) (FILTERED)`. A writer
 * who puts them in the parenthetical under the cue instead, such as
 * `(V.O., reading)` or `(V.O., FILTERED — not Lucien)`, gets a performance
 * note that other tools never read as an extension.
 *
 * Exports {@link CUE_EXTENSIONS} and {@link splitExtensionParenthetical}. Pure
 * text in, parse out; the shot map reports the issue and the VS Code
 * extension's fix planner (`upgrade/formatFixes.ts`) uses the same split, so
 * the check and the fix cannot disagree (ADR-0038: extend Fountain, never
 * change it).
 *
 * Gotchas:
 * - Matching is exact and uppercase, so `(filtered through glass)` is never an
 *   extension.
 * - A token must be followed by the end, a separator (`,` `;` `—` `–` or a
 *   spaced `-`), or another known token. `(V.O. reading)` has no separator:
 *   it is reported as ambiguous and never rewritten.
 */

/** The cue-line extensions recognized, in canonical spelling. */
export const CUE_EXTENSIONS: readonly string[] = ['V.O.', 'O.S.', 'O.C.', 'FILTERED'];

/** The result of splitting a parenthetical that starts with a cue-line extension. */
export type ExtensionSplit =
  | {
      kind: 'split';
      /** The extensions found, in written order, without duplicates. */
      extensions: string[];
      /** What is left of the parenthetical's text after the extensions, without parentheses. Empty when the parenthetical was only extensions. */
      remainder: string;
    }
  | {
      kind: 'ambiguous';
      /** Why no automatic split is offered. */
      reason: string;
    };

/** A known extension at the start of the text, followed by a boundary. */
const LEADING_EXTENSION = /^(V\.O\.|O\.S\.|O\.C\.|FILTERED)(?=$|[\s,;—–])/;
/** A separator between an extension and what follows. */
const SEPARATOR = /^(?:\s*[,;—–]\s*|\s+-\s+)/;

/**
 * Split a parenthetical under a cue into the cue-line extensions it starts
 * with and the wording that remains.
 *
 * @param text - The parenthetical as written, parentheses included (for example `(V.O., FILTERED — not Lucien)`).
 * @returns `undefined` when the parenthetical does not start with a known
 *   extension (nothing to report); a `split` when it can be moved safely; or
 *   `ambiguous` when it starts with an extension but the boundary is unclear.
 */
export function splitExtensionParenthetical(text: string): ExtensionSplit | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return undefined;
  const inner = trimmed.slice(1, -1).trim();
  if (!LEADING_EXTENSION.test(inner)) return undefined;
  if (/[()]/.test(inner)) return { kind: 'ambiguous', reason: 'it contains further parentheses' };

  const extensions: string[] = [];
  let rest = inner;
  for (;;) {
    const match = LEADING_EXTENSION.exec(rest);
    if (!match) break;
    if (!extensions.includes(match[1])) extensions.push(match[1]);
    rest = rest.slice(match[1].length);
    const separator = SEPARATOR.exec(rest);
    if (separator) {
      rest = rest.slice(separator[0].length);
      continue;
    }
    // Tokens separated by spaces only, such as `(V.O. FILTERED)`.
    const spaced = /^\s+/.exec(rest);
    if (spaced && LEADING_EXTENSION.test(rest.slice(spaced[0].length))) {
      rest = rest.slice(spaced[0].length);
      continue;
    }
    if (rest.trim() !== '') {
      return { kind: 'ambiguous', reason: `there is no comma or dash between "${extensions[extensions.length - 1]}" and "${rest.trim()}"` };
    }
    rest = '';
    break;
  }
  return { kind: 'split', extensions, remainder: rest.trim() };
}
