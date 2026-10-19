import { describe, it, expect, vi } from 'vitest';
import { organizationDeleteGuard, mapForeignKeyError } from '../organizationDeleteGuard';

const setup = (opts: { fleets?: Record<number, string[]>; members?: Record<number, number[]>; deleteErr?: unknown } = {}) => {
  const inner: any = {
    getOne: vi.fn(async (_r: string, { id }: any) => ({ data: { id, name: id === 3 ? 'Test Kunde' : `Org ${id}` } })),
    getList: vi.fn(async (resource: string, p: any) => {
      if (resource === 'application') return { data: (opts.fleets?.[p.filter.organization] ?? []).map((n, i) => ({ id: i, 'app name': n })), total: 0 };
      return { data: (opts.members?.[p.filter['is member of-organization']] ?? []).map((u, i) => ({ id: i, user: u })), total: 0 };
    }),
    getMany: vi.fn(async (_r: string, { ids }: any) => ({ data: ids.map((id: number) => ({ id, username: `test${id}` })) })),
    delete: vi.fn(async () => {
      if (opts.deleteErr) throw opts.deleteErr;
      return { data: { id: 3 } };
    }),
    deleteMany: vi.fn(async () => {
      if (opts.deleteErr) throw opts.deleteErr;
      return { data: [3] };
    }),
  };
  return { inner, dp: organizationDeleteGuard(inner) };
};

describe('organizationDeleteGuard', () => {
  it('blocks delete and lists fleets and members', async () => {
    const { inner, dp } = setup({ fleets: { 3: ['gorgon', 'leviathan'] }, members: { 3: [2] } });
    await expect(dp.delete('organization', { id: 3 })).rejects.toThrow(
      'Cannot delete "Test Kunde": it still owns fleets gorgon, leviathan and has members test2. Move the fleets to another org and remove the members first.',
    );
    expect(inner.delete).not.toHaveBeenCalled();
  });
  it('blocks deleteMany entirely when one org is blocked', async () => {
    const { inner, dp } = setup({ members: { 4: [7] } });
    await expect(dp.deleteMany('organization', { ids: [3, 4] })).rejects.toThrow(
      'Cannot delete "Org 4": it still has members test7. Remove the members first.',
    );
    expect(inner.deleteMany).not.toHaveBeenCalled();
  });
  it('truncates long lists', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `f${i}`);
    const { dp } = setup({ fleets: { 3: names } });
    await expect(dp.delete('organization', { id: 3 })).rejects.toThrow('f9 and 2 more');
  });
  it('sends DELETE for unblocked orgs', async () => {
    const { inner, dp } = setup();
    await dp.delete('organization', { id: 3 });
    await dp.deleteMany('organization', { ids: [3, 4] });
    expect(inner.delete).toHaveBeenCalledTimes(1);
    expect(inner.deleteMany).toHaveBeenCalledTimes(1);
  });
  it('does not check other resources', async () => {
    const { inner, dp } = setup({ fleets: { 3: ['x'] } });
    await dp.delete('user', { id: 3 });
    expect(inner.getList).not.toHaveBeenCalled();
    expect(inner.delete).toHaveBeenCalled();
  });
  it('maps 23503 from the DELETE', async () => {
    const err = Object.assign(new Error('update or delete on table ...'), {
      body: { code: '23503', details: 'Key (id)=(3) is still referenced from table "application".' },
    });
    const { dp } = setup({ deleteErr: err });
    await expect(dp.delete('organization', { id: 3 })).rejects.toThrow('Cannot delete: still referenced by application; remove those first.');
  });
  it('passes other errors through', () => {
    const e = new Error('boom');
    expect(mapForeignKeyError(e)).toBe(e);
  });
});
