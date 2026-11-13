/**
 * The comic script `.html` export writer (Core ADR-0004): one self-contained,
 * accessible page laid out as a comic full script, with print rules that
 * start each comic page on a new sheet.
 *
 * Exports {@link writeComicHtml} and {@link ComicHtmlOptions}.
 *
 * Gotchas:
 * - Every comic page is a `section` with an `h2`, every panel an `h3`, and
 *   lettering an ordered list (`start` set) whose printed numbers match the
 *   per-page numbering.
 * - Notes are shown on screen in a muted style and hidden when printed.
 * - Styles live in one `<style>` element; no element carries a `style` attribute.
 */

import type { ComicExportPage, ComicExportPanel, ComicLettering, ComicScript } from './comic';
import { escapeHtml, runsHtml, titlePageHtml } from './html';
import { plainText, type RunLine } from './screenplay';

/** Options for {@link writeComicHtml}. */
export interface ComicHtmlOptions {
  /** The page's `<title>` when the script has no `Title:`; usually the file name. */
  fallbackTitle: string;
  /** The page's language, as a BCP 47 tag. Defaults to `en`. */
  lang?: string;
}

/**
 * Write a comic script as a standalone HTML page.
 *
 * @param script - The comic model.
 * @param options - Title and language.
 * @returns The full HTML document.
 */
export function writeComicHtml(script: ComicScript, options: ComicHtmlOptions): string {
  const titleEntry = script.titlePage.find((entry) => entry.key === 'title');
  const title = titleEntry ? titleEntry.lines.map(plainText).join(' ').trim() : '';
  const body: string[] = [];
  if (script.titlePage.length > 0) body.push(titlePageHtml(script));
  body.push('<article class="comic-script">');
  for (const page of script.pages) body.push(pageHtml(page));
  body.push('</article>');

  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(options.lang ?? 'en')}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="LoreFountain">',
    `<title>${escapeHtml(title || options.fallbackTitle)}</title>`,
    `<style>${STYLESHEET}</style>`,
    '</head>',
    '<body>',
    '<main class="comic">',
    ...body,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** One comic page. */
function pageHtml(page: ComicExportPage): string {
  const parts = ['<section class="comic-page">', `<h2 class="comic-page__heading"><span class="comic-page__label">${escapeHtml(page.heading)}</span> <span class="comic-page__details">${escapeHtml(page.details)}</span></h2>`];
  if (page.layout) parts.push(labelledHtml('Layout', page.layout));
  for (const note of page.notes) parts.push(blockHtml(note, 'comic-page__note'));
  let start = 1;
  for (const panel of page.panels) {
    parts.push(panelHtml(panel, start));
    start += panel.lettering.length;
  }
  parts.push('</section>');
  return parts.join('\n');
}

/** One panel; `start` is its first lettering number. */
function panelHtml(panel: ComicExportPanel, start: number): string {
  const heading = panel.number > 0 ? `Panel ${panel.number}` : 'Lettering before the first panel';
  const parts = ['<section class="panel">', `<h3 class="panel__heading">${escapeHtml(heading)}</h3>`];
  if (panel.layout) parts.push(labelledHtml('Layout', panel.layout));
  if (panel.description) parts.push(`<p class="panel__description">${runsHtml(panel.description)}</p>`);
  for (const direction of panel.directions) parts.push(labelledHtml(direction.label, direction.runs));
  for (const action of panel.action) parts.push(blockHtml(action, 'panel__action'));
  if (panel.lettering.length > 0) {
    parts.push(`<ol class="lettering" start="${start}">`);
    for (const entry of panel.lettering) parts.push(letteringHtml(entry));
    parts.push('</ol>');
  }
  parts.push('</section>');
  return parts.join('\n');
}

/** One lettering entry as a list item. */
function letteringHtml(entry: ComicLettering): string {
  return `<li class="lettering__entry lettering__entry--${entry.kind}"><span class="lettering__number">${entry.number}.</span><span class="lettering__label">${escapeHtml(entry.label)}:</span> <span class="lettering__text">${entry.lines.map(runsHtml).join('<br>')}</span></li>`;
}

/** `Label: text` as a paragraph. */
function labelledHtml(label: string, runs: RunLine): string {
  return `<p class="direction"><span class="direction__label">${escapeHtml(label)}:</span> ${runsHtml(runs)}</p>`;
}

/** A multi-line block as one paragraph. */
function blockHtml(lines: RunLine[], className: string): string {
  return `<p class="${className}">${lines.map(runsHtml).join('<br>')}</p>`;
}

/** The page's stylesheet: a comic full script in Courier, one comic page per printed sheet. */
const STYLESHEET = `
:root { color-scheme: light; --ink: #111; --muted: #555; --paper: #fff; --rule: #ccc; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); }
.comic { font-family: "Courier Prime", "Courier New", Courier, monospace; font-size: 12pt; line-height: 1.2; max-width: 6.5in; margin: 0 auto; padding: 1in 16px; }
.comic p, .comic h1, .comic h2, .comic h3 { margin: 0 0 1.2em; font-size: 1em; }
.title-page { text-align: center; padding: 2in 0; break-after: page; }
.title-page__title { text-transform: uppercase; margin-bottom: 2.4em; }
.comic-page { border-top: 1px solid var(--rule); padding-top: 1.2em; margin-top: 2.4em; }
.comic-page__label { text-decoration: underline; }
.comic-page__details { font-weight: normal; }
.panel__heading { text-transform: uppercase; margin-bottom: 0; }
.panel__heading + * { margin-top: 0; }
.direction__label { font-weight: normal; }
.lettering { list-style: none; padding: 0; margin: 0 0 1.2em; counter-reset: none; }
.lettering__entry { display: grid; grid-template-columns: 0.8in 1.6in 1fr; gap: 0 0.5em; margin: 0 0 1.2em; }
.lettering__number { text-align: right; }
.note { color: var(--muted); font-family: system-ui, sans-serif; }
.note--inline { font-size: 1em; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 600px) {
  .lettering__entry { grid-template-columns: 2.5em 1fr; }
  .lettering__text { grid-column: 2; }
}
@page { size: letter; margin: 1in; }
@media print {
  .comic { max-width: none; padding: 0; }
  .comic-page { border: 0; padding: 0; margin: 0; break-before: page; }
  .note { display: none; }
  .panel__heading { break-after: avoid; }
  .lettering__entry { break-inside: avoid; }
}
`;
