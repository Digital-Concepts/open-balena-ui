# Sortable columns — Fleet security reports

Date: 2026-07-29
Status: implemented (open-balena-ui, working tree)

## Problem

The Fleets security page (`src/components/securityFleets.tsx`) renders three tables in
fixed input order: the container list of a fleet release, the per-container CVE list, and
the per-container SBOM package list. Nothing is sortable, and the container list isn't
even ordered, so triaging a release means reading every row.

## Requirements

- Every meaningful column on all three Fleets-page tables sorts ascending and descending.
- Sorting is value-aware, not lexical: severity by rank, CVSS numerically, findings by
  severity weight.
- Sorting composes with the existing SBOM text filter.
- No visual redesign — reuse MUI's sort affordance and the existing table styling.

## Design

### `src/lib/useSortableRows.tsx`

Two exports, kept next to `tableStyles.ts` so the Security pages share one mechanism.

`useSortableRows(rows, columns, initialKey)` returns `{ sorted, sortKey, sortDir, toggle }`.
Columns are declared as `{ key, label, value, defaultDir?, align? }`, where `value(row)`
is the comparable accessor. Behaviour:

- **Types.** Numbers compare numerically; strings via `localeCompare` with `numeric: true`,
  so `v2` sorts before `v10`. A `value` may return `number[]`, compared element-wise —
  this is how multi-key columns are expressed without a separate tiebreak mechanism.
- **Blanks last.** `null`, `undefined`, `''` and `NaN` always sort to the bottom, in both
  directions. A CVE with no CVSS score never displaces one that has a score.
- **Stability.** `Array.prototype.sort` is stable, so input order breaks remaining ties.
- **Toggle.** Clicking the active column flips direction; clicking a new column starts at
  that column's `defaultDir` (`desc` for counts and severity, `asc` for text).
- Columns are declared inline by callers and so arrive as a fresh array each render; the
  hook holds them in a ref and keys its `useMemo` on `[rows, sortKey, sortDir]`.

`<SortableCell col sort />` wraps MUI `TableSortLabel` in a `TableCell`, giving the arrow,
hover affordance, `sortDirection` and `aria-sort` for free.

### `src/lib/severity.ts`

- `severityRank(sev)` — worst-first rank (`critical` 4 … `unknown` 0); unrecognised or
  missing severities rank `-1`, below `unknown`. Case-insensitive.
- `severityWeights(totals)` — counts in `SEVERITY_ORDER` as a tuple, for element-wise
  comparison. Sorting that tuple descending orders by criticals first, then highs, etc.

### Column configuration

| Table | Sortable columns | Default |
|---|---|---|
| Containers | Service, Image, Findings (`severityWeights`) | Findings desc |
| CVEs | CVE, Severity (`[rank, cvss]`), CVSS, Package, Version, Fixed | Severity desc |
| SBOM | Package, Version, Type, License | Package asc |

The CVE severity column's tuple means a severity sort orders the worst CVE within each
tier first. The expand-toggle column stays unsortable. The SBOM hook is fed the
already-filtered array, so filter and sort compose. Row striping (`stripeRowSx(index)`)
uses the post-sort index, so the zebra pattern stays correct after reordering.

## Testing

- `src/lib/__tests__/useSortableRows.test.tsx` — direction toggling, per-column default
  direction, numeric vs text comparison, element-wise array comparison, blanks-last in
  both directions, stability.
- `src/lib/__tests__/severity.test.ts` — rank ordering, case-insensitivity, unrecognised
  severities, `severityWeights` defaults.
- `src/components/__tests__/securityFleets.test.tsx` — a three-container fixture whose
  alphabetical and severity orders disagree; asserts default worst-first container order,
  Service-click reordering, severity-rank CVE ordering, numeric CVSS with missing scores
  last, and independent SBOM sorting.

Full suite: 80 tests passing, `tsc --noEmit` clean.

## Not done

`src/components/security.tsx` (the Vulnerabilities page: image totals, run history, audit)
keeps its current fixed ordering. The hook is generic enough to apply there later.
