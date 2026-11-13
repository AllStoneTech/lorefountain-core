/**
 * Unit tests for finding the Story Overview file (`src/project/storyOverview.ts`).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findStoryOverviewFile } from '../src/project/storyOverview';

describe('findStoryOverviewFile', () => {
  let world: string;
  beforeEach(() => {
    world = join(mkdtempSync(join(tmpdir(), 'lorefountain-overview-')), 'world');
  });
  afterEach(() => {
    rmSync(join(world, '..'), { recursive: true, force: true });
  });

  it('is undefined with no world folder or no file', async () => {
    expect(await findStoryOverviewFile(world)).toBeUndefined();
    mkdirSync(world);
    writeFileSync(join(world, 'mara.md'), 'x');
    expect(await findStoryOverviewFile(world)).toBeUndefined();
  });

  it('finds the new name in any case', async () => {
    mkdirSync(world);
    writeFileSync(join(world, 'Overview.LF.md'), 'x');
    expect(await findStoryOverviewFile(world)).toEqual({ filePath: join(world, 'Overview.LF.md'), legacy: false });
  });

  it('falls back to the legacy OVERVIEW.md and marks it legacy', async () => {
    mkdirSync(world);
    writeFileSync(join(world, 'OVERVIEW.md'), 'x');
    expect(await findStoryOverviewFile(world)).toEqual({ filePath: join(world, 'OVERVIEW.md'), legacy: true });
  });

  it('prefers the new name when both exist', async () => {
    mkdirSync(world);
    writeFileSync(join(world, 'OVERVIEW.md'), 'old');
    writeFileSync(join(world, 'overview.lf.md'), 'new');
    expect((await findStoryOverviewFile(world))?.legacy).toBe(false);
  });
});
