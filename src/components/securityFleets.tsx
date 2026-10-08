import * as React from 'react';
import { useNotify } from 'react-admin';
import {
  Card, CardContent, CardActionArea, Typography, Box, Button, Chip,
  Select, MenuItem, Table, TableHead, TableBody, TableRow, TableCell,
  IconButton, Collapse, TextField, FormControlLabel, Switch,
} from '@mui/material';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { useSecurityApi } from '../lib/securityApi';
import {
  SEVERITY_ORDER, severityColor, severityRank, severityWeights, type Severity,
} from '../lib/severity';
import { zebraSx, flatRowsSx, stripeRowSx } from '../lib/tableStyles';
import { useSortableRows, SortableCell, type SortColumn } from '../lib/useSortableRows';

const CVE_COLUMNS: SortColumn<any>[] = [
  { key: 'id', label: 'CVE', value: (c) => c.id },
  // Rank then CVSS, so a severity sort orders the worst CVE of a tier first.
  { key: 'severity', label: 'Severity', defaultDir: 'desc',
    value: (c) => [severityRank(c.severity), Number(c.cvss) || 0] },
  { key: 'cvss', label: 'CVSS', defaultDir: 'desc', value: (c) => c.cvss },
  { key: 'package', label: 'Package', value: (c) => c.package },
  { key: 'version', label: 'Version', value: (c) => c.version },
  { key: 'fixed_version', label: 'Fixed', value: (c) => c.fixed_version },
  { key: 'first_seen', label: 'Detected', defaultDir: 'desc', value: (c) => c.first_seen },
];

const SBOM_COLUMNS: SortColumn<any>[] = [
  { key: 'name', label: 'Package', value: (p) => p.name },
  { key: 'version', label: 'Version', value: (p) => p.version },
  { key: 'type', label: 'Type', value: (p) => p.type },
  { key: 'license', label: 'License', value: (p) => p.license },
];

// Report kinds: gateway fleets and nightly builds (build system), firmware and apps (publish scripts).
const KIND_GROUPS: { kind: string; title: string; component: string; source: string }[] = [
  { kind: 'fleet', title: 'Gateway fleets', component: 'Service', source: 'Image' },
  { kind: 'nightly', title: 'Nightly builds', component: 'Service', source: 'Image' },
  { kind: 'firmware', title: 'Firmware', component: 'SBOM document', source: 'File' },
  { kind: 'app', title: 'Apps', component: 'App', source: 'SBOM' },
];
const kindOf = (r: any) => {
  const kind = r?.kind ?? 'fleet';
  return kind === 'fleet' && String(r?.fleet ?? '').startsWith('nightly_') ? 'nightly' : kind;
};
const groupFor = (kind: string) => KIND_GROUPS.find((g) => g.kind === kind) ?? KIND_GROUPS[0];

const containerColumns = (kind: string): SortColumn<any>[] => [
  { key: 'service', label: groupFor(kind).component, value: (c) => c.service },
  { key: 'image', label: groupFor(kind).source, value: (c) => c.image },
  { key: 'findings', label: 'Findings', defaultDir: 'desc',
    value: (c) => severityWeights(c.totals) },
];

const SEV_ABBR: Record<Severity, string> = {
  critical: 'C', high: 'H', medium: 'M', low: 'L', unknown: '?',
};

// Compact coloured severity counts, reused on overview cards and container rows.
const SevBadges: React.FC<{ totals: Record<string, number> }> = ({ totals }) => (
  <Box sx={{ display: 'flex', gap: 1 }}>
    {SEVERITY_ORDER.map((sev) => {
      const n = totals?.[sev] ?? 0;
      return (
        <Box
          key={sev}
          data-testid={`sev-${sev}`}
          sx={{ color: n > 0 ? severityColor(sev) : 'text.disabled', fontWeight: n > 0 ? 700 : 400 }}
        >
          {SEV_ABBR[sev]}{n}
        </Box>
      );
    })}
  </Box>
);

// Findings that appeared after the release was built (flagged by the nightly rescan).
const NewChip: React.FC<{ n?: number; label: string }> = ({ n, label }) =>
  n ? <Chip size="small" color="error" data-testid="new-chip" label={label} /> : null;

const rescanLabel = (r: any) => {
  if (r.rescanned_at) return `rescanned ${r.rescanned_at.slice(0, 16).replace('T', ' ')}`;
  return r.rescannable ? 'not rescanned yet' : 'not rescannable';
};

function saveBlob(data: Blob, filename: string) {
  // jsdom lacks a real download path; guard so tests don't throw.
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// First detection date; findings of the build-time scan carry the build date.
const detectedLabel = (firstSeen: string | undefined, buildDate: string) => {
  if (!firstSeen) return '';
  return firstSeen === buildDate ? `at build (${firstSeen})` : firstSeen;
};

const ContainerRow: React.FC<{
  fleet: string; release: string; container: any; index: number; buildDate: string;
}> = ({ fleet, release, container, index, buildDate }) => {
  const api = useSecurityApi();
  const notify = useNotify();
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [newOnly, setNewOnly] = React.useState(false);

  const packages = container.sbom?.packages ?? [];
  const shown = filter
    ? packages.filter((p: any) => `${p.name} ${p.version}`.toLowerCase().includes(filter.toLowerCase()))
    : packages;

  const cves = container.cves ?? [];
  const hasNew = cves.some((c: any) => c.new);
  const cveSort = useSortableRows<any>(newOnly ? cves.filter((c: any) => c.new) : cves,
    CVE_COLUMNS, 'severity');
  const sbomSort = useSortableRows<any>(shown, SBOM_COLUMNS, 'name'); // sorts the filtered set

  const download = async () => {
    try {
      const blob = await api.downloadFleetSbom(fleet, release, container.service);
      saveBlob(blob, `${container.service}.sbom.cdx.json`);
    } catch (e: any) {
      notify(`SBOM download failed: ${e?.message ?? e}`, { type: 'error' });
    }
  };

  return (
    <>
      <TableRow hover data-testid={`container-row-${container.service}`}
        sx={[{ cursor: 'pointer' }, stripeRowSx(index)]} onClick={() => setOpen((o) => !o)}>
        <TableCell>
          <IconButton size="small">{open ? <ExpandLess /> : <ExpandMore />}</IconButton>
        </TableCell>
        <TableCell>{container.service}</TableCell>
        <TableCell sx={{ color: 'text.secondary' }}>{container.image}</TableCell>
        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SevBadges totals={container.totals} />
            <NewChip n={container.new_cves} label={`+${container.new_cves} new`} />
          </Box>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={4} sx={{ py: 0, border: 0 }}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ my: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="subtitle2">Vulnerabilities</Typography>
                {hasNew && (
                  <FormControlLabel label="New only" control={
                    <Switch size="small" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} />
                  } />
                )}
              </Box>
              <Table size="small" sx={zebraSx}>
                <TableHead>
                  <TableRow>
                    {CVE_COLUMNS.map((col) => (
                      <SortableCell key={col.key} col={col} sort={cveSort} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {cveSort.sorted.length === 0 && (
                    <TableRow><TableCell colSpan={7}>No known vulnerabilities.</TableCell></TableRow>
                  )}
                  {cveSort.sorted.map((c: any, i: number) => (
                    <TableRow key={`${c.id}-${i}`}>
                      <TableCell>
                        {c.id}
                        {c.new && <Chip size="small" color="error" label="NEW" sx={{ ml: 1 }} />}
                      </TableCell>
                      <TableCell sx={{ color: severityColor(c.severity as Severity), fontWeight: 600 }}>
                        {c.severity}
                      </TableCell>
                      <TableCell>{c.cvss ?? ''}</TableCell>
                      <TableCell>{c.package}</TableCell>
                      <TableCell>{c.version}</TableCell>
                      <TableCell>{c.fixed_version}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{detectedLabel(c.first_seen, buildDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
                <Typography variant="subtitle2">SBOM — {packages.length} packages</Typography>
                <TextField size="small" placeholder="Search packages…" value={filter}
                  onChange={(e) => setFilter(e.target.value)} />
                <Button size="small" onClick={download}>Download SBOM</Button>
              </Box>
              <Table size="small" sx={zebraSx}>
                <TableHead>
                  <TableRow>
                    {SBOM_COLUMNS.map((col) => (
                      <SortableCell key={col.key} col={col} sort={sbomSort} />
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sbomSort.sorted.map((p: any, i: number) => (
                    <TableRow key={`${p.name}-${i}`}>
                      <TableCell>{p.name}</TableCell><TableCell>{p.version}</TableCell>
                      <TableCell>{p.type}</TableCell><TableCell>{p.license}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
};

export const FleetsPage: React.FC = () => {
  const api = useSecurityApi();
  const notify = useNotify();
  const [fleets, setFleets] = React.useState<any[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [releases, setReleases] = React.useState<any[]>([]);
  const [report, setReport] = React.useState<any>(null);
  const columns = React.useMemo(() => containerColumns(kindOf(report)), [report]);
  const containerSort = useSortableRows<any>(report?.containers ?? [], columns, 'findings');

  React.useEffect(() => {
    api.getFleets().then(setFleets).catch((e) =>
      notify(`Failed to load fleets: ${e?.message ?? e}`, { type: 'error' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFleet = async (fleet: string, release: string) => {
    setSelected(fleet);
    try {
      const [rels, rep] = await Promise.all([
        api.getFleetReleases(fleet),
        api.getFleetRelease(fleet, release),
      ]);
      setReleases(rels);
      setReport(rep);
    } catch (e: any) {
      notify(`Failed to load fleet report: ${e?.message ?? e}`, { type: 'error' });
    }
  };

  const rescan = async () => {
    try {
      await api.triggerFleetRescan();
      notify('Rescan started — reload the report once it has finished', { type: 'info' });
    } catch (e: any) {
      if (e?.response?.status === 409) {
        notify('A scan is already running — try again later', { type: 'warning' });
      } else {
        notify(`Rescan failed: ${e?.message ?? e}`, { type: 'error' });
      }
    }
  };

  const pickRelease = async (release: string) => {
    if (!selected) return;
    try {
      setReport(await api.getFleetRelease(selected, release));
    } catch (e: any) {
      notify(`Failed to load release: ${e?.message ?? e}`, { type: 'error' });
    }
  };

  if (selected && report) {
    return (
      <Box sx={{ p: 2 }}>
        <Button onClick={() => { setSelected(null); setReport(null); }}>&larr; All reports</Button>
        <Typography variant="h5" sx={{ mt: 1 }}>{report.fleet}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, my: 1 }}>
          <Typography>Release:</Typography>
          <Select size="small" value={report.release}
            onChange={(e) => pickRelease(String(e.target.value))}>
            {releases.map((r) => (
              <MenuItem key={r.release} value={r.release}>
                {r.new_cves ? `${r.release} (${r.new_cves} new)` : r.release}
              </MenuItem>
            ))}
          </Select>
          <Chip size="small" label={`branch: ${report.branch || '—'}`} />
          <Chip size="small" label={`${report.unique_cves} unique CVEs`} />
          <Chip size="small" variant="outlined" label={rescanLabel(report)} />
          <NewChip n={report.new_cves}
            label={`${report.new_cves} new since ${kindOf(report) === 'nightly' ? 'build' : 'release'}`} />
          <SevBadges totals={report.totals} />
          <Button size="small" variant="outlined" onClick={rescan}>Rescan now</Button>
        </Box>
        <Table size="small" sx={flatRowsSx}>
          <TableHead>
            <TableRow>
              <TableCell />
              {columns.map((col) => (
                <SortableCell key={col.key} col={col} sort={containerSort} />
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {containerSort.sorted.map((c: any, i: number) => (
              <ContainerRow key={c.service} index={i} fleet={report.fleet} release={report.release}
                container={c} buildDate={(report.generated_at || '').slice(0, 10)} />
            ))}
          </TableBody>
        </Table>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Security reports</Typography>
      {fleets.length === 0 && (
        <Typography color="text.secondary">No reports uploaded yet.</Typography>
      )}
      {KIND_GROUPS.map((g) => {
        const items = fleets.filter((f) => kindOf(f) === g.kind);
        if (items.length === 0) return null;
        return (
          <Box key={g.kind} data-testid={`group-${g.kind}`} sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>{g.title}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
              {items.map((f) => (
                <Card key={f.fleet}>
                  <CardActionArea data-testid={`fleet-card-${f.fleet}`}
                    onClick={() => openFleet(f.fleet, f.release)}>
                    <CardContent>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{f.fleet}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        rel {f.release} · built {(f.generated_at || '').slice(0, 10)}
                        {f.rescanned_at && ` · rescanned ${f.rescanned_at.slice(0, 10)}`}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <SevBadges totals={f.totals} />
                        <NewChip n={f.new_cves} label={`${f.new_cves} new`} />
                      </Box>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default { list: FleetsPage };
