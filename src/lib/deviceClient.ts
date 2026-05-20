import * as React from 'react';
import { useDataProvider, useGetList } from 'react-admin';

export const CLIENT_TAG_KEY = 'client';

/**
 * Hook: returns the current `client` tag value for a single device,
 * along with the tag row id (needed for PATCH/DELETE on save).
 */
export function useDeviceClientTag(deviceId: number | string | undefined) {
  const { data, isLoading, refetch } = useGetList(
    'device tag',
    {
      filter: { device: deviceId, 'tag key': CLIENT_TAG_KEY },
      pagination: { page: 1, perPage: 1 },
      sort: { field: 'id', order: 'ASC' },
    },
    { enabled: deviceId !== undefined && deviceId !== null },
  );
  const row = data?.[0];
  return {
    tagId: row?.id as number | undefined,
    value: (row?.value as string | undefined) ?? '',
    isLoading,
    refetch,
  };
}

/**
 * Hook: returns the sorted, deduplicated list of every `client` tag value
 * currently in use across all devices. Used to populate the autocomplete
 * options and the column-header filter dropdown.
 */
export function useDistinctClientValues() {
  const { data, isLoading, error, refetch } = useGetList('device tag', {
    filter: { 'tag key': CLIENT_TAG_KEY },
    pagination: { page: 1, perPage: 10000 },
    sort: { field: 'value', order: 'ASC' },
  });
  const values = React.useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((row: any) => {
      const v = (row?.value ?? '').toString().trim();
      if (v.length > 0) set.add(v);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data]);
  return { values, isLoading, error, refetch };
}

/**
 * Hook factory: returns an upsert function that POST/PATCH/DELETE-es
 * the `client` tag for a given device based on the new desired value.
 *
 *   undefined / '' / null  → delete the existing tag (if any)
 *   non-empty string       → create or update the tag to that value
 */
export function useUpsertDeviceClient() {
  const dataProvider = useDataProvider();
  return async (
    deviceId: number | string,
    newValue: string | undefined | null,
  ): Promise<void> => {
    const trimmed = (newValue ?? '').toString().trim();
    const existing = await dataProvider.getList('device tag', {
      filter: { device: deviceId, 'tag key': CLIENT_TAG_KEY },
      pagination: { page: 1, perPage: 1 },
      sort: { field: 'id', order: 'ASC' },
    });
    const existingRow = existing.data?.[0];

    if (trimmed === '') {
      if (existingRow) {
        await dataProvider.delete('device tag', { id: existingRow.id });
      }
      return;
    }

    if (!existingRow) {
      await dataProvider.create('device tag', {
        data: { device: deviceId, 'tag key': CLIENT_TAG_KEY, value: trimmed },
      });
      return;
    }

    if (existingRow.value !== trimmed) {
      await dataProvider.update('device tag', {
        id: existingRow.id,
        data: { value: trimmed },
        previousData: existingRow,
      });
    }
  };
}
