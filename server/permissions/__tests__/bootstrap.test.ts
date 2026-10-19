// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { openStore } from '../store';
import { bootstrapPermissions } from '../bootstrap';

const users = (...names: string[]) => async () => names.map((username, i) => ({ id: i + 1, username }));

describe('bootstrapPermissions', () => {
  it('seeds Admin + Customer Standard and assigns Admin to listed bootstrap admins once', async () => {
    const store = openStore(':memory:');
    await bootstrapPermissions(store, users('admin', 'boss'), ['admin', 'boss']);
    const sets = store.listSets();
    expect(sets.map((s) => s.name)).toEqual(['Admin', 'Customer Standard']);
    expect(sets[0].builtin).toBe(true);
    expect(sets[1].capabilities).not.toContain('device.tags.delete');
    expect(store.getUserSet(1)?.name).toBe('Admin');
    expect(store.getUserSet(2)?.name).toBe('Admin');

    await bootstrapPermissions(store, users('admin', 'boss', 'new'), ['admin']);
    expect(store.listSets()).toHaveLength(2);
    expect(store.getUserSet(3)).toBeUndefined();
  });

  it('promotes only allowlisted users; everyone else gets no set', async () => {
    const store = openStore(':memory:');
    await bootstrapPermissions(store, users('admin', 'kunde'), ['admin']);
    expect(store.getUserSet(1)?.name).toBe('Admin');
    expect(store.getUserSet(2)).toBeUndefined();
  });

  it('refuses to seed when the allowlist is empty', async () => {
    const store = openStore(':memory:');
    await expect(bootstrapPermissions(store, users('admin'), [])).rejects.toThrow(
      'ADMIN_UI_BOOTSTRAP_ADMINS is not set; refusing to seed',
    );
    expect(store.isSeeded()).toBe(false);
    expect(store.listSets()).toEqual([]);
  });

  it('refuses to seed when no allowlisted name exists in openBalena', async () => {
    const store = openStore(':memory:');
    await expect(bootstrapPermissions(store, users('kunde'), ['ghost'])).rejects.toThrow(
      'None of ADMIN_UI_BOOTSTRAP_ADMINS exist in openBalena; refusing to seed',
    );
    expect(store.isSeeded()).toBe(false);
    expect(store.listSets()).toEqual([]);
  });

  it('refuses to seed when no users are listed', async () => {
    const store = openStore(':memory:');
    await expect(bootstrapPermissions(store, users(), ['admin'])).rejects.toThrow(
      'No openBalena users found; refusing to seed without an admin',
    );
    expect(store.isSeeded()).toBe(false);
    expect(store.listSets()).toEqual([]);
  });

  it('leaves the store unseeded when listing users fails', async () => {
    const store = openStore(':memory:');
    await expect(
      bootstrapPermissions(
        store,
        async () => {
          throw new Error('api down');
        },
        ['admin'],
      ),
    ).rejects.toThrow('api down');
    expect(store.isSeeded()).toBe(false);
    expect(store.listSets()).toEqual([]);
  });
});
