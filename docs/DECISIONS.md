# Architecture Decisions (LoreFountain-Core)

Decisions about Core itself. Earlier decisions (ADR-0038 shot maps, ADR-0040 Fountain extensions, ADR-0042 the move to Core) live in the LoreFountain extension repo's `docs/DECISIONS.md`. Core's numbering starts at ADR-0001. Newest first.

---

## ADR-0001 — The comic script convention: `PAGE:` / `PANEL:`

**Date:** 2026-11-11 · **Status:** Proposed (owner to confirm the marked decisions)

Comic-book scripting is supported as a use case with a Page/Panel paradigm. Ground rule, as for shots (ADR-0038): **extend Fountain, never change it.** Every construct is ordinary Fountain action text or standard dialogue, so a comic script opens in any Fountain app and stays portable.

### 1. Syntax

```
INT. THE HARBOR - DAWN

PAGE: 7 (SPLASH)

PANEL: Wide shot of the harbor. WINONA stands on the pier.
POSE: Winona, arms folded

CAPTION: Dawn, 1925.

SFX: KRAAAW

WINONA (O.P.)
(whispering)
We should go.
```

| Line | Meaning |
|---|---|
| `PAGE: <label> (<modifiers>)` | Opens a page. Label is a number (`7`), a range (`2-3`, for a spread) or free text (`INSIDE FRONT COVER`). Optional trailing `(...)`, comma-separated, case-insensitive, kept uppercased. Recommended modifiers: `SPLASH`, `SPREAD`, `TURN` (a page-turn reveal). Others are kept and ignored. |
| `PANEL: <description>` | Opens a panel on the current page. Numbered 1.. per page by position. |
| `CAPTION: text` / `CAPTION (SPEAKER): text` | A narration box, optionally in a character's voice. One physical line each. |
| `SFX: [tag] text` | A lettered sound effect (reused prefix, see below). |
| Character cue + dialogue | A balloon. Extensions are kept; `O.P.`/`O.S.` also set `offPanel`. A parenthetical belongs to the next balloon in its speech (or the last). `^` dual dialogue sets `simultaneous`. |
| `LAYOUT:` | Free text on the open panel, or on the page before its first panel. |
| `SHOT:`, `POSE:`, `LIGHT:` | Reused inside a panel as camera framing, pose and lighting direction for the artist. |
| plain action | More artist direction in a panel; a page note before the first panel. |

Decisions and reasons:

- **Prefix lines, not new Fountain syntax.** Same pattern as `SHOT:`/`SFX:`. They are case-sensitive and must start the line.
- **`PAGE TURN` is a modifier, not a line.** A bare all-caps `PAGE TURN` line would be read by Fountain as a character cue. Deriving turns from page parity is wrong for books with covers or single-page layouts, so the writer says it: `PAGE: 6 (TURN)`.
- **Portability hazard, handled.** Fountain reads an all-caps line with text directly under it (and a blank line above) as a character cue. `PAGE: 7` is always all caps, so a stacked `PAGE: 7` / `PANEL: ...` would print as a speaker elsewhere. LoreFountain still reads it correctly (the same workaround as for `SHOT:`), and reports an info note `misread-as-character`. Recommendation: a blank line after `PAGE:`, and a lowercase word in `PANEL:` text. Fountain also needs a blank line before a character cue, so speakers belong in their own block.
- **Comic keywords are opt-in at scan time.** `COMIC_KEYWORDS` is separate from `PREFIX_KEYWORDS`, and `scanScript(text, { comic: true })` reads them. Any other scan (shot map, cues) behaves exactly as before. A script "is a comic" when it has at least one `PAGE:` line outside a boneyard.
- **`SFX:` is reused, not duplicated (owner to confirm).** Comic writers already write `SFX:`; a second keyword would fight muscle memory. In a panel it is the lettered effect (the text is the lettering, e.g. `KRAAAW`), recorded in the page map. Cost: it is also an audio cue in `.cues.json`, and a `[tag]` on it is checked against `audio.json`. A project that also produces audio from the same script should leave comic SFX untagged. The alternative is a distinct `LETTER:` keyword.
- **No `[tag]` on `PAGE:`/`PANEL:` in the first cut.** Panels are keyed by position. Art-asset manifests for panels would need tags like shots have; deferred.

### 2. Pages, scenes and `SHOT:`

A **page is not a scene.** A scene spans pages, and a location can change mid-page, so pages and scenes are separate axes. Scene headings stay real (`INT.`/`EXT.`), are transparent to pages and panels (they never open or close one), and each panel records the scene number and heading in effect where it opens. To keep ADR-0016's "scenes with both X and Y" search meaningful, comic writers should put a scene heading at each location or time change; without any, the whole script is one scene. `SHOT:` coexists: it still feeds `.shots.json` unchanged, and a `SHOT:` inside a panel is also recorded as the panel's `shot`. A script with `PAGE:` lines but no `SHOT:` writes no shot sidecar, as today.

### 3. The sidecar: `<script>.pages.json`

Derived, regenerated on save, never hand-edited, written only when the script has an explicit `PAGE:`. Header like the others: `schema_version` 1, `script`, `generated_by`. Then `totals {pages, panels, balloons, captions, sfx, words}`, `pages[]`, `issues[]`.

- **Page:** `index` (1-based; 0 = implicit page for panels before any `PAGE:`), `label`, `number?`, `endNumber?`, `modifiers[]`, `layout?`, `notes[]`, `lines {start,end}` (0-based, inclusive), `panels[]`, `entities[]`, `counts {panels, balloons, captions, sfx, words}`.
- **Panel:** `number` (0 = implicit panel for lettering before a page's first `PANEL:`), `description?`, `shot?`, `layout?`, `pose?`, `light?`, `action[]`, `lettering[]`, `scene`, `sceneHeading?`, `lines`, `entities[]`, `counts {balloons, captions, sfx, words}`.
- **Lettering**, one array in reading order, discriminated by `kind`: `balloon` (`speaker`, `speakerEntity?`, `extensions`, `offPanel?`, `simultaneous?`, `directions`, `text`, `line`), `caption` (`speaker?`, `speakerEntity?`, `text`, `line`), `sfx` (`text`, `tag?`, `line`).
- **Entities** are mentions in a panel's own direction text and speaker names, never balloon or caption text (as in the shot map). `speakerEntity` resolves only on an exact single match.
- **Words** count balloons and captions only (tokens with a letter or digit; `[[notes]]` excluded). SFX is lettering but not in the word budget.

### 4. Issues

Collect and continue; nothing is reinterpreted.

- **Warning:** `panel-before-page`, `content-outside-panel` (lettering under a page but before its first panel; a `CAPTION:` outside any page), `missing-page-label`, `duplicate-page-number` (also overlapping ranges and repeated text labels), `page-out-of-order`.
- **Info (never fail a run):** `page-number-gap`, `empty-page`, `missing-panel-description`, `splash-multiple-panels`, `spread-without-range`, `misread-as-character`, and word-budget notes `many-panels` (> 9), `many-balloons` (> 5 per panel), `long-balloon` (> 25 words), `long-panel-dialogue` (> 40 words per panel). Thresholds are `DEFAULT_PAGE_LIMITS`, overridable per call (`PageMapOptions.limits`). Guidance values; owner to confirm.
- Dialogue and `SFX:` before any page are ignored silently (a script may have a prologue).

### 5. Out of scope for this first cut

Pro exports (a comic script/lettering export), any VS Code UI (Pages view, hover, completion, snippets), tags and manifests for panels, a lettering-only `SFX` keyword, page-parity or turn derivation, `.cues.json` filtering of comic SFX, a `LOOK:`-style breakdown per page.

### 6. Files in Core

`src/comics/parseComic.ts` (structure walk), `src/comics/pageMap.ts` (`buildPageMap`: entities, counts, issues), `src/comics/pageSidecar.ts` (Zod schema, `buildPageSidecar`, `parsePageSidecarText`, `pageSidecarPathFor`); `matchComicLine`/`COMIC_KEYWORDS` in `src/fountain/conventions.ts`; the `comic` option in `src/shots/scanScript.ts`; tests in `test/comics.test.ts`. Core stays read-only: it builds the object, the extension writes the file.

---

## Hand-off: what LoreFountain-VSCE must do to adopt it

Do these in the extension repo once it pins a Core release containing this change. None are done here.

1. **Validator and Problems panel.** Call `buildPageMap(text, entities)` per script when `hasPages`; report `issues` (warnings as warnings, info as notes, never failing `validate.js`). Run per-script checks on save, as for `ScriptShotIssue`s.
2. **Sidecar on save.** Beside the shot/cue sidecar writers: when `hasPages`, write `pageSidecarPathFor(path)` with `JSON.stringify(buildPageSidecar(basename, result), null, 2) + '\n'`; remove it when pages disappear; never hand-edit; add to `.gitignore` guidance as for the other sidecars. Entities come from the same `ShotMapEntity` list.
3. **Agent docs.** Add a "Comic scripts" section to the text in `src/config/agentFiles.ts` (and the generated `AGENTS.md`/`agents/*.md`): the syntax table above, the blank-line rule, `SFX:` semantics, and that PAGE/PANEL are not scene headings.
4. **Docs.** Add the convention to `docs/FOUNTAIN-EXTENSIONS.md` (summary table, convention lines, checks table), `resources/help/fountainSyntax.md`, the changelog and a VSCE ADR cross-referencing this one.
5. **Scripts view.** Show Page → Panel children for comic scripts (label, modifiers, panel count, word count), jumping to `lines.start`; flag over-budget panels from the info notes.
6. **Formatting upgrade.** Optional quick fixes: insert a blank line after a `PAGE:` line (`misread-as-character`); renumbering is out of scope.
7. **Highlighting and snippets.** TextMate grammar scopes for `PAGE:`, `PANEL:`, `CAPTION:`, `LAYOUT:`; snippets for page and panel.
8. **Decide the `SFX:` question** (see section 1) before shipping: tag handling in the audio-manifest check for comic panels.
9. **Version.** The `.pages.json` format is `schema_version` 1; Core is 0.x, so pin the exact release.
