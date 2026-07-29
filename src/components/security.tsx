import * as React from 'react';
import { useNotify } from 'react-admin';
import {
  Card, CardContent, Typography, TextField, Button, Chip, Box,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Table, TableHead, TableBody, TableRow, TableCell, IconButton, Collapse,
} from '@mui/material';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { useSecurityApi } from '../lib/securityApi';
import { severityColor, type Severity } from '../lib/severity';
import { zebraSx } from '../lib/tableStyles';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unknown'] as const;
const SEV_COLOR: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error', high: 'error', medium: 'warning', low: 'info', unknown: 'default',
};

// Colour a count cell by its severity when non-zero; muted/inherit at zero.
const countSx = (sev: Severity, n: number) =>
  n > 0 ? { color: severityColor(sev), fontWeight: 600 } : { color: 'text.disabled' };

const sbomName = (sbomFile: string) => sbomFile.replace(/\.sbom\.cdx\.json$/, '');

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

export const SecurityPage: React.FC = () => {
  const api = useSecurityApi();
  const notify = useNotify();
  const [status, setStatus] = React.useState<any>(null);
  const [latest, setLatest] = React.useState<any>(null);
  const [runs, setRuns] = React.useState<any[]>([]);
  const [audit, setAudit] = React.useState<any[]>([]);
  const [cfg, setCfg] = React.useState<any>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);
  const [logText, setLogText] = React.useState('');
  const [auditOpen, setAuditOpen] = React.useState(true);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    let active = true;
    const loadStatus = () => api.getStatus().then((s: any) => { if (active) setStatus(s); }).catch(() => {});
    loadStatus();
    const t = setInterval(loadStatus, 10000);
    api.getLatest().then((l: any) => { if (active) setLatest(l); }).catch(() => {});
    api.getRuns().then((r: any) => { if (active) setRuns(r); }).catch(() => {});
    api.getAudit({}).then((a: any) => { if (active) setAudit(a); }).catch(() => {});
    api.getConfig().then((c: any) => { if (active) setCfg(c); }).catch(() => {});
    return () => {
      active = false;
      clearInterval(t);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirmRun = async () => {
    setConfirmOpen(false);
    setRunning(true);
    try {
      const { run_id } = await api.triggerRun();
      const deadline = Date.now() + 30 * 60 * 1000;
      pollRef.current = setInterval(async () => {
        try {
          const s: any = await api.getStatus();
          setStatus(s);
          if (s.status !== 'running' && s.last_run?.id === run_id) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setRunning(false);
            api.getLatest().then(setLatest).catch(() => {});
            api.getRuns().then(setRuns).catch(() => {});
            notify(`Scan ${s.last_run.result}`, { type: s.last_run.result === 'success' ? 'success' : 'warning' });
          } else if (Date.now() >= deadline) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setRunning(false);
            notify('Scan still in progress — check Run history', { type: 'info' });
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setRunning(false);
        }
      }, 3000);
    } catch (e: any) {
      if (e?.response?.status === 409) {
        notify(e.response.data.error, { type: 'warning' });
      } else {
        notify('Scan failed', { type: 'error' });
      }
      setRunning(false);
    }
  };

  const handleRowClick = async (id: string) => {
    try {
      const text = await api.getRunLog(id);
      setLogText(text);
      setLogOpen(true);
    } catch {
      notify('Failed to load run log', { type: 'error' });
    }
  };

  const handleSbom = async (runId: string, name: string) => {
    try {
      const blob = await api.downloadSbom(runId, name);
      saveBlob(blob, `${name}.sbom.cdx.json`);
    } catch {
      notify('Failed to download SBOM', { type: 'error' });
    }
  };

  const saveConfig = async () => {
    try {
      await api.putConfig({ schedule: cfg.schedule, history_cap: Number(cfg.history_cap) });
      notify('Config saved', { type: 'success' });
    } catch (e: any) {
      const msg = e?.response?.data?.errors?.join('; ') || 'Failed to save config';
      notify(msg, { type: 'error' });
    }
  };

  const totals = latest?.totals || {};
  const images: any[] = [...(latest?.images || [])].sort((a, b) => a.image.localeCompare(b.image));

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Card>
        <CardContent>
          <Typography variant="h6">Security scan</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
            <Chip label={status?.status ?? '…'} color={status?.status === 'running' ? 'warning' : 'default'} />
            <Typography variant="body2">
              Next scheduled: {status?.next_scheduled_at || '—'}
            </Typography>
            <Button variant="contained" disabled={running || status?.status === 'running'}
              onClick={() => setConfirmOpen(true)}>
              Run scan now
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle1">
            Latest run {latest?.id ? `(${latest.id})` : ''}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            {SEVERITIES.map((sev) => (
              <Chip key={sev} data-testid={`sev-${sev}`} color={SEV_COLOR[sev]}
                label={`${sev}: ${totals[sev] ?? 0}`} />
            ))}
          </Box>
          <Table size="small" sx={[{ mt: 2 }, zebraSx]}>
            <TableHead>
              <TableRow>
                <TableCell>Image</TableCell>
                <TableCell align="right">Critical</TableCell>
                <TableCell align="right">High</TableCell>
                <TableCell align="right">Medium</TableCell>
                <TableCell align="right">Low</TableCell>
                <TableCell>SBOM</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {images.map((img) => (
                <TableRow key={img.image}>
                  <TableCell data-testid="image-cell">{img.image}</TableCell>
                  <TableCell align="right" sx={countSx('critical', img.totals?.critical ?? 0)}>
                    {img.totals?.critical ?? 0}</TableCell>
                  <TableCell align="right" sx={countSx('high', img.totals?.high ?? 0)}>
                    {img.totals?.high ?? 0}</TableCell>
                  <TableCell align="right" sx={countSx('medium', img.totals?.medium ?? 0)}>
                    {img.totals?.medium ?? 0}</TableCell>
                  <TableCell align="right" sx={countSx('low', img.totals?.low ?? 0)}>
                    {img.totals?.low ?? 0}</TableCell>
                  <TableCell>
                    <Button size="small" onClick={() => handleSbom(latest.id, sbomName(img.sbom_file))}>
                      SBOM
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle1">Run history</Typography>
          <Table size="small" sx={zebraSx}>
            <TableHead>
              <TableRow>
                <TableCell>Run</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Result</TableCell>
                <TableCell align="right">Crit</TableCell>
                <TableCell align="right">High</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => handleRowClick(r.id)}>
                  <TableCell>{r.id}</TableCell>
                  <TableCell>{r.started_at}</TableCell>
                  <TableCell>{r.result}</TableCell>
                  <TableCell align="right">{r.totals?.critical ?? 0}</TableCell>
                  <TableCell align="right">{r.totals?.high ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle1">Schedule</Typography>
          {cfg && (
            <Box sx={{ display: 'flex', gap: 2, mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField label="Schedule (cron)" value={cfg.schedule}
                onChange={(e) => setCfg({ ...cfg, schedule: e.target.value })} />
              <TextField label="History cap (runs)" type="number" value={cfg.history_cap}
                onChange={(e) => setCfg({ ...cfg, history_cap: e.target.value })} />
              <Button variant="outlined" onClick={saveConfig}>Save config</Button>
            </Box>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>Audit</Typography>
            <IconButton aria-label={auditOpen ? 'collapse audit' : 'expand audit'}
              onClick={() => setAuditOpen((o) => !o)}>
              {auditOpen ? <ExpandLess /> : <ExpandMore />}
            </IconButton>
          </Box>
          <Collapse in={auditOpen}>
            <Table size="small" sx={zebraSx}>
              <TableHead>
                <TableRow>
                  <TableCell>Timestamp</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Result</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {audit.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>{row.ts}</TableCell>
                    <TableCell>{row.type}</TableCell>
                    <TableCell>{row.result}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Collapse>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Run security scan?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Scans every local image with Trivy. This can take several minutes.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleConfirmRun}>Confirm</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={logOpen} onClose={() => setLogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Run log</DialogTitle>
        <DialogContent>
          <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>
            {logText}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default { list: SecurityPage };
