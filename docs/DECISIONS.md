# Architecture Decisions (LoreFountain-Core)

Decisions about Core itself. Earlier decisions (ADR-0038 shot maps, ADR-0040 Fountain extensions, ADR-0042 the move to Core) live in the LoreFountain extension repo's `docs/DECISIONS.md`. Core's numbering starts at ADR-0001. Newest first.

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
