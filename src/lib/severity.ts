export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'unknown'] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#b71c1c', // dark red
  high: '#e53935', // red
  medium: '#fb8c00', // orange
  low: '#1e88e5', // blue
  unknown: '#9e9e9e', // grey
};

/** The worst severity with a non-zero count, or null when clean. */
export function highestSeverity(totals: Record<string, number> = {}): Severity | null {
  if (!totals) return null;
  for (const sev of SEVERITY_ORDER) {
    if ((totals[sev] ?? 0) > 0) return sev;
  }
  return null;
}

/** Solid colour for a severity, or a ~60%-alpha muted variant. undefined for null. */
export function severityColor(sev: Severity | null, muted = false): string | undefined {
  if (!sev) return undefined;
  const c = SEVERITY_COLOR[sev];
  return muted ? `${c}99` : c;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4, high: 3, medium: 2, low: 1, unknown: 0,
};

/** Sortable rank, worst = highest. Unrecognised severities rank below `unknown`. */
export function severityRank(sev?: string | null): number {
  const key = (sev ?? '').toLowerCase() as Severity;
  return SEVERITY_RANK[key] ?? -1;
}

/** Counts in SEVERITY_ORDER (worst first) — compare as a tuple to rank by severity. */
export function severityWeights(totals: Record<string, number> = {}): number[] {
  return SEVERITY_ORDER.map((sev) => totals?.[sev] ?? 0);
}

const SEVERITY_CACHE_KEY = 'ob-security-severity';

// undefined = never loaded this session; null = loaded and clean; Severity = loaded with findings.
let memoSeverity: Severity | null | undefined;

/**
 * Last-known severity, so the menu tint can paint immediately on landing instead of
 * waiting for the latest-run request. Reads the in-memory value, falling back to
 * localStorage; returns undefined when nothing has been cached yet.
 */
export function loadCachedSeverity(): Severity | null | undefined {
  if (memoSeverity !== undefined) return memoSeverity;
  try {
    const raw = localStorage.getItem(SEVERITY_CACHE_KEY);
    if (raw === null) return undefined;
    memoSeverity = raw === 'none' ? null : (raw as Severity);
    return memoSeverity;
  } catch {
    return undefined;
  }
}

/** Persist the latest severity to the in-memory + localStorage cache. */
export function storeCachedSeverity(sev: Severity | null): void {
  memoSeverity = sev;
  try {
    localStorage.setItem(SEVERITY_CACHE_KEY, sev ?? 'none');
  } catch {
    /* localStorage unavailable — in-memory cache still applies */
  }
}
