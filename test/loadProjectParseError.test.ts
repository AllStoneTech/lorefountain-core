/**
 * Unit test for `project/loadProject.ts`'s parse-error path. Kept in its own
 * file because it mocks `fountain/parse.ts` for the whole file: no real script
 * is known to make the parser throw any more (Core ADR-0002), so the mock makes
 * any script containing `THROW-ME` fail.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/fountain/parse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/fountain/parse')>();
  return {
    ...actual,
    parseFountain: (text: string) => {
      if (text.includes('THROW-ME')) throw new TypeError('simulated parser crash');
      return actual.parseFountain(text);
    },
  };
});

// `vi.mock` is hoisted above imports, so this import already gets the mocked parser.
import { loadProject } from '../src/project/loadProject';

let root: string;

/** Write `text` to `relativePath` under the project root, creating folders. */
function put(relativePath: string, text: string): void {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lorefountain-load-error-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('loadProject parse errors', () => {
  it('reports a script the Fountain parser throws on, and keeps loading the rest', async () => {
    put('scripts/a.fountain', 'INT. A - DAY\n\nTHROW-ME\n');
    put('scripts/b.fountain', 'INT. B - DAY\n\nMara waits.\n');

    const project = await loadProject(root);

    expect(project.scripts.map((script) => script.script.id)).toEqual(['b']);
    expect(project.issues).toEqual([
      expect.objectContaining({ kind: 'script', reason: 'parse-error', message: expect.stringContaining('simulated parser crash') }),
    ]);
  });
});
