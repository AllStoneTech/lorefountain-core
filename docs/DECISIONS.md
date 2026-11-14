# Architecture Decisions (LoreFountain-Core)

Decisions about Core itself. Earlier decisions (ADR-0038 shot maps, ADR-0040 Fountain extensions, ADR-0042 the move to Core) live in the LoreFountain extension repo's `docs/DECISIONS.md`. Core's numbering starts at ADR-0001. Newest first.

---

## ADR-0009 — Files LoreFountain-Producer owns carry `.lfp.` in their names

**Date:** 2026-11-14 · **Status:** Accepted (owner's instruction, 2026-11-14: "all files that you own should be named *.lfp.*").

### 1. Decision

Every file LoreFountain-Producer creates or owns has `.lfp.` before its extension, wherever it lives. In a project: `producer.lfp.json` (was `producer.json`), `producer/takes.lfp.json` and `producer/provenance.lfp.json` (were `takes.json` and `provenance.json`). Core publishes the names (`PRODUCER_CONFIG_FILE_NAME`, `TAKES_FILE`, `PROVENANCE_FILE`), the marker (`PRODUCER_FILE_MARKER`) and a predicate (`isProducerFileName`). Outside a project, the Producer applies the same rule to what it writes: inbox notes, renders, timing reports, Resolve exports, vault copies, cached segments, and its queue and lock files.

The old names are exported as `LEGACY_*` so the Producer can tell a project to rename them. Readers do not fall back to them: the Producer has never been released and no project but test copies has these files.

### 2. Why

It matches LoreFountain's own `.lf.md` suffix (ADR-0004): a file listing shows at a glance which files are LoreFountain's (`.lf.`) and which are the Producer's (`.lfp.`), a glob such as `**/*.lfp.*` selects them for editors, ignore files or backups, and nobody's own file is ever taken for one. Files the creator makes and drops in for the Producer keep the creator's names.

### 3. Consequences

- A minor-version format change while Core is 0.x; the Producer is the only reader.
- Temporary files the Producer deletes within the same command (an ffmpeg concat list, a working mix) are not covered: nobody sees them.

---

## ADR-0008 — Comic script layout for exports, PDF bookmarks and the export language

**Date:** 2026-11-13 · **Status:** Accepted (owner approved the design on 2026-11-13). Extension side: VSCE ADR-0052.

A comic script written with the Page/Panel convention (ADR-0001) used to export as screenplay text: `PAGE:` and `PANEL:` printed as action, and balloons printed as centred dialogue. An artist and letterer expect the comic "full script" layout instead. The extension's PDF, Word and HTML exports can now use it.

### 1. A second layout, chosen per export

The export settings gain `layout`: `auto` (the default), `screenplay` or `comic`. `auto` uses the project's `project_type` when it has one (ADR-0007; `defaultLayoutForProjectType` maps `comic` to the comic layout and every other type to none), and otherwise uses `comic` when the script has at least one explicit `PAGE:` line. The layout applies to PDF, Word and HTML. `.fountain` and the transcript have no layout. `.fdx` stays a screenplay, because Final Draft has no standard comic format.

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

Revisit when: a publisher needs another comic layout (Marvel method, per-panel word counts), or audio drama projects need a radio script layout.

---

## ADR-0007 — `project_type`: what kind of writing project this is

**Date:** 2026-11-13 · **Status:** Accepted (owner approved on 2026-11-13). Extension side: VSCE ADR-0051.

**Decision.** `config/projectType` defines the eight project types (`screenplay`, `tv_series`, `serialized_universe`, `audio_drama`, `comic`, `prose`, `tabletop`, `custom`), a profile for each (label, summary, structure and the recommended conventions), `projectTypeFromConfig` and `describeProjectType`. `project_type` is read from the config as `z.unknown()` and validated by the helper, the same way `comic` and `export` are, so a bad value is reported and ignored and never invalidates the file.

**Why.** A type names the writing format, not the output. It records and recommends: nothing in Core changes behavior because of it. Products read it from here so they agree on the list and on what each type means.

**Revisit when** a type needs to carry real defaults, or when the Producer's profiles are mapped to it.

---

## ADR-0006 — Script export: options, filter, screenplay model and page layout

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

It removes whole physical lines and never edits other lines, except to drop a `[tag]`. Lines inside a boneyard are left alone (or removed with it). Runs of blank lines that a removal creates collapse to one, and a kept convention line that standard Fountain would read as a character cue gets a leading `!` (ADR-0005), so every export is standard Fountain whether or not the writer fixed the warning.

### 4. The screenplay model and inline formatting

The model is the filtered script parsed with `parseFountain`: title page entries, then elements (scene heading with optional number, action, character with extensions and dual flag, parenthetical, dialogue, lyric, transition, centered, page break, section, synopsis). Each element's text is a list of runs with `bold`, `italic`, `underline` and `note` flags. Backslash escapes (`\*`, `\_`, `\\`) are shielded before parsing, because `fountain-js` drops the backslash and would turn an escaped `*word*` into emphasis (ADR-0005, section 5). Notes are kept as runs so each writer decides how to show them; the PDF never prints them.

### 5. Page layout for the PDF

`export/layout` lays the model out on a monospaced character grid, the industry way: Courier 12 pt (10 characters per inch, 6 lines per inch), US Letter by default or A4, 1.5 inch left margin, 1 inch right, top and bottom. Element columns and widths follow the common screenplay standard (action 6.0 in, dialogue 3.5 in at 2.5 in, parenthetical at 3.1 in, character at 3.7 in, transitions right-aligned). It handles page numbers (top right from page 2), `(MORE)` and `(CONT'D)` when a speech breaks across pages, no scene heading or character name stranded at a page bottom, dual dialogue side by side, forced page breaks, and an optional title page. The output is pages of positioned text rows, so the PDF renderer only draws them and the layout is unit-tested without a PDF library.

### 6. Final Draft XML and HTML

`.fdx` is Final Draft's XML (`FinalDraft DocumentType="Script" Version="5"`), with paragraph types Scene Heading, Action, Character, Parenthetical, Dialogue, Transition, Lyrics, Shot and General. `SHOT:` lines become Shot paragraphs, a feature Final Draft has that Fountain lacks. Scene numbers go in `Number`, dual dialogue in a `DualDialogue` group. Lyrics become italic Dialogue (Final Draft's screenplay template has no lyric element). Notes, sections and synopses are left out: they are never printed, and Final Draft's `ScriptNote` ties a note to a character range that Fountain doesn't record. `.html` is one self-contained, accessible page (semantic elements, one embedded stylesheet with print rules, no scripts).

Revisit when: a Final Draft version rejects the FDX, or a writer needs a layout setting (fonts, margins) that the industry default doesn't cover.

---

## ADR-0005 — Forced action (`!`) on convention lines, a shared misread check, and two `fountain-js` workarounds

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
## ADR-0004 — LoreFountain project documents carry the `.lf.md` suffix

**Date:** 2026-11-13 · **Status:** Accepted (owner leaned to a suffix and left the exact form open; built as below)

### 1. Decision

A LoreFountain file that is **about a project and is not an entity** carries the suffix `.lf.md` (lower-case): `world/style.lf.md` is the first. Any file whose name ends `.lf.md` is a **project document**: never an entity, glossary term, timeline event or note, in any folder, whatever it is called, in any letter case. One predicate decides it, `isProjectDocument(fileName)` in `project/files` (with `PROJECT_DOCUMENT_SUFFIX`), and `isNonEntityDoc` (the existing exclusion for `README.md` and `OVERVIEW.md`) calls it. Every place that skipped `OVERVIEW.md`/`README.md` uses it: the index build, the project loader, the file watcher's classifier, the validator, the World tree's notes list. A future `*.lf.md` needs no new special case anywhere.

The style bible moves from `world/STYLE.md` to `world/style.lf.md` with no migration (unreleased). The reservation of the bare name `style.md` is removed: `world/style.md` is an ordinary entity again.

### 2. Why a suffix

- **No collision, ever.** An entity file is `<name>.md`, and nobody names an entity `Something.lf`, so the suffix is effectively free, while a reserved bare name (`STYLE.md`) takes an ordinary word away from writers. The suffix is now reserved: a file ending `.lf.md` is never read as an entity.
- **Self-describing and greppable.** A file listing shows which files are LoreFountain's.
- **Editor-selectable.** A custom editor selector `**/*.lf.md` works for any world folder name and any depth, which `**/world/OVERVIEW.md` cannot (see the impact analysis).
- Alternatives weighed: a prefix (`_style.md`, hides in sorting but is not a standard idea), a reserved folder (`world/.lf/`, hides files from people), a different extension (`.lfmd`, loses Markdown tooling and previews). The suffix keeps `.md`, so every Markdown tool still opens it.

### 3. What stays as it is

The per-folder `README.md` files keep their names (owner, 2026-11-13). `OVERVIEW.md` was analysed in `docs/PROJECT-DOCUMENT-NAMING-IMPACT.md` and, on the owner's approval the same day, renamed to `overview.lf.md`: Core gains `project/storyOverview` (`OVERVIEW_FILE_NAME`, `LEGACY_OVERVIEW_FILE_NAME`, `findStoryOverviewFile`, which prefers the new name and still finds the legacy one). `isNonEntityDoc` keeps skipping the legacy `overview.md` while projects still carry it. The extension does the rename (extension ADR-0048).

### 4. Consequences

- A file ending `.lf.md` that a writer meant as an entity (a character named "Mara.lf") would be skipped silently. That is the price of a generic rule and a very unlikely name; the validator could warn about `.lf.md` files it has no schema for (not built).
- `isNonEntityDoc` keeps its name and signature; `isProjectDocument` is new and exported for callers that only care about the suffix (the extension's editor routing).

### 5. Files

`src/project/files.ts` (`PROJECT_DOCUMENT_SUFFIX`, `isProjectDocument`, `isNonEntityDoc`), `src/model/styleBible.ts` (`STYLE_BIBLE_FILE_NAME = 'style.lf.md'`), `src/project/styleBible.ts`, tests in `test/styleBible.test.ts`.

---

## ADR-0003 — Panels as shots: a narrated ("motion") comic through the existing shot map

**Date:** 2026-11-12 · **Status:** Proposed (built; the owner confirms the open points in section 8)

A narrated comic shows panel art in turn with voice and sound over it. The owner decided it is supported by **deriving a normal shot map from panels**, so LoreFountain-Producer reads the same `.shots.json` it reads for video and needs no code change. This ADR adds a few panel-level fields to the comic convention (ADR-0001) and the derivation. Everything else in ADR-0001 stands.

### 1. Syntax additions (inside a comic panel)

```
PAGE: 7 (TURN)

PANEL: [harbor-wide] Wide shot of the harbor. WINONA stands on the pier.
DURATION: 5s
MOVE: slow zoom in
MUSIC: [dawn-theme] IN

CAPTION: Dawn, 1925.

SFX: [gull-cry] KRAAAW

PANEL: Close on Winona.

WINONA (O.P.)
(whispering)
We should go.
```

| Line | Meaning |
|---|---|
| `PANEL: [tag] text` | An optional explicit tag, written exactly like a shot tag (`matchLeadingTag`: lowercase slug in brackets right after the prefix; `[[Wikilink]]` and free brackets are not tags). Never part of the description. |
| `DURATION: 4s` in a panel | Same lenient parser as shots (`parseDurationSeconds`). Recorded as `durationText` (always) and `durationSeconds` (when readable). Last one wins. Inert before the first panel, like `POSE:` before a `SHOT:`. |
| `MOVE: slow zoom in` | **New comic keyword** (in `COMIC_KEYWORDS`, so it is read only in comic scans and cannot collide with anything in a screenplay). Freeform camera-move hint for the still, the Producer's `motion` vocabulary. Recorded as `moveText` (as written) and `motion` (a recommended value from `RECOMMENDED_SHOT_MOTIONS` when the text is recognized, otherwise the text itself). Inert outside a panel. |
| `PAGE: 7 (TURN)` | The `TURN` modifier is unchanged in the page's `modifiers`, and now also sets `pageTurn: true` on the **first panel of that page**: the panel that follows the turn, a reveal. |

`motion` recognition (first match wins, case-insensitive): `hold`/`held`/`still`/`static`/`locked off` to `none`; `parallax`; `zoom in`/`push in`/`ken burns in` to `ken-burns-in`; `zoom out`/`pull back` to `ken-burns-out`; `pan left`/`right to left` to `pan-left`; `pan right`/`left to right` to `pan-right`; `drift` to `drift`. Anything else is kept as written, because `motion` stays freeform (as in the shot manifest).

**Panel tags.** An explicit tag wins. Otherwise the default is derived: `<prefix>-p<page>-<panel>`, for example `1x03-p7-2` (page 7, panel 2). The prefix is the script's production code, as a slug, supplied by the caller (`tagPrefix`; the extension passes the title page's `Production Code`, falling back to the file's slug); with no usable prefix the tag is `p7-2`. A range page (`2-3`) uses its first number; a page whose label is not numeric uses its encounter index (`pg3-1`). Default tags are **positional**: inserting a panel renumbers the later ones, so a panel that has art or recorded takes should carry a written tag, exactly the advice for shots. Tags are validated for duplicates across written and default tags (`duplicate-panel-tag`, warning), which also catches a repeated page number.

### 2. `.pages.json` additions (additive; `schema_version` stays 1)

On each panel, all optional: `tag`, `durationText`, `durationSeconds`, `moveText`, `motion`, `pageTurn`. A page map written before this change still validates. **Policy:** the schema is `.strict()`, so a consumer pinned to an older Core would reject a file that carries the new keys; that is the existing arrangement (ADR-0001, hand-off 9: Core is 0.x, products pin an exact release), and earlier additive changes (e.g. `onScreen` in `.shots.json`) kept `schema_version` 1 the same way. The default tag is not stored in `.pages.json` (it depends on the caller's prefix); it appears in the derived `.shots.json`.

### 3. Derivation: `buildShotMapFromPages` (`src/comics/panelShots.ts`)

Pure. One shot per numbered panel, in document order, in the existing `.shots.json` entry shape.

| Shot field | From |
|---|---|
| `scene`, `sceneHeading`, `intExt`, `timeOfDay`, `setting`, `locations` | The scene in effect where the panel opens (headings resolved as for shots). |
| `shot` | The panel's 1-based position **within its scene** (a page is not a scene; ADR-0001 section 2). |
| `tag` | Explicit or derived (section 1). |
| `description`, `pose`, `light` | The panel's `PANEL:` text, `POSE:`, `LIGHT:`. |
| `durationText`, `durationSeconds` | The panel's `DURATION:`. |
| `lines` | The panel's line range. |
| `action` | The panel's further action blocks. |
| `entities` | Mentions in the panel's own direction text and speaker names (never balloon or caption text), as for shots. |
| `cues` | `MUSIC:`/`AMB:` cue lines inside the panel's range, as for shots; a lettered `SFX:` only when `comic.sfxAsCue` is true. |
| `onScreen`, `transition` | Always empty/absent. |
| `spoken` | Section 4. |
| `page`, `pageLabel`, `panel`, `motion`, `pageTurn` | **New, optional, derived shots only**: the page's number (when numeric), its label as written, the panel number, the camera move, and the page-turn flag. |

Fields are additive. A consumer that ignores them reads a normal shot. Derived shots carry no `SHOT:` line, so `lines.start` is the `PANEL:` line.

### 4. What is heard: balloons, captions, SFX

- **Balloon** becomes a `spoken` line `{speaker, speakerEntity?, extensions, text, simultaneous?, line}`, with `O.P.`, `THOUGHT` and the other cue extensions kept. Each parenthetical becomes its own entry before the line, as in dialogue: `{direction, speaker, speakerEntity?, line}`, or `{pause:'speaker', ...}` for `(beat)` and the like. The page map keeps no per-parenthetical line, so these carry the balloon's line.
- **Caption** is narration, so it becomes a `spoken` line in the same shape a screenplay narrator has: `extensions: ['V.O.']`, speaker from `CAPTION (SPEAKER):`, otherwise the stable id **`NARRATOR`** (`COMIC_NARRATOR_SPEAKER`), plus the new optional flag **`caption: true`** on the line. The flag lets the Producer show the text as a caption box and keep it as narration when it renders balloon text, without parsing speaker names. Casting follows the existing speaker rule: an entity named `NARRATOR` (or the `(SPEAKER)` character) gets `speakerEntity`; otherwise the Producer casts the speaker string. An empty caption speaks nothing.
- **Lettered `SFX:`** is never `spoken`. It is a cue only with `comic.sfxAsCue` (ADR-0001, option C), and then it is listed in `cues` and in `.cues.json` as ever.
- Lettering written under a page before its first `PANEL:` (panel 0) belongs to no shot. It was already a `content-outside-panel` warning.

### 5. Precedence

1. **Explicit `SHOT:` lines win.** If the script has any `SHOT:` line, its shot map is the ordinary one and panels are not derived. An info note `panels-not-derived` says so (only when derivation was asked for). Mixing the two in one script would need rules for interleaving two timelines; the owner can ask for it later.
2. **No `PAGE:` line:** nothing changes. Screenplays, audio dramas and every other script produce exactly the shot map they did.
3. **`comic.panelsAsShots` off (default):** nothing changes for any script, including print comics. `buildShotMap` is untouched in behavior; the new function is a separate entry point the caller opts into.

### 6. The setting

`comic.panelsAsShots` (boolean, default false), read by `comicSettingsFromConfig` and carried on `resolveComicSettings(...).panelsAsShots`, tolerant like the other `comic` keys (a non-boolean is dropped and reported). Core only reads it; the extension decides whether to call `buildShotMapFromPages` and write the sidecar. With the setting on, a panel with no description gets the existing `missing-panel-description` info note, reworded to say its derived shot has no picture description (`buildPageMap({ panelsAsShots: true })`).

### 7. Files in Core

`src/comics/panelShots.ts` (`buildShotMapFromPages`, `COMIC_NARRATOR_SPEAKER`), `src/comics/panelTags.ts` (`defaultPanelTag`, `resolvePanelTags`), `src/comics/parseComic.ts` (`tag`, `durationText`/`durationSeconds`, `moveText`/`motion`, `pageTurn`, `motionFromMoveText`), `src/comics/pageMap.ts` (the same fields, `duplicate-panel-tag`, `tagPrefix`, `panelsAsShots`), `src/comics/pageSidecar.ts` (schema), `src/comics/limits.ts` (setting), `src/fountain/conventions.ts` (`MOVE`), `src/shots/shotMap.ts` (additive entry fields, `caption` on `SpokenLine`, `derivedFromPanels` on the result, `panels-not-derived`, and the previously private speaker/location helpers exported for reuse), `test/panelShots.test.ts`. Producer fingerprints (`producer/fingerprint`) already read `description`, `pose`, `light` and `action`, so a derived shot's staleness works with no change; `motion` is not part of picture text. Core stays read-only.

### 8. Open points for the owner

1. **`TURN` means the page revealed by a turn.** `PAGE: 7 (TURN)` flags page 7's first panel (ADR-0001: "a page-turn reveal"). If the owner means "a turn happens after this page", the flag belongs on the next page's first panel; one line to change.
2. **Positional default tags.** `1x03-p7-2` changes when a panel is inserted, orphaning takes keyed to it. The mitigation is a written `[tag]`; a "Tag all panels" quick fix (as for shots, writing permanent ids) is the natural follow-up and is not built.
3. **`caption: true` on a `spoken` line** and the **`NARRATOR`** speaker id are new contract surface for the Producer.
4. **Explicit `SHOT:` disables derivation for the whole script**, rather than mixing.
5. **`MOVE:` text is mapped to the shot-manifest vocabulary where recognized.** An unrecognized phrase passes through as `motion` unchanged.
6. The shot-sidecar has no published Zod schema in Core; the golden test checks entries against a test-local strict schema. Publishing a real `.shots.json` schema is a separate piece of work.

---

## ADR-0002 — The project style bible: `world/style.lf.md`

> **Amended 2026-11-13 by ADR-0004:** the file is `world/style.lf.md` (it was `world/STYLE.md` while unreleased, so nothing migrates), and the exclusion below is now the generic `*.lf.md` rule. A real entity named "Style" (`world/style.md`) is allowed again. The owner's decisions on the open points: (a) a malformed file fails the headless validator (kept); (b) an empty `medium` means every medium (kept); (c) the file is created and edited through a guided editor, not free-form text (built in the extension, ADR-0047 there).

**Date:** 2026-11-12 · **Status:** Proposed (built; the owner confirms the open points in section 6)

Comics, video and illustrated books need one place that says what the project *looks like*, so every generated or drawn image starts from the same brief and a human artist can read it too. Today the look lives nowhere: character looks are in each entity's `physical_description`, reference sheets in `characters.json`, and text styles in the Producer's `producer.json`.

### 1. Decision

One optional file, `world/style.lf.md`, modeled on the Story Overview (`world/OVERVIEW.md`, extension ADR-0029/0032): small tolerant YAML frontmatter plus a free Markdown body. It is read by Core (`model/styleBible`, `project/styleBible`, `loadProject().style`); only the extension writes it.

Frontmatter, every field optional, unknown fields kept (`catchall`):

| Field | Type | Meaning |
| --- | --- | --- |
| `medium` | string or list | Media this style covers (`comic`, `video`, `illustrated-book`, `animation`, `audio`; any string is accepted). Absent or empty means every medium. |
| `art_style` | string | One-line summary of the look. |
| `palette` | string or list | Names and/or hex values, e.g. `Harbor teal #2a7f8e`. Hex must be quoted (a bare `#` is a YAML comment; the error says so). |
| `reference_images` | string or list | Project-relative paths (or `http(s)` URLs) of mood and style references. |
| `avoid` | string or list | Negative prompts. |
| `format` | map medium to string or object | Per-medium hints; an object may carry `aspect_ratio`, `trim_size` and anything else. |
| `lettering` | string or list | Comic lettering notes (font, balloons, SFX treatment). |
| `era_reference` | string | The period the look draws on. |

The body is never checked. The scaffold suggests Overall look, Characters (global rules), Color & light, Line & rendering, Framing & composition, Lettering (comic), Motion & pacing (video), Format notes per medium, What to avoid. Per-medium subsections are plain headings, not schema.

### 2. Why this shape

- **Tolerant, like every schema here.** A file with no frontmatter, or with only prose, parses; adding structure later loses nothing. A lone string is a list of one so `medium: comic` works.
- **`format` is keyed by medium** because aspect ratio and trim size are per-medium facts; a flat `aspect_ratio` would be ambiguous for a project that is both comic and video.
- **A normalized view, `resolveStyleBible`,** so consumers (the Producer) get lists, lower-cased media, split palette entries (`parsePaletteEntry`) and `styleAppliesTo(style, medium)` without re-implementing the leniency.
- **Reference images are resolved, not required.** `readStyleBible` resolves them against the project root and records the missing ones (`missingReferenceImages`) so a caller reports them as information. A path outside the project is flagged `outside-project` and never touched; a URL is `remote` and not fetched.
- **Excluded from entity discovery:** by the `.lf.md` suffix (`isProjectDocument`, ADR-0004), case-insensitively, anywhere under the indexed folders. The first draft reserved the bare name `style.md`, which would have made a real entity called Style impossible; the suffix convention removed that cost.

### 3. What it does not duplicate (checked against the Producer spec)

| Concern | Lives in | style.lf.md's role |
| --- | --- | --- |
| A character's look, wardrobe, per-version appearance | the entity's `physical_description` and `looks` | Global rules only ("all adults drawn with heavy brows"). |
| Character reference sheets (front, three-quarter, profile) | `assets/manifests/characters.json` | `reference_images` are mood and style references, not sheets of a character. |
| Text styles for `SUPER:`, `TITLE CARD:`, `CHYRON:`, captions | the Producer's `producer.json` (`textStyles`) | Not covered. `lettering` is free prose for comic balloons, not a template. |
| Provider, model, take policy, output formats, loudness | `producer.json` | Not covered. style.lf.md names no vendor and no setting a provider would own. |
| Project profiles (Producer starting settings) | Producer | A profile is how to produce; style.lf.md is what it should look like. A profile could pre-fill a style.lf.md. |

### 4. How the Producer should use it (hand-off, not built here)

Prepend `art_style`, the palette, `era_reference` and the matching `format` hint to each visual job's prompt for a medium the style `styleAppliesTo`; send `reference_images` that exist as style references where the provider accepts them; add `avoid` as the negative prompt, or append it as "do not include" text for providers without one; show missing references on the board. The extension has no AI features; this file is data.

### 5. Files in Core

`src/model/styleBible.ts` (schema, parse/serialize, `resolveStyleBible`, `parsePaletteEntry`, `styleAppliesTo`), `src/project/styleBible.ts` (`readStyleBible`, `resolveReferenceImage`), `style` and a `style` issue kind in `src/project/loadProject.ts`, `isProjectDocument` in `src/project/files.ts`, tests in `test/styleBible.test.ts`. Core stays read-only.

### 6. Open points for the owner

1. The name and location (`world/style.lf.md`, top level of the world folder; other folders are not searched). **Decided:** the `.lf.md` suffix, ADR-0004.
2. `medium` empty means "all media" rather than "unspecified". **Decided: keep.**
3. A bare YAML `#` hex colour is an error with an explanatory message rather than silently dropped. **Decided: keep** (a malformed file fails the validator); the guided editor makes it impossible to write.
4. Whether the Producer spec should gain a "Style bible" section and a project-profile pre-fill. **Done:** the section is in the Producer spec (documentation only); the pre-fill is still open.

---

## ADR-0001 — The comic script convention: `PAGE:` / `PANEL:`

**Date:** 2026-11-11 · **Status:** Accepted 2026-11-12 (the owner decided the two open questions: `SFX:` handling, option C, and the word-budget thresholds as per-project presets). The word-budget numbers remain guidance, not standards.

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
- **`SFX:` is reused, not duplicated. Decided: option C (owner, 2026-11-12).** Comic writers already write `SFX:`; a second keyword would fight muscle memory. In a panel it is the lettered effect (the text is the lettering, e.g. `KRAAAW`), recorded in the page map. By default a comic-panel `SFX:` is lettering only: it is **not** extracted into `.cues.json` and a `[tag]` on it is **not** checked against `audio.json`. The project setting `comic.sfxAsCue` (default `false`) makes it both, for a narrated or motion comic where an effect is lettered and heard. `MUSIC:` and `AMB:` are always audio cues. A script with no `PAGE:` line (screenplay, audio drama) is unaffected. "Comic panel" means what the comic walk places in a panel, from a `PAGE:`/`PANEL:` forward; an `SFX:` before any `PAGE:`/`PANEL:`, or inside a boneyard, follows the ordinary rules (the first stays a cue, the second is hidden). Filtering lives where cues are extracted (`extractCues(text, { sfxAsCue })`), so every caller sees the same cues. Rejected: option A (leave SFX double-counted, and tell writers not to tag it) made a comic-only project's audio checks noisy; option B (a distinct `LETTER:` keyword) fights muscle memory and splits one idea into two words. A side effect: a shot's `cues` list in `.shots.json` no longer lists a comic-panel `SFX:` by default, since it is not a cue.
- **No `[tag]` on `PAGE:`/`PANEL:` in the first cut.** Panels are keyed by position. Art-asset manifests for panels would need tags like shots have; deferred. *(Superseded for `PANEL:` by ADR-0003: an optional `[tag]`, plus `DURATION:`, `MOVE:` and `TURN` hints, for narrated comics. `PAGE:` still takes no tag.)*

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
- **Info (never fail a run):** `page-number-gap`, `empty-page`, `missing-panel-description`, `splash-multiple-panels`, `spread-without-range`, `misread-as-character`, and the word-budget notes `many-panels`, `many-balloons`, `long-balloon`, `long-panel-dialogue`. Each message names the limit and the preset (or `comic.limits.<name>`) that fired. See section 4a.
- Dialogue and `SFX:` before any page are ignored silently (a script may have a prologue).

### 4a. Word-budget thresholds: per-project presets. Decided (owner, 2026-11-12)

The limits are four numbers, each of which may be `null` (that note is switched off): `maxPanelsPerPage`, `maxBalloonsPerPanel`, `maxWordsPerBalloon`, `maxWordsPerPanel`. They live in `src/comics/limits.ts` as `COMIC_PRESETS`: `western` (default), `manga`, `european`, `webtoon` and `custom` (everything off; only `comic.limits` applies). `DEFAULT_PAGE_LIMITS` is the `western` preset.

| Preset | panels/page | balloons/panel | words/balloon | words/panel |
|---|---|---|---|---|
| `western` | 9 (unsourced; the old default) | 3 (WEBTOON handbook; Creative Bloq) | 25 (Dark Horse guide; several writers) | 35 (Buzz Dixon; Dark Horse allows ~50) |
| `manga` | 8 (partly sourced: pages reported at ~5 to 8, sources disagree) | 3 (Creative Bloq manga advice) | 25 (unsourced, Western figure) | 35 (unsourced, Western figure) |
| `european` | off (no norm found) | 3 (unsourced) | 25 (unsourced) | 35 (unsourced) |
| `webtoon` | off (no pages) | 3 (WEBTOON creator handbook) | 25 (unsourced; the handbook says 1-2 sentences, not a word count) | 35 (unsourced) |
| `custom` | off | off | off | off |

**Resolution order, highest first:** the project's `lorefountain.config.json` `comic.limits` (per limit) > the project's `comic.preset` > the user-level VS Code setting `lorefountain.comic.defaultPreset` > the built-in default (`western`). The headless validator has no VS Code settings, so it uses the project config, then the built-in default. Config shape: `{"comic": {"preset": "manga", "limits": {"maxWordsPerBalloon": 30, "maxPanelsPerPage": null}, "sfxAsCue": false}}`; reading is tolerant (a bad value is dropped and reported, the rest applies).

**Research caveats (web search, 2026-11-12; treat every figure as guidance, not fact).**

- ~25 words per balloon is a common rule of thumb (Dark Horse's submission script guide, several writers), not a measured norm.
- Words per panel runs from ~35 (Buzz Dixon, who counts captions and SFX) to ~50 (the Dark Horse ceiling). We count balloons and captions only, so 35 is deliberately the conservative end.
- Balloons per panel is about 3 (WEBTOON's creator handbook: 3 or fewer per panel and 1-2 sentences per bubble; Creative Bloq's manga advice: a maximum of 3). Dan Jolley's rule of thumb is page-density based (4 on pages of up to 4 panels, 3 on five, 2 on six or more); a single per-panel number cannot express it, so a density-aware check is a possible later refinement.
- Panels per page: **no source was found** for a typical 5-6 or a maximum of 9 for Western comics, so `western`'s 9 is an unsourced starting value kept from the previous default. Manga pages are reported at about 5 to 8 on average (sources disagree: 4-6 to 6-8; seinen runs denser than shoujo). Franco-Belgian albums are typically 46-48 pages, with no confirmed panels-per-page norm. WEBTOON is a vertical scroll with no pages (avoid more than two panels on screen at once; no per-episode standard was found).
- `european`, and the `manga`/`webtoon` word figures, are placeholders that reuse the Western numbers so the presets exist and can diverge once real sources turn up. Each value carries a source or "unsourced starting value" comment in `limits.ts`.

### 5. Out of scope for this first cut

Pro exports (a comic script/lettering export), any VS Code UI (Pages view, hover, completion, snippets), tags and manifests for panels, a lettering-only `SFX` keyword (decided against, section 1), page-parity or turn derivation, a page-density-aware balloon limit, a `LOOK:`-style breakdown per page. (`.cues.json` filtering of comic SFX is no longer out of scope: it is `comic.sfxAsCue`, section 1.)

### 6. Files in Core

`src/comics/parseComic.ts` (structure walk), `src/comics/pageMap.ts` (`buildPageMap`: entities, counts, issues), `src/comics/pageSidecar.ts` (Zod schema, `buildPageSidecar`, `parsePageSidecarText`, `pageSidecarPathFor`); `src/comics/limits.ts` (`COMIC_PRESETS`, `comicSettingsFromConfig`, `resolveComicSettings`); `src/cues/parseCues.ts` (`extractCues(text, { sfxAsCue })`); the `comic` key in `src/config/readConfig.ts`; `matchComicLine`/`COMIC_KEYWORDS` in `src/fountain/conventions.ts`; the `comic` option in `src/shots/scanScript.ts`; tests in `test/comics.test.ts`. Core stays read-only: it builds the object, the extension writes the file.

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
8. **`SFX:` (decided, section 1) and limits (decided, section 4a).** Pass `{ sfxAsCue }` to `extractCues`, and the resolved `preset`/`limits`/`overriddenLimits` to `buildPageMap`, everywhere they are called. Resolve them with `comicSettingsFromConfig` and `resolveComicSettings`.
9. **Version.** The `.pages.json` format is `schema_version` 1; Core is 0.x, so pin the exact release.
