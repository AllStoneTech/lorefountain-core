# LoreFountain-Core

The shared parsing core behind [LoreFountain](https://github.com/AllStoneTech/lorefountain) and LoreFountain-Producer. Both products read a project through this package, so they read it identically.

It reads and parses only. It never writes a file, so a product that uses it can't change a LoreFountain project by accident. Writing scripts, sidecars, entity files and manifests stays in LoreFountain itself.

## What's in it

| Module | What it does |
| --- | --- |
| `fountain/parse` | Parses [Fountain](https://fountain.io/) 1.1 with `fountain-js`, and recovers each token's line |
| `fountain/conventions` | LoreFountain's prefix lines (`SHOT:`, `PAUSE:`, `SFX:` ...) and `[tag]` syntax |
| `fountain/boneyard` | Finds Fountain boneyard (`/* ... */`) so hidden text is ignored |
| `shots/scanScript` | A line-level scan of a script: headings, prefix lines, action, dialogue, transitions, lyrics |
| `shots/shotMap` | The per-shot map written to a script's `.shots.json`, and the script issues found while building it |
| `shots/parseShots`, `shots/sceneHeading` | Shot lines and scene headings |
| `comics/parseComic`, `comics/pageMap`, `comics/pageSidecar`, `comics/limits` | The comic script convention (`PAGE:`/`PANEL:`/`CAPTION:`): structure, the page map written to `.pages.json`, its schema, and the word-budget presets and `comic` config settings. See `docs/DECISIONS.md` |
| `cues/parseCues` | `SFX:`, `MUSIC:` and `AMB:` cues |
| `model/*` | Entity, glossary, timeline, story overview, style bible and script models, with their Zod schemas |
| `index/mentions` | Finds entity mentions in text |
| `assets/*` | The schemas and readers for `shots.json`, `audio.json` and the entity manifests |

Import a module by its path:

```ts
import { buildShotMap } from 'lorefountain-core/shots/shotMap';
```

## Installing

The package isn't on npm. Each GitHub release has a prebuilt package attached (made with `npm pack`, `dist/` included), and products pin it by URL:

```json
"devDependencies": {
  "lorefountain-core": "https://github.com/AllStoneTech/lorefountain-core/releases/download/v0.4.0/lorefountain-core-0.4.0.tgz"
}
```

Installing it needs no build step and works on any npm. (A `github:` dependency would build on install, but npm 11.12 fails while preparing git dependencies.) The extension lists Core as a dev dependency because esbuild bundles it.

To work on Core and a product together, link the sibling checkout for the session, and put the release back when done:

```bash
cd LoreFountain-Core && npm install && npm run build
cd ../LoreFountain-VSCE && npm install --no-save ../LoreFountain-Core
# ...when finished:
npm ci
```

Run `npm run build` in Core after each change, since products read `dist/`.

## Releasing

1. Move the changelog's Unreleased entries under the new version, and set the version with `npm version <x.y.z> --no-git-tag-version`.
2. Run `npm run check`, then commit, and tag `v<x.y.z>` (tags are never moved).
3. Run `npm pack`, and attach `lorefountain-core-<x.y.z>.tgz` to a GitHub release for the tag.
4. In each product, point the dependency at the new release's URL and run `npm install`, so the lockfile records its integrity.

## Developing

```bash
npm install
npm run check
```

`check` runs the type check, lint and unit tests (Vitest). `npm run build` writes `dist/`.

## Versioning

Products pin a tag. A change to a sidecar or manifest format is a breaking change for both products, so it's released as a new version and both are updated together. Every change ships as a new tag; tags are never moved.

## License

MIT, © All Stone Tech. LoreFountain Pro code never goes in this repository.
