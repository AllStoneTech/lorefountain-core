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
| `cues/parseCues` | `SFX:`, `MUSIC:` and `AMB:` cues |
| `model/*` | Entity, glossary, timeline, story overview and script models, with their Zod schemas |
| `index/mentions` | Finds entity mentions in text |
| `assets/*` | The schemas and readers for `shots.json`, `audio.json` and the entity manifests |

Import a module by its path:

```ts
import { buildShotMap } from 'lorefountain-core/shots/shotMap';
```

## Installing

The package isn't on npm. Depend on a tagged release from GitHub; it builds on install:

```json
"dependencies": {
  "lorefountain-core": "github:AllStoneTech/lorefountain-core#v0.1.0"
}
```

To work on Core and a product together, link the local folder:

```bash
cd LoreFountain-Core && npm install && npm link
cd ../LoreFountain-VSCE && npm link lorefountain-core
```

Run `npm run build` in Core after each change; the product reads `dist/`. `npm install` in the product puts the tagged release back.

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
