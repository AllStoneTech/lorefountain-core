# Changelog

All notable changes to LoreFountain-Core are recorded here. This project follows [Semantic Versioning](https://semver.org/). While the version is 0.x, a minor version can change a format or an API; products pin an exact release.

## [Unreleased]

### Added

- `CHANGELOG.md` and `ROADMAP.md`.
- **A read-only project loader**, `project/loadProject`: reads a project's config, entities, glossary terms, timeline events, scripts (each with its shot map, cues and title page built in memory) and asset manifests. It never writes and never reads sidecars. Bad files are collected as issues instead of thrown, an invalid manifest counts as empty, and a script the Fountain parser throws on is reported and skipped.
- `project/files`: file discovery matching the extension's index build (`listFilesWithExtension`, `ENTITY_EXCLUDED_SUBDIRS`, `isNonEntityDoc`).
- `config/folders` and `config/readConfig`: folder-name resolution and reading `lorefountain.config.json`, moved from the extension. Writing the config stays in the extension.
- **The `producer.json` format**, `producer/config`: the Zod schema (schema version 1) for LoreFountain-Producer's settings file, covering sources per asset type and per-tag overrides, take policy, media vault, output formats and loudness, casting, text styles, locked references, per-shot fixes and coverage sub-shots, plus a tolerant reader. A file from a newer Producer is reported as `newer-version` without being parsed. Keys are camelCase except `schema_version`.
- 20 more unit tests (262 in all).

### Changed

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
