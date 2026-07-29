import { describe, it, expect, beforeEach } from 'vitest';
import {
  highestSeverity,
  severityColor,
  SEVERITY_ORDER,
  loadCachedSeverity,
  storeCachedSeverity,
  severityRank,
  severityWeights,
} from '../severity';

describe('severity ranking', () => {
  it('ranks worst-first and puts unrecognised severities below unknown', () => {
    expect(severityRank('critical')).toBeGreaterThan(severityRank('high'));
    expect(severityRank('low')).toBeGreaterThan(severityRank('unknown'));
    expect(severityRank('HIGH')).toBe(severityRank('high'));
    expect(severityRank(undefined)).toBeLessThan(severityRank('unknown'));
  });

  it('emits counts in SEVERITY_ORDER, defaulting missing severities to zero', () => {
    expect(severityWeights({ critical: 1, low: 4 })).toEqual([1, 0, 0, 4, 0]);
    expect(severityWeights()).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('highestSeverity', () => {
  it('returns the worst severity present', () => {
    expect(highestSeverity({ critical: 0, high: 2, medium: 5, low: 1 })).toBe('high');
    expect(highestSeverity({ critical: 1, high: 2 })).toBe('critical');
    expect(highestSeverity({ medium: 3 })).toBe('medium');
  });

  it('returns null when nothing is present', () => {
    expect(highestSeverity({ critical: 0, high: 0, medium: 0, low: 0, unknown: 0 })).toBeNull();
    expect(highestSeverity({})).toBeNull();
    expect(highestSeverity(undefined as any)).toBeNull();
  });

  it('order is critical > high > medium > low > unknown', () => {
    expect(SEVERITY_ORDER).toEqual(['critical', 'high', 'medium', 'low', 'unknown']);
  });
});

describe('severityColor', () => {
  it('returns a colour per severity', () => {
    expect(severityColor('critical')).toBeTruthy();
    expect(severityColor('high')).not.toBe(severityColor('medium'));
  });

  it('returns undefined for null', () => {
    expect(severityColor(null)).toBeUndefined();
  });

  it('muted variant differs from the solid colour', () => {
    expect(severityColor('high', true)).not.toBe(severityColor('high', false));
  });
});

describe('severity cache', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no localStorage in this env */
    }
  });

  it('round-trips a severity through the cache', () => {
    storeCachedSeverity('high');
    expect(loadCachedSeverity()).toBe('high');
  });

  it('caches a clean scan as null (not "not yet loaded")', () => {
    storeCachedSeverity(null);
    expect(loadCachedSeverity()).toBeNull();
  });
});
