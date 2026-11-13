# Changelog

All notable changes to LoreFountain-Core are recorded here. This project follows [Semantic Versioning](https://semver.org/). While the version is 0.x, a minor version can change a format or an API; products pin an exact release.

## [Unreleased]

### Added

- `CHANGELOG.md` and `ROADMAP.md`.
- **A read-only project loader**, `project/loadProject`: reads a project's config, entities, glossary terms, timeline events, scripts (each with its shot map, cues and title page built in memory) and asset manifests. It never writes and never reads sidecars. Bad files are collected as issues instead of thrown, an invalid manifest counts as empty, and a script the Fountain parser throws on is reported and skipped.
- `project/files`: file discovery matching the extension's index build (`listFilesWithExtension`, `ENTITY_EXCLUDED_SUBDIRS`, `isNonEntityDoc`).
- `config/folders` and `config/readConfig`: folder-name resolution and reading `lorefountain.config.json`, moved from the extension. Writing the config stays in the extension.
- **The `producer.json` format**, `producer/config`: the Zod schema (schema version 1) for LoreFountain-Producer's settings file, covering sources per asset type and per-tag overrides, take policy, media vault, output formats and loudness, casting, text styles, locked references, per-shot fixes and coverage sub-shots, plus a tolerant reader. A file from a newer Producer is reported as `newer-version` without being parsed. Keys are camelCase except `schema_version`.
- **The `producer/` record formats**, `producer/records`: `producer/takes.json` (the accepted take for each shot tag, spoken line `<shot-tag>.<n>` and cue tag: its vault path, file fingerprint, the fingerprint of the script text it was made from, and who accepted it when) and `producer/provenance.json` (keyed by file fingerprint). Tolerant readers, with newer versions reported unparsed.
- **Script-text fingerprints**, `producer/fingerprint`, so both products agree on when a take is stale. A shot's picture depends on its `SHOT:`, `POSE:`, `LIGHT:` and action text; a line's recording on its speaker, directions and words; a cue's sound on its type, role, timing and description. Whitespace changes don't count. `spokenLinesOf` gives the numbering used for line recordings.
- 30 more unit tests (272 in all).

- **The comic script convention** (ADR-0001, `docs/DECISIONS.md`): `PAGE:`/`PANEL:`/`CAPTION:`/`LAYOUT:` prefix lines plus ordinary dialogue for balloons, `comics/parseComic`, `comics/pageMap` (`buildPageMap`, with word counts and issues) and `comics/pageSidecar` (the `.pages.json` schema, version 1). `scanScript` takes `{ comic: true }`; default scans are unchanged.

- **Panels as shots** (ADR-0003): `comics/panelShots` (`buildShotMapFromPages`) derives a normal `.shots.json` shot map from a comic's panels, so a narrated or motion comic feeds LoreFountain-Producer with no Producer change. New panel fields in the convention and `.pages.json` (additive, `schema_version` still 1): an explicit `PANEL: [tag]` (default `<code>-p7-2`, checked for repeats: `duplicate-panel-tag`), `DURATION:` (`durationText`/`durationSeconds`), a new comic keyword `MOVE:` (`moveText`/`motion`) and `pageTurn` from a `TURN` page. Balloons become `spoken` lines; captions become V.O. lines with `caption: true` for the speaker or `NARRATOR`; a lettered `SFX:` is a cue only with `comic.sfxAsCue`. Explicit `SHOT:` lines win (`panels-not-derived`); scripts without pages are unchanged. Derived shots carry optional `page`, `pageLabel`, `panel`, `motion`, `pageTurn`. The project setting `comic.panelsAsShots` (default false) is read by `comicSettingsFromConfig`/`resolveComicSettings`. 35 more unit tests (414 in all).
- **Comic `SFX:` is lettering by default** (ADR-0001, option C): `extractCues(text, { sfxAsCue })` leaves `SFX:` lines inside a comic panel out of the cues, so they are not written to `.cues.json` or checked against `audio.json`. The project setting `comic.sfxAsCue` (default false) keeps them as cues too. `MUSIC:` and `AMB:` are unaffected, as is any script with no `PAGE:` line.
- **Comic word-budget presets**, `comics/limits`: `COMIC_PRESETS` (`western`, `manga`, `european`, `webtoon`, `custom`), `resolveComicSettings` (project `comic.limits` over `comic.preset` over a user-level default over `western`), and `comicSettingsFromConfig`, a tolerant reader for the new `comic` block of `lorefountain.config.json` (`preset`, `limits`, `sfxAsCue`). Any limit may be `null` to switch its note off. `buildPageMap` takes `preset`, `limits` and `overriddenLimits`, and each note names the limit and preset that fired. `loadProject` returns the resolved `comic` settings. The numbers are guidance with sources or "unsourced" noted in the code.

- **The `.lf.md` naming convention** (ADR-0004): a file ending `.lf.md` is a LoreFountain project document, never an entity, glossary term, event or note. `project/files` gains `isProjectDocument` and `PROJECT_DOCUMENT_SUFFIX`; `isNonEntityDoc` (used by `loadProject` and the extension's index, watcher and validator) now calls it instead of reserving `style.md`, so a real entity named Style is allowed. `docs/PROJECT-DOCUMENT-NAMING-IMPACT.md` analyses renaming `OVERVIEW.md` and the folder `README.md` files the same way (report only, nothing renamed).
- **The Story Overview is `world/overview.lf.md`** (ADR-0004): `project/storyOverview` (`OVERVIEW_FILE_NAME`, `LEGACY_OVERVIEW_FILE_NAME`, `findStoryOverviewFile`) finds the new name first and the legacy `OVERVIEW.md` second; the legacy name is still excluded from entity discovery. The extension renames existing files.
- **The project style bible** (ADR-0002, file `world/style.lf.md`): `model/styleBible` (Zod schema, `parseStyleBibleFile`, `serializeStyleBible`, `resolveStyleBible`, `parsePaletteEntry`, `styleAppliesTo`) and `project/styleBible` (`readStyleBible`, `resolveReferenceImage`) for the optional `world/style.lf.md`: tolerant frontmatter (`medium`, `art_style`, `palette`, `reference_images`, `avoid`, `format`, `lettering`, `era_reference`) plus a free body. `loadProject` returns it as `style` (with missing reference images listed, not reported as issues) and files a bad one under a new `style` issue kind. `isNonEntityDoc` now also skips `STYLE.md`. 29 more unit tests.

### Changed

- **Comic default limits changed:** balloons per panel 5 to 3, words per panel 40 to 35 (panels per page 9 and words per balloon 25 stay). `PageLimits` fields may now be `null`.
- The README describes how products link Core during development (`file:../LoreFountain-Core`) and the plan for prebuilt release tarballs.

## [0.1.0] - 2026-11-06

First release: LoreFountain's parsing code, extracted from the extension (AllStoneTech/lorefountain at 30c1f74). The extension's behavior is unchanged.

### Added

- **Fountain:** `fountain/parse` (Fountain 1.1 through `fountain-js`, with each token's line recovered and boneyard text ignored), `fountain/conventions` (LoreFountain's prefix lines and `[tag]` syntax), `fountain/boneyard`.
- **Shots:** `shots/scanScript`, `shots/shotMap`, `shots/parseShots`, `shots/sceneHeading`. The shot map is what the extension writes to `.shots.json` (schema version 1). Per shot it has the numbering and tag, the scene heading broken into parts with resolved locations, the line range, `spoken` (dialogue, every parenthetical with its wording, speaker and scene pauses, lyrics, each with its `line`), `action`, `onScreen`, `transition`, `entities` and `cues`. Script issues are found while it's built: `orphaned-parenthetical`, `bare-pause-line`, `ambiguous-location` and `unforced-transition`.
- **Cues:** `cues/parseCues` for `SFX:`, `MUSIC:` and `AMB:`.
- **Models:** entity, glossary, timeline, story overview and script models in `model/`, with their Zod schemas.
- **Mentions:** `index/mentions`.
- **Manifests:** schemas and a read-only reader for `shots.json`, `audio.json` and the entity manifests (`assets/`).
- 242 unit tests (Vitest), CI (type check, lint, tests, build), MIT license.

### Known issues

- `fountain-js` 1.2.4 throws on a `~` lyric directly under a character cue, so that script fails to parse.
