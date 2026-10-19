import type { Identifier } from 'react-admin';

export interface FleetOwnership {
  id: Identifier;
  organization?: Identifier | null;
}

export interface FleetSelectionDiff {
  added: Identifier[];
  removed: Identifier[];
  foreign: { id: Identifier; organization: Identifier }[];
}

const same = (a: Identifier | null | undefined, b: Identifier | null | undefined) =>
  a != null && b != null && String(a) === String(b);

// Compares the selected fleets with the org's current fleets.
// added: selected fleets not yet in the org; removed: org fleets no longer selected;
// foreign: the added fleets that currently belong to another org.
export const diffFleetSelection = (
  fleets: FleetOwnership[],
  selected: Identifier[],
  orgId: Identifier,
): FleetSelectionDiff => {
  const selectedSet = new Set(selected.map(String));
  const added: Identifier[] = [];
  const removed: Identifier[] = [];
  const foreign: FleetSelectionDiff['foreign'] = [];
  for (const fleet of fleets) {
    const isSelected = selectedSet.has(String(fleet.id));
    const inOrg = same(fleet.organization, orgId);
    if (isSelected && !inOrg) {
      added.push(fleet.id);
      if (fleet.organization != null) foreign.push({ id: fleet.id, organization: fleet.organization });
    } else if (!isSelected && inOrg) {
      removed.push(fleet.id);
    }
  }
  return { added, removed, foreign };
};
