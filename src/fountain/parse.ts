/**
 * Fountain parsing (Spec §3, ADR-0002): a thin wrapper around `fountain-js`
 * plus our own position-recovery layer, since `fountain-js` tokens carry no
 * source position (line/column) — a known gap documented in ADR-0002.
 *
 * Position recovery uses a sequential, cursor-advancing text search: for each
 * content-bearing token in order, find its (verbatim) text starting from
 * wherever the previous token's match ended, rather than searching from the
 * start of the document. This is necessary — not just a performance
 * nicety — because names/lines repeat throughout a script (e.g. a character
 * cue appears once per line of dialogue); a global `indexOf` would resolve
 * every repeat to the *first* occurrence. Verified empirically against a
 * sample covering dual dialogue, a `(V.O.)` extension, a boneyard comment,
 * and a bracketed note — every content token's text was an exact substring
 * of the source, and the moving cursor correctly disambiguated repeats.
 *
 * This module is not yet consumed by hover/completion (Phase C) — those
 * operate directly on raw text via `src/index/mentions.ts`, which needs no
 * Fountain-structural awareness. It exists as the parse-integration layer
 * promised by the build plan and as groundwork for structural features needing
 * real positions (outline, folding, a future presence/cue index).
 *
 * Two `fountain-js` gaps are handled here (Core ADR-0002):
 * - Token text differs from the source where `fountain-js` strips or rewrites
 *   it (forcing marks like `!`, backslash escapes, tabs, two-space lines), so
 *   the position search falls back to a tolerant pattern for those.
 * - `fountain-js` 1.2.4 throws on a `~` lyric as the first line of a speech;
 *   {@link parseFountain} retries with those markers shielded.
 */

import { Fountain, type Token } from 'fountain-js';
import { blankBoneyard } from './boneyard';

export type { Token as FountainToken };

/**
 * Stand-in for a shielded lyric `~`: one UTF-16 unit from the Private Use
 * Area, so every offset and line stays where it was, and it never occurs in
 * real script text.
 */
const LYRIC_PLACEHOLDER = '';

/** A `~` lyric line as `fountain-js` recognizes one (`~` not followed by a space). Group 1 is the indentation. */
const LYRIC_LINE = /^([ \t]*)~(?! )/;

/** A parsed token with its recovered position in the source, when found. */
export interface PositionedToken {
  token: Token;
  /** 0-based character offset where the token's text starts. */
  start: number;
  /** 0-based character offset where the token's text ends (exclusive). */
  end: number;
  /** 0-based line number containing `start`. */
  line: number;
}

/**
 * Parse Fountain source into its token stream.
 *
 * A script `fountain-js` parses is returned exactly as it parses it. Only
 * when it throws (its 1.2.4 crash on a `~` lyric opening a speech) is the
 * text parsed again with {@link parseWithShieldedLyrics}.
 *
 * @param text - Raw `.fountain` file contents.
 * @returns The token stream, in document order.
 * @throws The original `fountain-js` error when the shielded retry fails too.
 */
export function parseFountain(text: string): Token[] {
  try {
    return new Fountain().parse(text, true).tokens;
  } catch (error) {
    try {
      return parseWithShieldedLyrics(text);
    } catch {
      throw error;
    }
  }
}

/**
 * Parse with every `~` lyric line that directly follows a non-blank,
 * non-lyric line swapped for {@link LYRIC_PLACEHOLDER}, so `fountain-js`
 * reads it as dialogue (or action) instead of crashing; then turn those lines
 * back into lyric tokens. Elsewhere the placeholder is put back as `~`, which
 * is what `fountain-js` would have kept there anyway.
 *
 * @param text - Raw `.fountain` file contents.
 * @returns The token stream, in document order.
 * @throws Whatever `fountain-js` throws if the shielded text still fails.
 */
function parseWithShieldedLyrics(text: string): Token[] {
  const lines = text.split(/(\r\n|\r|\n)/);
  // `split` with a capture group interleaves the line breaks: even indexes are lines.
  for (let index = 2; index < lines.length; index += 2) {
    const previous = lines[index - 2];
    if (previous.trim() === '' || LYRIC_LINE.test(previous)) continue;
    lines[index] = lines[index].replace(LYRIC_LINE, `$1${LYRIC_PLACEHOLDER}`);
  }
  const tokens = new Fountain().parse(lines.join(''), true).tokens;
  return unshieldLyrics(tokens);
}

/**
 * Undo {@link parseWithShieldedLyrics}'s placeholder: a dialogue token's
 * placeholder lines become lyric tokens (merged with an adjacent lyric token),
 * and any other token gets its `~` back.
 *
 * @param tokens - Tokens parsed from the shielded text.
 * @returns The tokens as they would read without the `fountain-js` crash.
 */
function unshieldLyrics(tokens: readonly Token[]): Token[] {
  const result: Token[] = [];
  const pushLyric = (lyric: string): void => {
    const last = result[result.length - 1];
    if (last?.type === 'lyrics') {
      last.text = `${last.text ?? ''}\n${lyric}`;
    } else {
      result.push(lyricsToken(lyric));
    }
  };

  for (const token of tokens) {
    const text = token.text ?? '';
    if (!text.includes(LYRIC_PLACEHOLDER)) {
      if (token.type === 'lyrics' && result[result.length - 1]?.type === 'lyrics') {
        pushLyric(text);
      } else {
        result.push(token);
      }
      continue;
    }
    if (token.type !== 'dialogue') {
      token.text = text.split(LYRIC_PLACEHOLDER).join('~');
      result.push(token);
      continue;
    }
    let spoken: string[] = [];
    const flushSpoken = (): void => {
      // Copy through the prototype so the class's `addTo` survives (a spread would drop it).
      if (spoken.length > 0) result.push(Object.assign(Object.create(Object.getPrototypeOf(token) as object) as Token, token, { text: spoken.join('\n') }));
      spoken = [];
    };
    for (const line of text.split('\n')) {
      if (line.startsWith(LYRIC_PLACEHOLDER)) {
        flushSpoken();
        pushLyric(line.slice(LYRIC_PLACEHOLDER.length));
      } else {
        spoken.push(line);
      }
    }
    flushSpoken();
  }
  return result;
}

/**
 * Build a lyric token shaped like the ones `fountain-js` makes.
 *
 * @param text - The lyric lines, without their `~`, joined with `\n`.
 * @returns A `lyrics` token.
 */
function lyricsToken(text: string): Token {
  return {
    type: 'lyrics',
    text,
    addTo(tokens: Token[]): Token[] {
      return [...tokens, this];
    },
  };
}

/**
 * Recover source positions for every content-bearing token (one with
 * non-empty `text`), by searching for each token's text in turn, advancing a
 * cursor past each match so repeated text (a re-used character cue, a
 * repeated line) resolves to its own distinct occurrence rather than always
 * the first.
 *
 * A token whose text can't be found at or after the current cursor (should
 * not happen for any token type verified above, but Fountain has edge cases
 * this hasn't been tested against) is skipped rather than mis-positioned —
 * best-effort, not guaranteed-complete.
 *
 * The search runs over the text with its boneyard blanked out
 * (`boneyard.ts`), so a token is never matched against identical text
 * hidden in an earlier boneyard, which would misplace it and every token
 * after it.
 *
 * @param text - The same source text that produced `tokens`.
 * @param tokens - The token stream from {@link parseFountain} for that text.
 * @returns Positioned tokens, in document order; a subset if any token's text couldn't be located.
 */
export function mapTokensToPositions(text: string, tokens: readonly Token[]): PositionedToken[] {
  const searchable = blankBoneyard(text);
  const positioned: PositionedToken[] = [];
  let cursor = 0;
  let line = 0;

  for (const token of tokens) {
    const tokenText = token.text ?? '';
    if (!tokenText) continue;

    const found = findTokenText(searchable, tokenText, cursor);
    if (!found) continue;
    const { start, end } = found;

    // Advance the running line count only across the gap we just skipped,
    // not by rescanning from the start of the document each time.
    line += countNewlines(text, cursor, start);
    positioned.push({ token, start, end, line });
    // A multi-line token (e.g. a stacked action block) also spans newlines of
    // its own; count them too, or every later token's line comes out short.
    line += countNewlines(text, start, end);
    cursor = end;
  }

  return positioned;
}

/** Fountain's line-start marks that `fountain-js` strips from token text: forced action, character, scene heading, transition and lyric. */
const STRIPPED_LINE_MARK = '[!@.>~]?';

/** One token line break in the source: trailing spaces, the break (any style), indentation, then an optional stripped mark. */
const SOURCE_LINE_BREAK = `[ \\t]*(?:\\r\\n|\\r|\\n)[ \\t]*${STRIPPED_LINE_MARK}`;

/**
 * Find a token's text in the source at or after `from`: verbatim when
 * possible, otherwise by a tolerant pattern that allows exactly what
 * `fountain-js` changes (Core ADR-0002): a stripped line-start mark, a
 * dropped backslash before punctuation, a tab turned into spaces, trimmed
 * line edges, a two-space dialogue line turned empty, and any line-break style.
 *
 * @param searchable - The source text, boneyard blanked.
 * @param tokenText - The token's text.
 * @param from - The offset to search from.
 * @returns The match's start and end offsets, or `undefined` when not found.
 */
function findTokenText(searchable: string, tokenText: string, from: number): { start: number; end: number } | undefined {
  const exact = searchable.indexOf(tokenText, from);
  if (exact !== -1) return { start: exact, end: exact + tokenText.length };

  const linePatterns = tokenText.split('\n').map((tokenLine) =>
    Array.from(tokenLine.trim(), (char) => {
      if (char === ' ') return '[ \\t]+';
      if (/[\p{L}\p{N}]/u.test(char)) return escapeRegExp(char);
      return `\\\\?${escapeRegExp(char)}`;
    })
      .join('')
      .replace(/(?:\[ \\t\]\+)+/g, '[ \\t]+'),
  );
  const pattern = new RegExp(`${STRIPPED_LINE_MARK}${linePatterns.join(SOURCE_LINE_BREAK)}`, 'gu');
  pattern.lastIndex = from;
  const match = pattern.exec(searchable);
  if (!match) return undefined;
  return { start: match.index, end: match.index + match[0].length };
}

/**
 * Escape a string for literal use inside a regular expression.
 *
 * @param text - The literal text.
 * @returns The text with every regular-expression metacharacter escaped.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Count newline characters in `text` within `[from, to)`. */
function countNewlines(text: string, from: number, to: number): number {
  let count = 0;
  for (let i = from; i < to; i += 1) {
    if (text.charCodeAt(i) === 10 /* \n */) count += 1;
  }
  return count;
}
