/**
 * Checks `LOOK: CHARACTER label` lines against `characters.json`.
 *
 * Exports {@link findLookIssues}. Pure: the shot map comes from
 * `buildShotMap` and the manifest from `readCharacterManifest`, so this
 * module has no file or `vscode` dependency.
 *
 * A look is checked only when the character's manifest entry lists `looks`:
 * a character with no entry, or an entry with no looks, has nothing to
 * check against yet (a look can be written before its image is sourced), so
 * it is never reported. Labels compare case-insensitively with whitespace
 * collapsed.
 */

import type { CharacterAssetManifest } from '../assets/entityManifest';
import type { ScriptShotIssue, ShotMapEntry } from './shotMap';

/** Lowercase and collapse whitespace, for comparing labels. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Report each `LOOK:` line whose label isn't one of the character's `looks`
 * in `characters.json`.
 *
 * @param shots - The script's shots, from `buildShotMap`.
 * @param characters - The parsed `characters.json`, keyed by character entity id.
 * @returns One `unknown-look` warning per unmatched `LOOK:` line, listing the labels that do exist.
 */
export function findLookIssues(shots: readonly ShotMapEntry[], characters: CharacterAssetManifest): ScriptShotIssue[] {
  const issues: ScriptShotIssue[] = [];
  for (const shot of shots) {
    for (const look of shot.looks ?? []) {
      const labels = (characters[look.characterEntity]?.looks ?? []).map((entry) => entry.label);
      if (labels.length === 0) continue;
      if (labels.some((label) => normalize(label) === normalize(look.look))) continue;
      issues.push({
        code: 'unknown-look',
        severity: 'warning',
        line: look.line,
        path: `lines[${look.line}]`,
        message: `LOOK: ${look.character} "${look.look}" (line ${look.line + 1}) isn't one of ${look.character}'s looks in characters.json (${labels.map((label) => `"${label}"`).join(', ')}). Fix the spelling, or add the look to characters.json.`,
      });
    }
  }
  return issues;
}
