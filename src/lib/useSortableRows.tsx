import * as React from 'react';
import { TableCell, TableSortLabel } from '@mui/material';

export type SortDir = 'asc' | 'desc';

/** A comparable cell value. Arrays compare element-wise, for multi-key columns. */
export type SortValue = string | number | null | undefined | number[];

export interface SortColumn<T> {
  key: string;
  label: string;
  value: (row: T) => SortValue;
  /** Direction applied when this column is first selected. Defaults to 'asc'. */
  defaultDir?: SortDir;
  align?: 'left' | 'right' | 'center';
}

const isBlank = (v: SortValue): boolean =>
  v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

function compareValues(a: SortValue, b: SortValue): number {
  if (Array.isArray(a) || Array.isArray(b)) {
    const xa = Array.isArray(a) ? a : [Number(a) || 0];
    const xb = Array.isArray(b) ? b : [Number(b) || 0];
    for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
      const d = (xa[i] ?? 0) - (xb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export interface Sortable<T> {
  sorted: T[];
  sortKey: string | null;
  sortDir: SortDir;
  toggle: (key: string) => void;
}

/**
 * Sort rows by a declared column set. Blank values always sort last, in both
 * directions. Sorting is stable, so unsorted order breaks remaining ties.
 */
export function useSortableRows<T>(
  rows: T[],
  columns: SortColumn<T>[],
  initialKey?: string,
): Sortable<T> {
  const initial = columns.find((c) => c.key === initialKey);
  const [sortKey, setSortKey] = React.useState<string | null>(initial?.key ?? null);
  const [sortDir, setSortDir] = React.useState<SortDir>(initial?.defaultDir ?? 'asc');

  // Columns are declared inline by callers, so a new array arrives every render;
  // hold them in a ref to keep the memo keyed on the sort state alone.
  const colsRef = React.useRef(columns);
  colsRef.current = columns;

  const toggle = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(colsRef.current.find((c) => c.key === key)?.defaultDir ?? 'asc');
    }
  };

  const sorted = React.useMemo(() => {
    const col = colsRef.current.find((c) => c.key === sortKey);
    if (!col) return rows;
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((ra, rb) => {
      const a = col.value(ra);
      const b = col.value(rb);
      const ba = isBlank(a);
      const bb = isBlank(b);
      if (ba || bb) return ba && bb ? 0 : ba ? 1 : -1; // blanks last, direction-independent
      return sign * compareValues(a, b);
    });
  }, [rows, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggle };
}

/** Header cell wired to a `useSortableRows` result. */
export function SortableCell<T>({ col, sort }: { col: SortColumn<T>; sort: Sortable<T> }) {
  const active = sort.sortKey === col.key;
  return (
    <TableCell
      align={col.align}
      sortDirection={active ? sort.sortDir : false}
      aria-sort={active ? (sort.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <TableSortLabel
        active={active}
        direction={active ? sort.sortDir : col.defaultDir ?? 'asc'}
        onClick={() => sort.toggle(col.key)}
      >
        {col.label}
      </TableSortLabel>
    </TableCell>
  );
}
