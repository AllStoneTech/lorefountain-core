import { describe, expect, it } from 'vitest';
import { loreFountainConfigSchema } from '../src/config/readConfig';
import {
  PROJECT_TYPES,
  PROJECT_TYPE_PROFILES,
  describeProjectType,
  isProjectType,
  projectTypeFromConfig,
} from '../src/config/projectType';

describe('project types', () => {
  it('has a profile for every type, keyed by its own id', () => {
    for (const type of PROJECT_TYPES) {
      expect(PROJECT_TYPE_PROFILES[type].id).toBe(type);
      expect(PROJECT_TYPE_PROFILES[type].label.length).toBeGreaterThan(0);
      expect(PROJECT_TYPE_PROFILES[type].summary.length).toBeGreaterThan(0);
    }
  });

  it('lists custom last and serialized_universe alongside the series types', () => {
    expect(PROJECT_TYPES[PROJECT_TYPES.length - 1]).toBe('custom');
    expect(PROJECT_TYPES).toContain('serialized_universe');
  });

  it('recommends arcs and continuity only where they matter', () => {
    expect(PROJECT_TYPE_PROFILES.serialized_universe.features.arcs).toBe(true);
    expect(PROJECT_TYPE_PROFILES.serialized_universe.features.continuity).toBe(true);
    expect(PROJECT_TYPE_PROFILES.tv_series.features.arcs).toBe(false);
    expect(PROJECT_TYPE_PROFILES.comic.features.pagePanel).toBe(true);
    expect(PROJECT_TYPE_PROFILES.prose.features.cues).toBe(false);
    expect(Object.values(PROJECT_TYPE_PROFILES.custom.features).every((on) => !on)).toBe(true);
  });

  it('recognizes only valid values', () => {
    expect(isProjectType('comic')).toBe(true);
    expect(isProjectType('Comic')).toBe(false);
    expect(isProjectType(undefined)).toBe(false);
    expect(isProjectType(3)).toBe(false);
  });
});

describe('projectTypeFromConfig', () => {
  it('returns nothing and no issues when the key is absent', () => {
    expect(projectTypeFromConfig({})).toEqual({ issues: [] });
  });

  it('returns a valid type', () => {
    expect(projectTypeFromConfig({ project_type: 'serialized_universe' })).toEqual({ projectType: 'serialized_universe', issues: [] });
  });

  it('reports and ignores an unrecognized or non-string value', () => {
    for (const bad of ['film', '', 7, null, ['comic'], { a: 1 }]) {
      const result = projectTypeFromConfig({ project_type: bad });
      expect(result.projectType).toBeUndefined();
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toContain('project_type');
    }
  });

  it('does not invalidate the config file when the value is bad', () => {
    const parsed = loreFountainConfigSchema.safeParse({ folders: { world: 'w' }, project_type: 42 });
    expect(parsed.success).toBe(true);
  });
});

describe('describeProjectType', () => {
  it('names the type, structure and recommended conventions', () => {
    const text = describeProjectType('serialized_universe');
    expect(text).toContain('serialized_universe');
    expect(text).toContain('arcs');
    expect(text).toContain('continuity');
  });

  it('says so when a type recommends nothing extra', () => {
    expect(describeProjectType('custom')).toContain('none beyond the basics');
  });
});
