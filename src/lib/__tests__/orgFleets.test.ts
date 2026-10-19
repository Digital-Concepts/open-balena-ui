import { describe, it, expect } from 'vitest';
import { diffFleetSelection } from '../orgFleets';

const fleets = [
  { id: 1, organization: 10 },
  { id: 2, organization: 10 },
  { id: 3, organization: 20 },
  { id: 4, organization: null },
];

describe('diffFleetSelection', () => {
  it('no change yields an empty diff', () => {
    expect(diffFleetSelection(fleets, [1, 2], 10)).toEqual({ added: [], removed: [], foreign: [] });
  });

  it('detects added fleets and flags those owned by another org', () => {
    const d = diffFleetSelection(fleets, [1, 2, 3, 4], 10);
    expect(d.added).toEqual([3, 4]);
    expect(d.foreign).toEqual([{ id: 3, organization: 20 }]);
    expect(d.removed).toEqual([]);
  });

  it('detects removed fleets', () => {
    expect(diffFleetSelection(fleets, [1], 10).removed).toEqual([2]);
  });

  it('compares ids across string and number types', () => {
    expect(diffFleetSelection(fleets, ['1', '2'], '10')).toEqual({ added: [], removed: [], foreign: [] });
  });
});
