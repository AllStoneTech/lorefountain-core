/**
 * The `.html` export writer (Core ADR-0006, section 6): one self-contained,
 * accessible page with an embedded stylesheet, print rules and no scripts.
 *
 * Exports {@link writeHtml}, {@link HtmlOptions}, {@link escapeHtml},
 * {@link runsHtml} and {@link titlePageHtml} (the last two shared with the
 * comic writer).
 *
 * Gotchas:
 * - Sections, synopses and notes are shown on screen in a muted style and
 *   hidden when printed, matching Fountain, which never prints them.
 * - Every piece of script text is escaped; nothing from the script becomes
 *   markup.
 * - Styles live in one `<style>` element; no element carries a `style` attribute.
 */

import { plainText, type DialogueBlock, type RunLine, type Screenplay, type ScreenplayElement } from './screenplay';

/** Options for {@link writeHtml}. */
export interface HtmlOptions {
  /** The page's `<title>` when the script has no `Title:`; usually the file name. */
  fallbackTitle: string;
  /** The page's language, as a BCP 47 tag. Defaults to `en`. */
  lang?: string;
  /** Show scene numbers in the margins. Defaults to true. */
  sceneNumbers?: boolean;
}

/**
 * Write a screenplay as a standalone HTML page.
 *
 * @param screenplay - The script model, built from filtered text.
 * @param options - Title, language and scene-number display.
 * @returns The full HTML document.
 */
export function writeHtml(screenplay: Screenplay, options: HtmlOptions): string {
  const titleEntry = screenplay.titlePage.find((entry) => entry.key === 'title');
  const title = titleEntry ? titleEntry.lines.map(plainText).join(' ').trim() : options.fallbackTitle;
  const showNumbers = options.sceneNumbers ?? true;

  const body: string[] = [];
  if (screenplay.titlePage.length > 0) body.push(titlePageHtml(screenplay));
  body.push('<article class="script">');
  for (const element of screenplay.elements) body.push(elementHtml(element, showNumbers));
  body.push('</article>');

  return [
    '<!doctype html>',
    `<html lang="${escapeAttribute(options.lang ?? 'en')}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="LoreFountain">',
    `<title>${escapeHtml(title || options.fallbackTitle)}</title>`,
    `<style>${STYLESHEET}</style>`,
    '</head>',
    '<body>',
    '<main class="screenplay">',
    ...body,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * The title page: the title as the page's one `h1`, then the other entries.
 *
 * @param screenplay - The script; only its title page is read.
 * @returns The title page's HTML.
 */
export function titlePageHtml(screenplay: Pick<Screenplay, 'titlePage'>): string {
  const parts = ['<header class="title-page">'];
  for (const entry of screenplay.titlePage) {
    const lines = entry.lines.map(runsHtml).join('<br>');
    if (entry.key === 'title') {
      parts.push(`<h1 class="title-page__title">${lines}</h1>`);
    } else {
      parts.push(`<p class="title-page__entry title-page__entry--${escapeAttribute(entry.key.replace(/_/g, '-'))}"><span class="visually-hidden">${escapeHtml(entry.label)}: </span>${lines}</p>`);
    }
  }
  parts.push('</header>');
  return parts.join('\n');
}

/** One body element. */
function elementHtml(element: ScreenplayElement, showNumbers: boolean): string {
  switch (element.kind) {
    case 'scene-heading': {
      const number = showNumbers && element.number ? `<span class="scene-heading__number" aria-hidden="true">${escapeHtml(element.number)}</span>` : '';
      const label = element.number ? `<span class="visually-hidden">Scene ${escapeHtml(element.number)}: </span>` : '';
      return `<h2 class="scene-heading">${label}${runsHtml(element.runs)}${number}</h2>`;
    }
    case 'action':
      return `<p class="action">${element.lines.map((line) => runsHtml(line.runs)).join('<br>')}</p>`;
    case 'dialogue':
      return dialogueHtml(element.block);
    case 'dual-dialogue':
      return `<div class="dual-dialogue">\n${dialogueHtml(element.left)}\n${dialogueHtml(element.right)}\n</div>`;
    case 'lyric':
      return `<p class="lyric">${element.lines.map(runsHtml).join('<br>')}</p>`;
    case 'transition':
      return `<p class="transition">${runsHtml(element.runs)}</p>`;
    case 'centered':
      return `<p class="centered">${element.lines.map(runsHtml).join('<br>')}</p>`;
    case 'page-break':
      return '<hr class="page-break">';
    case 'section':
      return `<p class="section section--depth-${Math.min(element.depth, 6)}">${escapeHtml(element.text)}</p>`;
    case 'synopsis':
      return `<p class="synopsis">${escapeHtml(element.text)}</p>`;
    case 'note':
      // The aside already marks it as a note, so its runs are shown plainly.
      return `<aside class="note" aria-label="Note">${element.lines.map((line) => runsHtml(line.map(({ note: _note, ...run }) => run))).join('<br>')}</aside>`;
  }
}

/** A character cue and its speech. */
function dialogueHtml(block: DialogueBlock): string {
  const parts = ['<div class="dialogue">', `<p class="dialogue__character">${runsHtml(block.cue)}</p>`];
  for (const part of block.parts) {
    if (part.kind === 'parenthetical') parts.push(`<p class="dialogue__parenthetical">${runsHtml(part.runs)}</p>`);
    else if (part.kind === 'dialogue') parts.push(`<p class="dialogue__line">${part.lines.map(runsHtml).join('<br>')}</p>`);
    else parts.push(`<p class="dialogue__lyric">${part.lines.map(runsHtml).join('<br>')}</p>`);
  }
  parts.push('</div>');
  return parts.join('\n');
}

/**
 * A line of runs as inline HTML: `strong`, `em`, `u`, and a muted span for notes.
 *
 * @param line - The runs.
 * @returns Escaped inline HTML.
 */
export function runsHtml(line: RunLine): string {
  return line
    .map((run) => {
      let html = escapeHtml(run.text);
      if (run.underline) html = `<u>${html}</u>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      if (run.note) html = `<span class="note note--inline">[${html}]</span>`;
      return html;
    })
    .join('');
}

/**
 * Escape text for HTML element content.
 *
 * @param text - Raw text.
 * @returns The text with `&`, `<`, `>`, `"` and `'` escaped.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escape text for an attribute value. */
function escapeAttribute(text: string): string {
  return escapeHtml(text);
}

/**
 * The page's stylesheet: screenplay layout on a 6-inch measure in Courier,
 * readable on screen (muted colours meet WCAG AA contrast) and paginated on
 * paper at the industry margins.
 */
const STYLESHEET = `
:root { color-scheme: light; --ink: #111; --muted: #555; --paper: #fff; --rule: #ccc; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); }
.screenplay { font-family: "Courier Prime", "Courier New", Courier, monospace; font-size: 12pt; line-height: 1.2; max-width: 6.5in; margin: 0 auto; padding: 1in 16px; }
.screenplay p, .screenplay h1, .screenplay h2 { margin: 0 0 1.2em; font-size: 1em; font-weight: normal; }
.title-page { text-align: center; padding: 2in 0; break-after: page; }
.title-page__title { text-transform: uppercase; margin-bottom: 2.4em; }
.scene-heading { text-transform: uppercase; position: relative; margin-top: 2.4em; }
.scene-heading__number { position: absolute; right: 0; }
.action { white-space: pre-wrap; }
.dialogue { margin: 0 0 1.2em; }
.dialogue p { margin: 0; }
.dialogue__character { margin-left: 2.2in; text-transform: uppercase; }
.dialogue__parenthetical { margin-left: 1.6in; max-width: 2in; }
.dialogue__line, .dialogue__lyric { margin-left: 1in; max-width: 3.5in; }
.dialogue__lyric, .lyric { font-style: italic; }
.dual-dialogue { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1em; }
.dual-dialogue .dialogue__character { margin-left: 1in; }
.dual-dialogue .dialogue__parenthetical { margin-left: 0.5in; }
.dual-dialogue .dialogue__line, .dual-dialogue .dialogue__lyric { margin-left: 0; }
.transition { text-align: right; text-transform: uppercase; }
.centered { text-align: center; }
.page-break { border: 0; border-top: 1px dashed var(--rule); margin: 2.4em 0; }
.section, .synopsis, .note { color: var(--muted); font-family: system-ui, sans-serif; font-size: 0.9em; }
.section { font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; }
.synopsis { font-style: italic; }
.note { border-left: 3px solid var(--rule); padding-left: 0.5em; margin: 0 0 1.2em; }
.note--inline { border: 0; padding: 0; margin: 0; font-size: 1em; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 600px) {
  .dialogue__character { margin-left: 35%; }
  .dialogue__parenthetical { margin-left: 25%; }
  .dialogue__line, .dialogue__lyric { margin-left: 15%; }
}
@page { size: letter; margin: 1in 1in 1in 1.5in; }
@media print {
  .screenplay { max-width: none; padding: 0; }
  .section, .synopsis, .note { display: none; }
  .page-break { border: 0; margin: 0; break-after: page; }
  .scene-heading, .dialogue__character { break-after: avoid; }
  .dialogue { break-inside: avoid; }
}
`;
