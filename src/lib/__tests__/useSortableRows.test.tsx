import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSortableRows, type SortColumn } from '../useSortableRows';

type Row = { name: string; n: number | null; tuple: number[] };

const ROWS: Row[] = [
  { name: 'beta', n: 7.5, tuple: [0, 1] },
  { name: 'alpha', n: null, tuple: [1, 0] },
  { name: 'gamma', n: 2, tuple: [0, 5] },
];

const COLUMNS: SortColumn<Row>[] = [
  { key: 'name', label: 'Name', value: (r) => r.name },
  { key: 'n', label: 'N', defaultDir: 'desc', value: (r) => r.n },
  { key: 'tuple', label: 'Tuple', defaultDir: 'desc', value: (r) => r.tuple },
];

const names = (rows: Row[]) => rows.map((r) => r.name);

describe('useSortableRows', () => {
  it('returns rows untouched when no initial column is given', () => {
    const { result } = renderHook(() => useSortableRows(ROWS, COLUMNS));
    expect(names(result.current.sorted)).toEqual(['beta', 'alpha', 'gamma']);
    expect(result.current.sortKey).toBeNull();
  });

  it('applies the initial column with its default direction', () => {
    const { result } = renderHook(() => useSortableRows(ROWS, COLUMNS, 'name'));
    expect(result.current.sortDir).toBe('asc');
    expect(names(result.current.sorted)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('toggles direction when the active column is clicked again', () => {
    const { result } = renderHook(() => useSortableRows(ROWS, COLUMNS, 'name'));
    act(() => result.current.toggle('name'));
    expect(result.current.sortDir).toBe('desc');
    expect(names(result.current.sorted)).toEqual(['gamma', 'beta', 'alpha']);
    act(() => result.current.toggle('name'));
    expect(result.current.sortDir).toBe('asc');
  });

  it("starts a newly selected column at that column's default direction", () => {
    const { result } = renderHook(() => useSortableRows(ROWS, COLUMNS, 'name'));
    act(() => result.current.toggle('n'));
    expect(result.current.sortDir).toBe('desc');
  });

  it('sorts numbers numerically and keeps blanks last in both directions', () => {
    const { result } = renderHook(() => useSortableRows(ROWS, COLUMNS, 'n'));
    expect(names(result.current.sorted)).toEqual(['beta', 'gamma', 'alpha']);
    act(() => result.current.toggle('n'));
    expect(names(result.current.sorted)).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('compares array values element-wise', () => {
    const { result } = renderHook(() => useSortableRows(ROWS, COLUMNS, 'tuple'));
    expect(names(result.current.sorted)).toEqual(['alpha', 'gamma', 'beta']);
  });

  it('sorts equal values stably, preserving input order', () => {
    const dupes: Row[] = [
      { name: 'first', n: 1, tuple: [] },
      { name: 'second', n: 1, tuple: [] },
      { name: 'third', n: 1, tuple: [] },
    ];
    const { result } = renderHook(() => useSortableRows(dupes, COLUMNS, 'n'));
    expect(names(result.current.sorted)).toEqual(['first', 'second', 'third']);
  });
});
