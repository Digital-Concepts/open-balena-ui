import React from 'react';

// True once a query has data fetched after mount (or after `resetKey` changed); cached data from an earlier visit is not fresh.
export function useFreshSince(resetKey: unknown, dataUpdatedAt: number, isLoading: boolean): boolean {
  const mountedAtRef = React.useRef(Date.now());
  const keyRef = React.useRef(resetKey);
  if (keyRef.current !== resetKey) {
    keyRef.current = resetKey;
    mountedAtRef.current = Date.now();
  }
  return !isLoading && dataUpdatedAt >= mountedAtRef.current;
}
