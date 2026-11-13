# Impact analysis: should `OVERVIEW.md` and the folder `README.md` files adopt the `.lf.md` convention?

**Date:** 2026-11-13 · **Status:** Decided the same day. `OVERVIEW.md` is renamed to `overview.lf.md` (built: both names read, existing files renamed automatically on the first run after an update, nine demo files renamed; extension ADR-0048). The folder `README.md` files keep their names. The analysis below is as written before the decision; section 6 describes the compatibility design, except that the rename is automatic and there is no separate command.

Context: Core ADR-0004 makes `*.lf.md` the marker for LoreFountain project documents that are not entities, starting with `world/style.lf.md`. The Story Overview (`world/OVERVIEW.md`) and the scaffolded per-folder `README.md` files (eight templates; each demo carries seven) predate the convention. This note says what moving them would involve.

## 1. What exists today

| File | Where | Written by | Read by |
| --- | --- | --- | --- |
| `OVERVIEW.md` | `world/` only | Initialize Workspace, Try LoreFountain, demos | Story Overview editor, World tree row, Pro story bible export, agents |
| `README.md` | project root, `world/`, `world/glossary/`, `world/timeline/`, `world/notes/`, `scripts/`, `imports/`, `assets/` (8 files) | the README scaffold (`readmeFiles.ts`), refreshed by Check File Updates | people; AI agents; excluded from indexing by name |

`README.md` is special in a different way from `OVERVIEW.md`: GitHub, VS Code's Markdown preview, file explorers and every host render a folder's `README.md` automatically. `README.lf.md` would lose all of that.

## 2. Code that names them

Extension (`LoreFountain-VSCE`), each needing a change for `OVERVIEW.md`:

- `src/config/storyOverview.ts` (scaffold target `OVERVIEW.md`), `src/commands/tryLoreFountain.ts` (sample `OVERVIEW.md`), `src/providers/worldTreeProvider.ts` (`path.join(folders.world, 'OVERVIEW.md')`), `src/demos/demoDownloader.ts` (comment only), `pro/src/storyBibleCommand.ts` (reads the overview for the story bible export).
- Doc comments: `src/providers/storyOverviewEditorProvider.ts`, `storyOverviewRender.ts`, `storyOverviewForm.ts`, Core `src/model/storyOverview.ts`.
- **Exclusion by name is already one place**: Core `project/files` `isNonEntityDoc` (`readme.md` or `overview.md` or any `*.lf.md`), used by the index build, the project loader and the file watcher. Moving to the suffix would let those two names be removed from it, so the convention gets *simpler*, not more complex.
- Custom editor selector, `package.json`: `"filenamePattern": "**/world/OVERVIEW.md"`. See section 5.
- Help and agent text: `resources/help/storyOverview.md`, `storyBible.md`, `resources/readmes/world.md`, `resources/agents/world-builder.md`, `resources/agents/initiator.md` (and `AGENTS.md` through the README text).
- Tests: `test/unit/build.test.ts`, `storyOverview.test.ts`, `storyOverviewForm.test.ts`; Core `test/loadProject.test.ts`, `storyOverviewModel.test.ts`.

For `README.md`: `src/config/readmeFiles.ts` (seven `targetRelativePath` entries plus the root), `readmeVersions.ts` and `commands/checkFileUpdates.ts` (stale detection finds the file by path, so a project with the old name would look "missing" and be re-scaffolded next to the old one), the eight templates in `resources/readmes/`, `test/unit/readmeFiles.test.ts`, `readmeVersions.test.ts`, `demoDownloader.test.ts`, and the README mentions in help topics. Telemetry files mention `README.md` only as the repository's own README, not a project's.

**Producer** (`LoreFountain-Producer`): `src` mentions neither name. It reads projects through Core, so the only effect is the shared exclusion in `isNonEntityDoc`. No Producer change for either rename.

## 3. Demo projects (`LoreFountain-VSCE/demos`)

There are ten folders; nine are full projects (`ScreenPlay` has no `world/`). The task brief said eight; the folder now holds nine real projects plus the small `lorefountain-demo`.

| Rename | Files renamed in demos |
| --- | --- |
| `world/OVERVIEW.md` to `world/overview.lf.md` | **9** (one per project) |
| every `README.md` to `README.lf.md` | **63** (7 per project × 9: project root, world, glossary, notes, timeline, scripts, imports) |
| Both | **72** |

Besides the renames, **23 demo files mention `OVERVIEW.md` by name**: 16 are scaffolded agent copies (`agents/world-builder.md`, `initiator.md`, `validate.js` per project; they refresh through Check File Updates when the version markers bump) and 7 are project prose that would need hand editing (`imports/source-material.md` in Imperium in Imperio, Of One Blood and The Comet, `Loomwake/SESSION_ZERO.md`, `Loomwake/world/vhel.md`, `The_Conjure_Woman/world/README.md`, `The_Heroic_Slave/README.md`). Demos fall under the owner's demo-fidelity rules (source material stays untouched), so the `imports/source-material.md` mentions need a decision of their own.

## 4. The owner's real projects

Each one has one `OVERVIEW.md` and up to eight `README.md` files, plus any prose, wikilink or Markdown link that points at them, and any git history or external link (a published repo's README is the page GitHub shows). I could not count these from here. A migration command (section 6) is the only safe route; hand-renaming would also leave the old scaffolded README stale in Check File Updates.

## 5. Other places a project document name matters

1. **Custom editor selectors only match a folder literally named `world`.** `**/world/OVERVIEW.md` and the Story Card's `**/world/*.md` ignore the `folders.world` setting in `lorefountain.config.json`. A project with `"world": "lore"` gets no Story Card editor and no Story Overview editor (both open as text). The style bible's selector, `**/*.lf.md`, does not have this gap, which is an argument for the suffix on `OVERVIEW.md`.
2. **The nested-subfolder gap.** `**/world/*.md` matches direct children only. A character in `world/places/harbor.md` (the loader and index do walk subfolders) opens as raw text, not a Story Card. Fix, independent of any rename: a second selector `**/world/**/*.md`, with the Story Card provider checking the index to decide whether a file is an entity, and redirecting anything else (as it already redirects `*.lf.md`).
3. **Folder settings.** `lorefountain.config.json` `folders.*` rename `world`, `scripts`, `imports`, `assets`; `glossary`, `timeline`, `notes` follow `world`. The scaffold already writes READMEs under the configured names. A `.lf.md` convention is independent of folder names, so it works with every setting. `OVERVIEW.md` and the style bible are looked up inside the configured world folder only, never in subfolders.
4. **World tree.** The notes list shows every `.md` in `world/notes/`, including that folder's scaffolded `README.md`, which therefore appears as a note called "Readme". I only added the `*.lf.md` exclusion there; I left the README behaviour as it was. Excluding READMEs too is a one-line follow-up.
5. **Editor association default.** `package.json` `configurationDefaults` now maps `*.lf.md` to the guided style editor. The same device would make `OVERVIEW.md` deterministic if it were suffixed.

## 6. Migration and compatibility design (if the owner chooses to rename)

1. **Read both names for at least one release.** Finder helpers (like `findStyleBibleFile`) look for `overview.lf.md` first, then `OVERVIEW.md` (any case). The index exclusion keeps `readme.md` and `overview.md` while the old names exist.
2. **New projects write the new names**; the README scaffold's version-check treats either file at a target as present, so Check File Updates neither re-scaffolds nor reports "missing".
3. **A command, "LoreFountain: Rename Project Documents to the New Convention"**: shows the plan (each rename, plus every Markdown or wikilink reference it would rewrite), asks once, renames with `git mv` semantics when the folder is a repository (or `fs.rename` plus a warning when not), rewrites references in the project's own files, and can be run twice safely. Never touches `imports/` source material.
4. **Selectors:** replace `**/world/OVERVIEW.md` with `**/overview.lf.md`; keep the old pattern for the compatibility release.
5. **Agent docs and validator:** bump version markers; the validator accepts both names and prints a note suggesting the command.

## 7. Recommendation

- **`OVERVIEW.md`: yes, rename to `overview.lf.md`, but not yet.** It is the one existing file with the same nature as the style bible (a singleton, its own schema, its own editor), it removes the folder-name gap in its editor selector, and the cost is small: 9 demo files, 5 source files, 1 selector, plus a compatibility read. Do it as its own change after the style bible has been used, with the migration command.
- **`README.md`: no.** The folder `README.md` files are for people and for hosts that render them by name. A `.lf.md` suffix buys nothing (they are already excluded by name) and costs 63 demo renames, the GitHub and preview rendering, and a scaffold/version-check migration. Leave them. The `isNonEntityDoc` name check for `readme.md` stays.
- Independently, fix the two selector gaps in section 5 (configured folder names and nested subfolders), which matter more to users than any rename.
