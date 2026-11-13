# Architecture Decisions (LoreFountain-Core)

Decisions about Core itself. Earlier decisions (ADR-0038 shot maps, ADR-0040 Fountain extensions, ADR-0042 the move to Core) live in the LoreFountain extension repo's `docs/DECISIONS.md`. Core's numbering starts at ADR-0001. Newest first.

---

## ADR-0004 — Comic script layout for exports, PDF bookmarks and the export language

**Date:** 2026-11-13 · **Status:** Accepted (owner approved the design on 2026-11-13). Extension side: its ADR-0046.

A comic script written with the Page/Panel convention (ADR-0001) used to export as screenplay text: `PAGE:` and `PANEL:` printed as action, and balloons printed as centred dialogue. An artist and letterer expect the comic "full script" layout instead. The extension's PDF, Word and HTML exports can now use it.

### 1. A second layout, chosen per export

The export settings gain `layout`: `auto` (the default), `screenplay` or `comic`. `auto` uses the project's type when the project has one (the coming `project_type`; `defaultLayoutForProjectType` maps it, and is aligned with the real field when that lands), and otherwise uses `comic` when the script has at least one explicit `PAGE:` line. The layout applies to PDF, Word and HTML. `.fountain` and the transcript have no layout. `.fdx` stays a screenplay, because Final Draft has no standard comic format.

### 2. The comic document model

`export/comic` builds the model from the filtered text with `extractComic` (ADR-0001), so it agrees with the page map. The structure is fixed: comic layout always keeps `PAGE:`, `PANEL:`, `LAYOUT:`, `CAPTION:` and `SFX:` lines, whatever the preset says, because without them there is nothing to lay out. Shot lines, tags, notes and boneyard follow the export options as before, so `SHOT:` lines from narrated comics are left out unless chosen. Text keeps its inline formatting (the same runs as the screenplay model), and backslash escapes stay literal.

Per page: a heading (`PAGE ONE`, `PAGES TWO–THREE` for a spread, a written label such as `INSIDE FRONT COVER`), the panel count, any modifiers (`SPLASH`, `TURN`), an optional left/right mark, then page notes and the page `LAYOUT:`. Per panel: `PANEL 1`, its `LAYOUT:`, the description, the `SHOT:`/`POSE:`/`LIGHT:` lines when kept, further direction, and the lettering. Lettering is numbered per page, restarting at 1, so a letterer can match each balloon to the art: `CAPTION`, `CAPTION (NAME)`, `NAME`, `NAME (WHISPER)` with any parenthetical before the words, and `SFX`. Text before the first `PAGE:` or `PANEL:` is not part of the comic and is left out, as the page map does. Scene headings are not printed.

### 3. Left and right pages

With `comicPageSides` on, each page is marked `(LEFT)` or `(RIGHT)`. Page one is a right-hand page, so odd pages are right and even pages left; a spread is marked `(SPREAD)`. It is off by default, because many publishers number from a cover or an inside cover.

### 4. Comic page layout for the PDF

`export/comicLayout` uses the same Courier grid and output shape as the screenplay layout, so the PDF renderer draws both unchanged. Margins are 1 inch on every side. The page heading is bold and underlined, the panel heading bold, descriptions run the full 6.5-inch measure, and lettering hangs: number, label, then the words in a column of their own. Each comic page starts a new sheet. A comic page longer than a sheet continues under `PAGE ONE (CONTINUED)`, a panel heading never ends a sheet, and a lettering entry moves whole unless it is longer than a sheet. Sheets are numbered top right from sheet 2.

### 5. PDF bookmarks

Both layouts list bookmarks per sheet: scene headings (with their numbers) for a screenplay, comic pages for a comic. The renderer turns them into the PDF's outline, so a reader can jump to a scene or a page.

### 6. The export language

The export settings gain `language`, a BCP 47 tag (default `en`), validated with `Intl.getCanonicalLocales`. HTML, PDF and Word declare it, so screen readers and spell checkers use the right language. It is set in the config, not the dialog.

Revisit when: `project_type` lands (align `defaultLayoutForProjectType`), a publisher needs another comic layout (Marvel method, per-panel word counts), or audio drama projects need a radio script layout.

---

## ADR-0003 — Script export: options, filter, screenplay model and page layout

**Date:** 2026-11-12 · **Status:** Accepted (owner approved the design on 2026-11-11 and 2026-11-12)

Scripts export to `.fountain`, `.pdf`, `.fdx`, `.html` and `.docx`, all free tier. Core holds everything that needs no third-party library, so any product or a command line can export the same way. The extension (its ADR-0045) adds the PDF and Word renderers, the dialog and the files.

### 1. One pipeline

`export/options` (a Zod schema and four presets) → `export/filter` (standard Fountain text) → `export/screenplay` (a document model with styled text runs) → a writer. The `.fountain` writer is the filter's output. Every other writer reads the model, so all formats agree on what is in the script.

### 2. Options and presets

Include/exclude: shot lines (`SHOT:`, `POSE:`, `LIGHT:`, `DURATION:`), sound cues (`SFX:`, `MUSIC:`, `AMB:`), `PAUSE:` lines, comic lines (`PAGE:`, `PANEL:`, `LAYOUT:`, `CAPTION:`), `[tags]` (dropping a tag keeps its line), notes, sections, synopses, boneyard, LoreFountain's title-page keys (`Order:`, `Production Code:`), and scene numbers (as written, numbered automatically, or none).

| Preset | Keeps |
|---|---|
| Pure Fountain | Standard Fountain only: every LoreFountain line, tag and title key removed. Notes, sections and synopses stay (they are Fountain). |
| Production draft | Everything. |
| Audio draft | Sound cues and pauses; shot lines and tags removed. |
| Custom | The writer's own choices, which the extension can save per project. |

Boneyard is off in every preset: cut material shouldn't leave the project by accident.

### 3. The filter keeps the output standard

It removes whole physical lines and never edits other lines, except to drop a `[tag]`. Lines inside a boneyard are left alone (or removed with it). Runs of blank lines that a removal creates collapse to one, and a kept convention line that standard Fountain would read as a character cue gets a leading `!` (ADR-0002), so every export is standard Fountain whether or not the writer fixed the warning.

### 4. The screenplay model and inline formatting

The model is the filtered script parsed with `parseFountain`: title page entries, then elements (scene heading with optional number, action, character with extensions and dual flag, parenthetical, dialogue, lyric, transition, centered, page break, section, synopsis). Each element's text is a list of runs with `bold`, `italic`, `underline` and `note` flags. Backslash escapes (`\*`, `\_`, `\\`) are shielded before parsing, because `fountain-js` drops the backslash and would turn an escaped `*word*` into emphasis (ADR-0002, section 5). Notes are kept as runs so each writer decides how to show them; the PDF never prints them.

### 5. Page layout for the PDF

`export/layout` lays the model out on a monospaced character grid, the industry way: Courier 12 pt (10 characters per inch, 6 lines per inch), US Letter by default or A4, 1.5 inch left margin, 1 inch right, top and bottom. Element columns and widths follow the common screenplay standard (action 6.0 in, dialogue 3.5 in at 2.5 in, parenthetical at 3.1 in, character at 3.7 in, transitions right-aligned). It handles page numbers (top right from page 2), `(MORE)` and `(CONT'D)` when a speech breaks across pages, no scene heading or character name stranded at a page bottom, dual dialogue side by side, forced page breaks, and an optional title page. The output is pages of positioned text rows, so the PDF renderer only draws them and the layout is unit-tested without a PDF library.

### 6. Final Draft XML and HTML

`.fdx` is Final Draft's XML (`FinalDraft DocumentType="Script" Version="5"`), with paragraph types Scene Heading, Action, Character, Parenthetical, Dialogue, Transition, Lyrics, Shot and General. `SHOT:` lines become Shot paragraphs, a feature Final Draft has that Fountain lacks. Scene numbers go in `Number`, dual dialogue in a `DualDialogue` group. Lyrics become italic Dialogue (Final Draft's screenplay template has no lyric element). Notes, sections and synopses are left out: they are never printed, and Final Draft's `ScriptNote` ties a note to a character range that Fountain doesn't record. `.html` is one self-contained, accessible page (semantic elements, one embedded stylesheet with print rules, no scripts).

Revisit when: a Final Draft version rejects the FDX, or a writer needs a layout setting (fonts, margins) that the industry default doesn't cover.

---

## ADR-0002 — Forced action (`!`) on convention lines, a shared misread check, and two `fountain-js` workarounds

**Date:** 2026-11-12 · **Status:** Accepted (owner approved on 2026-11-11 and 2026-11-12)

Ground rule, as always: **extend Fountain, never change it.** Everything here makes LoreFountain read standard Fountain more faithfully. None of it adds syntax.

### 1. A leading `!` is allowed on every convention line

Fountain 1.1 forces a line to be Action with a leading `!`, which every 1.1 app strips before printing. That is the standard way to stop an all-caps convention line (`SHOT: CLOSE-UP`) with text directly under it from being read as a character cue. `matchPrefixLine`, `matchComicLine` and the cue extractor accept one optional `!` before the keyword (after any indentation, as before), and report it as `forced: true`. A forced line is action in every Fountain app, so it is never reported as misread.

Rejected: allowing a lowercase keyword (`Shot:`). It would change the convention, and a mixed-case line is only safe by accident.

### 2. One misread check for every script

`fountain/misread.ts` finds convention lines that standard Fountain reads as a character cue: no lowercase letter, not forced, a blank line (or the file start) before, and a non-blank line directly after. Comics used to have their own copy in `comics/pageMap.ts`, which now calls the shared one. The extension reports it on every script. LoreFountain keeps reading these lines as convention lines (the `scanScript` rescue), so shot maps and cues stay right while the writer fixes them.

### 3. Position recovery tolerates what `fountain-js` strips

`fountain-js` tokens carry no positions, so `mapTokensToPositions` searches for each token's text in the source. Token text differs from the source when `fountain-js` strips or rewrites it: a leading `!`, `@`, `.`, `>` or `~` on a line, a backslash escape (`\*`), a tab (becomes four spaces), and a two-space line inside dialogue (becomes empty). Those tokens used to be skipped silently, so a forced block vanished from shot maps and cues. The search now tries the exact text first and then a tolerant pattern that allows exactly those differences.

### 4. A lyric directly under a character cue no longer crashes the parser

`fountain-js` 1.2.4 throws when the first line of a speech is a `~` lyric (`DialogueBlock` reads `previousToken.type` with no previous token). Lyrics there are valid Fountain, and the writer is not asked to add a parenthetical. `parseFountain` parses normally and, only if that throws, parses again with those lyric markers swapped for a same-length placeholder (so every line and offset stays put), then turns the placeholder lines back into lyric tokens. A script that parses today is untouched.

The upstream fix is one character (`previousToken?.type`). Reporting it to `fountain-js` is a public post, so it waits for the owner's go-ahead. When an upstream release fixes it, the fallback can go.

### 5. Backslash escapes are an output concern

`fountain-js` drops the backslash from `\*` and `\_`, so in token text an escaped `*word*` and real emphasis look the same. LoreFountain's sidecars and fingerprints store plain token text and never render emphasis, so nothing shown today is wrong. Exports that render emphasis (the script export work) format from the source text, not from token text.

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
