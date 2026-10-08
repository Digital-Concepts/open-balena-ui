/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const api = {
  getFleets: vi.fn(),
  getFleetReleases: vi.fn(),
  getFleetRelease: vi.fn(),
  downloadFleetSbom: vi.fn(),
  triggerFleetRescan: vi.fn(),
};
vi.mock('../../lib/securityApi', () => ({ useSecurityApi: () => api }));
const notify = vi.fn();
vi.mock('react-admin', () => ({ useNotify: () => notify }));

import { FleetsPage } from '../securityFleets';

const FLEETS = [
  {
    fleet: 'release_OPUS_Pi3',
    release: '2.0.004',
    generated_at: '2026-07-24T10:00:00Z',
    totals: { critical: 0, high: 3, medium: 12, low: 40, unknown: 1 },
  },
  {
    fleet: 'release_Business_Pi4',
    release: '2.0.004',
    generated_at: '2026-07-24T10:00:00Z',
    totals: { critical: 1, high: 5, medium: 20, low: 55, unknown: 0 },
  },
];

const RELEASE = {
  fleet: 'release_OPUS_Pi3',
  release: '2.0.004',
  branch: 'master',
  generated_at: '2026-07-24T10:00:00Z',
  scanner: { tool: 'trivy', version: '0.50.1' },
  totals: { critical: 0, high: 3, medium: 12, low: 40, unknown: 1 },
  unique_cves: 44,
  containers: [
    {
      service: 'DC-Core-206',
      image: 'dc_core-206',
      digest: '',
      totals: { critical: 0, high: 1, medium: 4, low: 10, unknown: 0 },
      cves: [
        { id: 'CVE-2024-0001', severity: 'high', cvss: 7.5, package: 'openssl',
          version: '3.1.2', fixed_version: '3.1.4' },
      ],
      sbom: { format: 'cyclonedx', packages: [
        { name: 'openssl', version: '3.1.2', type: 'alpine', license: 'Apache-2.0' },
      ] },
    },
  ],
};

// Three containers whose alphabetical and severity orders disagree, each with
// several CVEs, so sorting can't accidentally pass on input order.
const MULTI = {
  ...RELEASE,
  containers: [
    {
      service: 'apache-svc', image: 'img-c', digest: '',
      totals: { critical: 0, high: 9, medium: 0, low: 0, unknown: 0 },
      cves: [
        { id: 'CVE-2024-0100', severity: 'low', cvss: 3.1, package: 'zlib',
          version: '1.0', fixed_version: '1.1' },
        { id: 'CVE-2024-0200', severity: 'critical', cvss: 9.8, package: 'bash',
          version: '5.0', fixed_version: '5.1' },
        { id: 'CVE-2024-0300', severity: 'high', cvss: null, package: 'curl',
          version: '8.0', fixed_version: '' },
      ],
      sbom: { format: 'cyclonedx', packages: [
        { name: 'zlib', version: '1.0', type: 'alpine', license: 'Zlib' },
        { name: 'bash', version: '5.0', type: 'alpine', license: 'GPL-3.0' },
      ] },
    },
    {
      service: 'zebra-svc', image: 'img-a', digest: '',
      totals: { critical: 2, high: 0, medium: 0, low: 0, unknown: 0 },
      cves: [], sbom: { format: 'cyclonedx', packages: [] },
    },
    {
      service: 'middle-svc', image: 'img-b', digest: '',
      totals: { critical: 0, high: 0, medium: 5, low: 0, unknown: 0 },
      cves: [], sbom: { format: 'cyclonedx', packages: [] },
    },
  ],
};

const openMulti = async () => {
  api.getFleetRelease.mockResolvedValue(MULTI);
  render(<FleetsPage />);
  fireEvent.click(await screen.findByTestId('fleet-card-release_OPUS_Pi3'));
  await screen.findByTestId('container-row-apache-svc');
};

/** Row order of the container table, by service name. */
const containerOrder = () =>
  screen.getAllByTestId(/^container-row-/).map((r) => r.getAttribute('data-testid')!.replace('container-row-', ''));

/** Cell text of the first column of a table's body rows. */
const firstColumn = (table: HTMLElement) =>
  within(table).getAllByRole('row').slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]?.textContent ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  api.getFleets.mockResolvedValue(FLEETS);
  api.getFleetReleases.mockResolvedValue([
    { release: '2.0.004', generated_at: '2026-07-24T10:00:00Z', totals: RELEASE.totals },
  ]);
  api.getFleetRelease.mockResolvedValue(RELEASE);
});

describe('FleetsPage overview', () => {
  it('renders a card per fleet with its latest release and severity totals', async () => {
    render(<FleetsPage />);
    const card = await screen.findByTestId('fleet-card-release_OPUS_Pi3');
    expect(within(card).getByText('release_OPUS_Pi3')).toBeInTheDocument();
    expect(within(card).getByText(/2\.0\.004/)).toBeInTheDocument();
    expect(within(card).getByTestId('sev-high')).toHaveTextContent('3');
    expect(within(card).getByTestId('sev-medium')).toHaveTextContent('12');
    expect(screen.getByTestId('fleet-card-release_Business_Pi4')).toBeInTheDocument();
  });
});

describe('FleetsPage drill-down', () => {
  it('loads the latest release and lists containers when a fleet is opened', async () => {
    render(<FleetsPage />);
    fireEvent.click(await screen.findByTestId('fleet-card-release_OPUS_Pi3'));
    expect(await screen.findByText('DC-Core-206')).toBeInTheDocument();
    expect(api.getFleetRelease).toHaveBeenCalledWith('release_OPUS_Pi3', '2.0.004');
  });

  it('sorts containers worst-first by default, and alphabetically on a Service click', async () => {
    await openMulti();
    expect(containerOrder()).toEqual(['zebra-svc', 'apache-svc', 'middle-svc']);

    fireEvent.click(screen.getByText('Service'));
    expect(containerOrder()).toEqual(['apache-svc', 'middle-svc', 'zebra-svc']);

    fireEvent.click(screen.getByText('Service'));
    expect(containerOrder()).toEqual(['zebra-svc', 'middle-svc', 'apache-svc']);
  });

  it('sorts CVEs by severity rank rather than alphabetically', async () => {
    await openMulti();
    fireEvent.click(screen.getByTestId('container-row-apache-svc'));
    const cveTable = (await screen.findAllByRole('table'))[1];
    // critical, high, low — alphabetical severity would give critical, high, low too,
    // so assert on the ids: rank order is 0200, 0300, 0100.
    expect(firstColumn(cveTable)).toEqual(['CVE-2024-0200', 'CVE-2024-0300', 'CVE-2024-0100']);

    fireEvent.click(within(cveTable).getByText('Severity'));
    expect(firstColumn(cveTable)).toEqual(['CVE-2024-0100', 'CVE-2024-0300', 'CVE-2024-0200']);
  });

  it('sorts CVSS numerically and keeps missing scores last in both directions', async () => {
    await openMulti();
    fireEvent.click(screen.getByTestId('container-row-apache-svc'));
    const cveTable = (await screen.findAllByRole('table'))[1];

    fireEvent.click(within(cveTable).getByText('CVSS')); // defaults to desc
    expect(firstColumn(cveTable)).toEqual(['CVE-2024-0200', 'CVE-2024-0100', 'CVE-2024-0300']);

    fireEvent.click(within(cveTable).getByText('CVSS'));
    expect(firstColumn(cveTable)).toEqual(['CVE-2024-0100', 'CVE-2024-0200', 'CVE-2024-0300']);
  });

  it('sorts SBOM packages by name, independently of the CVE table', async () => {
    await openMulti();
    fireEvent.click(screen.getByTestId('container-row-apache-svc'));
    const sbomTable = (await screen.findAllByRole('table'))[2];
    expect(firstColumn(sbomTable)).toEqual(['bash', 'zlib']);

    fireEvent.click(within(sbomTable).getByText('Package'));
    expect(firstColumn(sbomTable)).toEqual(['zlib', 'bash']);
  });

  it('expands a container to show its CVEs and SBOM packages', async () => {
    render(<FleetsPage />);
    fireEvent.click(await screen.findByTestId('fleet-card-release_OPUS_Pi3'));
    fireEvent.click(await screen.findByTestId('container-row-DC-Core-206'));
    expect(await screen.findByText('CVE-2024-0001')).toBeInTheDocument();
    expect(screen.getByText('3.1.4')).toBeInTheDocument();       // CVE fixed version
    expect(screen.getByText('Apache-2.0')).toBeInTheDocument();  // SBOM-only: license column
    // openssl shows in both the CVE row and the SBOM package list
    expect(screen.getAllByText(/openssl/).length).toBeGreaterThanOrEqual(2);
  });
});

// A rescanned release: one known finding and two that appeared after the build.
const RESCANNED = {
  ...RELEASE,
  rescannable: true,
  rescanned_at: '2026-09-24T04:00:12Z',
  new_cves: 2,
  containers: [{
    ...RELEASE.containers[0],
    new_cves: 2,
    cves: [
      { id: 'CVE-2024-0001', severity: 'high', cvss: 7.5, package: 'openssl',
        version: '3.1.2', fixed_version: '3.1.4', new: false },
      { id: 'CVE-2026-1111', severity: 'critical', cvss: 9.1, package: 'openssl',
        version: '3.1.2', fixed_version: '3.1.9', new: true },
      { id: 'CVE-2026-2222', severity: 'low', cvss: 2.0, package: 'musl',
        version: '1.2', fixed_version: '', new: true },
    ],
  }],
};

const openRelease = async (rep: any) => {
  api.getFleetRelease.mockResolvedValue(rep);
  render(<FleetsPage />);
  fireEvent.click(await screen.findByTestId('fleet-card-release_OPUS_Pi3'));
  await screen.findByTestId('container-row-DC-Core-206');
};

describe('FleetsPage rescan', () => {
  it('shows rescan date and new count on the fleet card', async () => {
    api.getFleets.mockResolvedValue([
      { ...FLEETS[0], rescanned_at: '2026-09-24T04:00:12Z', new_cves: 2 },
      FLEETS[1],
    ]);
    render(<FleetsPage />);
    const card = await screen.findByTestId('fleet-card-release_OPUS_Pi3');
    expect(within(card).getByText(/rescanned 2026-09-24/)).toBeInTheDocument();
    expect(within(card).getByTestId('new-chip')).toHaveTextContent('2 new');
    const other = screen.getByTestId('fleet-card-release_Business_Pi4');
    expect(within(other).queryByTestId('new-chip')).toBeNull();
  });

  it('shows rescan status and new-since-release in the detail header', async () => {
    await openRelease(RESCANNED);
    expect(screen.getByText(/rescanned 2026-09-24 04:00/)).toBeInTheDocument();
    expect(screen.getByText('2 new since release')).toBeInTheDocument();
  });

  it('marks releases that were never rescanned or cannot be', async () => {
    await openRelease({ ...RELEASE, rescannable: false });
    expect(screen.getByText('not rescannable')).toBeInTheDocument();
  });

  it('marks a rescannable release that has not been rescanned yet', async () => {
    await openRelease({ ...RELEASE, rescannable: true });
    expect(screen.getByText('not rescanned yet')).toBeInTheDocument();
  });

  it('shows a +N new chip on the container row', async () => {
    await openRelease(RESCANNED);
    const row = screen.getByTestId('container-row-DC-Core-206');
    expect(within(row).getByText('+2 new')).toBeInTheDocument();
  });

  it('flags new CVEs and filters to them with the New only toggle', async () => {
    await openRelease(RESCANNED);
    fireEvent.click(screen.getByTestId('container-row-DC-Core-206'));
    const cveTable = (await screen.findAllByRole('table'))[1];
    expect(within(cveTable).getAllByText('NEW')).toHaveLength(2);
    expect(within(cveTable).getAllByRole('row')).toHaveLength(4); // header + 3

    fireEvent.click(screen.getByLabelText('New only'));
    const ids = within(cveTable).getAllByRole('row').slice(1)
      .map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(ids).toEqual(['CVE-2026-1111NEW', 'CVE-2026-2222NEW']);
  });

  it('labels releases with their new count in the dropdown', async () => {
    api.getFleetReleases.mockResolvedValue([
      { release: '2.0.004', generated_at: '2026-07-24T10:00:00Z', totals: RELEASE.totals, new_cves: 2 },
    ]);
    await openRelease(RESCANNED);
    expect(screen.getByText('2.0.004 (2 new)')).toBeInTheDocument();
  });

  it('triggers a rescan and reports a running scan', async () => {
    api.triggerFleetRescan.mockResolvedValueOnce({ status: 'started' });
    await openRelease(RESCANNED);
    fireEvent.click(screen.getByText('Rescan now'));
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/Rescan started/), expect.anything()));

    api.triggerFleetRescan.mockRejectedValueOnce({ response: { status: 409 } });
    fireEvent.click(screen.getByText('Rescan now'));
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/already running/), expect.objectContaining({ type: 'warning' })));
  });
});

describe('FleetsPage grouping', () => {
  it('groups cards into gateway fleets, firmware and apps', async () => {
    api.getFleets.mockResolvedValue([
      FLEETS[0],
      { ...FLEETS[1], fleet: 'firmware_reg_v2', kind: 'firmware', release: '2.26.08.04' },
      { ...FLEETS[1], fleet: 'app_myopus-ios', kind: 'app', release: '2.0.3' },
    ]);
    render(<FleetsPage />);
    const fw = await screen.findByTestId('group-firmware');
    expect(within(fw).getByTestId('fleet-card-firmware_reg_v2')).toBeInTheDocument();
    expect(within(screen.getByTestId('group-app')).getByTestId('fleet-card-app_myopus-ios'))
      .toBeInTheDocument();
    expect(within(screen.getByTestId('group-fleet')).getByTestId('fleet-card-release_OPUS_Pi3'))
      .toBeInTheDocument();
    expect(screen.getByText('Firmware')).toBeInTheDocument();
  });

  it('puts nightly build fleets in their own group after gateway fleets', async () => {
    api.getFleets.mockResolvedValue([
      FLEETS[0],
      { ...FLEETS[1], fleet: 'nightly_OPUS_Pi4' },
      { ...FLEETS[1], fleet: 'firmware_reg_v2', kind: 'firmware', release: '2.26.08.04' },
    ]);
    render(<FleetsPage />);
    const nightly = await screen.findByTestId('group-nightly');
    expect(within(nightly).getByTestId('fleet-card-nightly_OPUS_Pi4')).toBeInTheDocument();
    expect(within(screen.getByTestId('group-fleet')).queryByTestId('fleet-card-nightly_OPUS_Pi4'))
      .toBeNull();
    expect(screen.getByText('Nightly builds')).toBeInTheDocument();
    const order = screen.getAllByTestId(/^group-/).map((g) => g.dataset.testid);
    expect(order).toEqual(['group-fleet', 'group-nightly', 'group-firmware']);
  });

  it('says new since build in a nightly report header', async () => {
    api.getFleets.mockResolvedValue([{ ...FLEETS[0], fleet: 'nightly_OPUS_Pi3' }]);
    api.getFleetRelease.mockResolvedValue({ ...RESCANNED, fleet: 'nightly_OPUS_Pi3' });
    render(<FleetsPage />);
    fireEvent.click(await screen.findByTestId('fleet-card-nightly_OPUS_Pi3'));
    await screen.findByTestId('container-row-DC-Core-206');
    expect(screen.getByText('2 new since build')).toBeInTheDocument();
  });

  it('hides empty groups', async () => {
    render(<FleetsPage />);
    await screen.findByTestId('group-fleet');
    expect(screen.queryByTestId('group-firmware')).toBeNull();
    expect(screen.queryByTestId('group-app')).toBeNull();
  });

  it('labels the component column per kind', async () => {
    api.getFleetRelease.mockResolvedValue({ ...RELEASE, kind: 'firmware' });
    render(<FleetsPage />);
    fireEvent.click(await screen.findByTestId('fleet-card-release_OPUS_Pi3'));
    await screen.findByTestId('container-row-DC-Core-206');
    expect(screen.getByText('SBOM document')).toBeInTheDocument();
  });
});

describe('FleetsPage detected column', () => {
  const DATED = {
    ...RESCANNED,
    generated_at: '2026-09-23T10:00:00Z',
    containers: [{
      ...RESCANNED.containers[0],
      cves: [
        { ...RESCANNED.containers[0].cves[0], first_seen: '2026-09-23' },
        { ...RESCANNED.containers[0].cves[1], first_seen: '2026-10-02' },
        { ...RESCANNED.containers[0].cves[2], first_seen: '2026-09-28' },
      ],
    }],
  };

  it('shows when each finding was first detected, marking build-time ones', async () => {
    await openRelease(DATED);
    fireEvent.click(screen.getByTestId('container-row-DC-Core-206'));
    const cveTable = (await screen.findAllByRole('table'))[1];
    expect(within(cveTable).getByText('Detected')).toBeInTheDocument();
    expect(within(cveTable).getByText('at build (2026-09-23)')).toBeInTheDocument();
    expect(within(cveTable).getByText('2026-10-02')).toBeInTheDocument();
  });

  it('sorts newest detection first', async () => {
    await openRelease(DATED);
    fireEvent.click(screen.getByTestId('container-row-DC-Core-206'));
    const cveTable = (await screen.findAllByRole('table'))[1];
    fireEvent.click(within(cveTable).getByText('Detected'));
    expect(firstColumn(cveTable)).toEqual(['CVE-2026-1111NEW', 'CVE-2026-2222NEW', 'CVE-2024-0001']);
  });
});
