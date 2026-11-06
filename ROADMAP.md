# Roadmap

What's planned for LoreFountain-Core, in order. Core is the shared parsing layer for LoreFountain (the VS Code extension) and LoreFountain-Producer. It reads and parses only; anything that writes a LoreFountain file stays in the extension.

Done items move to `CHANGELOG.md`.

## Now: make Core installable by CI

- [ ] Attach a prebuilt `npm pack` tarball to each GitHub release, so products can pin a release without a build step. (`github:` dependencies don't install on npm 11.12, which fails while preparing git dependencies.) Creating a release is an outward-facing step the owner approves each time.
- [ ] A release workflow that builds, tests, packs and attaches the tarball when a tag is pushed.
- [ ] Switch the extension (branch `feature/lorefountain-core`) and the Producer from `file:../LoreFountain-Core` to the pinned release.

## Next: what the Producer's phase 1 needs

- [x] **A read-only project loader** (`project/loadProject`): every entity, glossary term, timeline event and script, honoring `lorefountain.config.json` folder names, with no index store. The Producer's validate stage uses it.
- [ ] Have the extension's `index/build.ts` use Core's `project/files` instead of its own copy of the same discovery rules.
- [ ] **Published file formats**: Zod schemas for `.shots.json` and `.cues.json` as read from disk, with `schema_version` checks, so a consumer can tell when a project's files are newer than it supports.
- [x] **`producer.json` schema** and tolerant reader (`producer/config`).
- [x] **`producer/` record schemas** for accepted takes and provenance, plus script-text fingerprints for stale detection.
- [ ] Consent records (`producer/consent.json`), for likeness and voice consent.
- [ ] Match line recordings by fingerprint as well as position, so inserting a line doesn't make every later recording look stale (Producer spec, "Stale assets").
- [ ] Fix or work around the `fountain-js` crash on a lyric directly under a character cue.

## Later: conventions agreed for after LoreFountain 1.1.0

Each lands in Core first, then in the extension (diagnostics, quick fixes, docs) and the Producer.

- [ ] `SUPER:`, `TITLE CARD:` and `CHYRON:` prefix lines, each with an optional `[tag]`, written to `onScreen` with `kind` `super`, `titleCard` and `chyron`.
- [ ] `LOOK: CHARACTER label` lines, validated against the character's looks, and a per-script breakdown (each scene's cast, looks, locations, props, sounds and on-screen text).
- [ ] Locked scene numbers (Fountain `#n#`), with unlock, renumber and an old-to-new map.
- [ ] Several reference images per character version and look, each optionally labelled with its angle.
- [ ] Structured pronunciation on entities and glossary terms: a string, or `{ respelling, ipa }`.
- [ ] Required shot tags: an `untagged-shot` check, plus tag generation for the extension's "Tag all shots" quick fix.
- [ ] A shot-tag rename map written by the extension and applied by the Producer.

## Open questions

- Which version a character is in for a scene: worked out from continuity (Timeline and Production Code order), or written in the breakdown? (Producer spec, Open decisions.)
- Whether Core is ever published to npm. For now, GitHub releases only.
