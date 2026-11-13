/**
 * Panel tags for "panels as shots" (ADR-0003): an explicit `PANEL: [tag]`
 * wins; otherwise a deterministic default is derived from the script, the page
 * and the panel, e.g. `1x03-p7-2` for panel 2 of page 7.
 *
 * Exports {@link defaultPanelTag}, {@link resolvePanelTags} and
 * {@link PANEL_TAG_PREFIX_BODY}. Pure; no entity or I/O knowledge.
 *
 * Gotchas:
 * - A default tag is positional (inserting a panel renumbers the ones after
 *   it), unlike a written tag. Write `[tag]` on a panel that has an asset.
 * - A non-numeric page label has no number to use, so the page's 1-based
 *   encounter index stands in (`pg3`); a range label (`2-3`) uses its first number.
 * - Panel 0 (lettering outside any panel) is not a panel and gets no tag.
 */

import { ASSET_TAG_BODY } from '../fountain/conventions';

/** A tag prefix is itself a slug (`1x03`, `harbor-episode`). */
export const PANEL_TAG_PREFIX_BODY = ASSET_TAG_BODY;

const PREFIX_PATTERN = new RegExp(`^${PANEL_TAG_PREFIX_BODY}$`);

/** The page and panel fields a tag is derived from. */
export interface PanelTagSource {
  /** Page encounter index (1-based; 0 for the implicit page). */
  pageIndex: number;
  /** The page's number, when its label is numeric. */
  pageNumber?: number;
  /** 1-based panel number within its page. */
  panel: number;
  /** An explicit tag written on the panel. */
  tag?: string;
  /** 0-based line of the `PANEL:` line. */
  line: number;
}

/**
 * Derive a panel's default tag.
 *
 * @param prefix - The script's slug prefix (its production code); empty or invalid means no prefix.
 * @param pageIndex - The page's encounter index, used when the page label is not numeric.
 * @param pageNumber - The page's number, when numeric.
 * @param panel - The panel's number within the page.
 * @returns A slug-shaped tag such as `1x03-p7-2`.
 */
export function defaultPanelTag(prefix: string | undefined, pageIndex: number, pageNumber: number | undefined, panel: number): string {
  const page = pageNumber !== undefined ? `p${pageNumber}` : `pg${pageIndex}`;
  const head = prefix !== undefined && PREFIX_PATTERN.test(prefix) ? `${prefix}-` : '';
  return `${head}${page}-${panel}`;
}

/** One panel's final tag. */
export interface ResolvedPanelTag {
  tag: string;
  /** True when the script wrote the tag; false when it is the derived default. */
  explicit: boolean;
}

/** A tag used by more than one panel. */
export interface DuplicatePanelTag {
  tag: string;
  /** 0-based line of the later panel that repeats it. */
  line: number;
  /** 0-based line of the first panel that used it. */
  firstLine: number;
}

/**
 * Give every numbered panel its final tag and find repeats.
 *
 * @param panels - The panels in script order (panel 0 is skipped).
 * @param prefix - The script's slug prefix for default tags.
 * @returns The tag per input index (undefined for skipped panels) and each repeat.
 */
export function resolvePanelTags(
  panels: readonly PanelTagSource[],
  prefix?: string,
): { tags: (ResolvedPanelTag | undefined)[]; duplicates: DuplicatePanelTag[] } {
  const firstLine = new Map<string, number>();
  const duplicates: DuplicatePanelTag[] = [];
  const tags = panels.map((source): ResolvedPanelTag | undefined => {
    if (source.panel < 1) return undefined;
    const explicit = source.tag !== undefined;
    const tag = source.tag ?? defaultPanelTag(prefix, source.pageIndex, source.pageNumber, source.panel);
    const seen = firstLine.get(tag);
    if (seen === undefined) firstLine.set(tag, source.line);
    else duplicates.push({ tag, line: source.line, firstLine: seen });
    return { tag, explicit };
  });
  return { tags, duplicates };
}
