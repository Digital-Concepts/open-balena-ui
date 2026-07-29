/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const api = {
  getFleets: vi.fn(),
  getFleetReleases: vi.fn(),
  getFleetRelease: vi.fn(),
  downloadFleetSbom: vi.fn(),
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
