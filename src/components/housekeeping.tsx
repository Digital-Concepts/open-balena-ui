import * as React from 'react';
import { useNotify } from 'react-admin';
import {
  Card, CardContent, Typography, TextField, FormControlLabel, Checkbox,
  Button, Chip, Box, Select, MenuItem, FormControl, InputLabel,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  CircularProgress, Table, TableHead, TableBody, TableRow, TableCell,
} from '@mui/material';
import { useHousekeeperApi } from '../lib/housekeeperApi';

export const HousekeepingPage: React.FC = () => {
  const api = useHousekeeperApi();
  const notify = useNotify();
  const [status, setStatus] = React.useState<any>(null);
  const [cfg, setCfg] = React.useState<any>(null);
  const [fleets, setFleets] = React.useState<{ name: string; id: number }[]>([]);
  const [selectedFleet, setSelectedFleet] = React.useState<string>('');
  const [windowDays, setWindowDays] = React.useState<number>(30);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [runs, setRuns] = React.useState<any[]>([]);
  const [logOpen, setLogOpen] = React.useState(false);
  const [logText, setLogText] = React.useState('');
  const [audit, setAudit] = React.useState<any[]>([]);
  const [auditType, setAuditType] = React.useState('');
  const [auditSince, setAuditSince] = React.useState('');

  React.useEffect(() => {
    let active = true;
    const loadStatus = () => api.getStatus().then((s: any) => { if (active) setStatus(s); }).catch(() => {});
    loadStatus();
    const t = setInterval(loadStatus, 10000);
    api.getConfig().then((c: any) => { if (active) setCfg(c); }).catch(() => {});
    api.getFleets().then((f: any) => { if (active) setFleets(f); }).catch(() => {});
    api.getRuns().then((r: any) => { if (active) setRuns(r); }).catch(() => {});
    api.getAudit({}).then((a: any) => { if (active) setAudit(a); }).catch(() => {});
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
      const { run_id } = await api.triggerRun({ fleets: [selectedFleet], window_days: windowDays });
      const deadline = Date.now() + 5 * 60 * 1000;
      pollRef.current = setInterval(async () => {
        try {
          const s: any = await api.getStatus();
          if (s.status !== 'running' && s.last_run?.id === run_id) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setRunning(false);
            notify(`Run ${s.last_run.result}`, { type: s.last_run.result === 'success' ? 'success' : 'warning' });
          } else if (Date.now() >= deadline) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setRunning(false);
            notify('Run still in progress — check Run history', { type: 'info' });
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
        notify('Run failed', { type: 'error' });
      }
      setRunning(false);
    }
  };

  const excluded: string[] = cfg?.release_cleanup?.exclude_fleets ?? [];

  const toggleExclude = (name: string) =>
    setCfg((c: any) => {
      const set = new Set<string>(c.release_cleanup.exclude_fleets);
      set.has(name) ? set.delete(name) : set.add(name);
      return { ...c, release_cleanup: { ...c.release_cleanup, exclude_fleets: [...set] } };
    });

  const setField = (path: string[], val: any) =>
    setCfg((c: any) => {
      const next = structuredClone(c);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let o: any = next;
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
      o[path[path.length - 1]] = val;
      return next;
    });

  const save = async () => {
    try {
      await api.putConfig(cfg);
      notify('Config saved', { type: 'success' });
    } catch (e: any) {
      notify(e?.response?.data?.errors?.join('; ') || 'Save failed', { type: 'error' });
    }
  };

  const handleRunRowClick = async (id: string) => {
    try {
      const text = await api.getRunLog(id);
      setLogText(text);
      setLogOpen(true);
    } catch {
      notify('Failed to load run log', { type: 'error' });
    }
  };

  const loadAudit = async (type: string, since: string) => {
    try {
      const params: Record<string, string> = {};
      if (type) params.type = type;
      if (since) params.since = since;
      const a = await api.getAudit(params);
      setAudit(a);
    } catch {
      // ignore
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6">Status</Typography>
          {status && (
            <Chip
              label={status.status}
              color={status.status === 'running' ? 'warning' : 'success'}
              sx={{ mr: 2 }}
            />
          )}
          {status?.next_scheduled_at && (
            <Typography variant="body2" component="span">
              Next: {status.next_scheduled_at}
            </Typography>
          )}
        </CardContent>
      </Card>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Clean a single fleet</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 480 }}>
            <FormControl fullWidth>
              <InputLabel id="fleet-to-clean-label">Fleet to clean</InputLabel>
              <Select
                labelId="fleet-to-clean-label"
                label="Fleet to clean"
                value={selectedFleet}
                onChange={(e) => setSelectedFleet(e.target.value as string)}
                inputProps={{ 'aria-label': 'Fleet to clean' }}
              >
                {fleets.map((f) => (
                  <MenuItem key={f.id} value={f.name}>{f.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Custom window (days)"
              type="number"
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
              inputProps={{ 'aria-label': 'Custom window (days)' }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button
                variant="contained"
                color="warning"
                disabled={!selectedFleet || running}
                onClick={() => setConfirmOpen(true)}
              >
                Run
              </Button>
              {running && <CircularProgress size={20} />}
            </Box>
          </Box>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Confirm cleanup run</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Run cleanup for fleet <strong>{selectedFleet}</strong> with a {windowDays}-day window?
            This action is live and cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirmRun} color="warning" variant="contained">Confirm</Button>
        </DialogActions>
      </Dialog>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Run history</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Ended</TableCell>
                <TableCell>Result</TableCell>
                <TableCell>Counts</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((run) => (
                <TableRow
                  key={run.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => handleRunRowClick(run.id)}
                >
                  <TableCell>{run.id}</TableCell>
                  <TableCell>{run.started_at}</TableCell>
                  <TableCell>{run.ended_at}</TableCell>
                  <TableCell>{run.result}</TableCell>
                  <TableCell>{run.phase1 ? `${run.phase1.deleted ?? 0} deleted` : ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={logOpen} onClose={() => setLogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Run log</DialogTitle>
        <DialogContent>
          <pre style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{logText}</pre>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Audit</Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label="Type filter"
              value={auditType}
              onChange={(e) => {
                setAuditType(e.target.value);
                loadAudit(e.target.value, auditSince);
              }}
              inputProps={{ 'aria-label': 'Type filter' }}
              size="small"
            />
            <TextField
              label="Since"
              value={auditSince}
              onChange={(e) => {
                setAuditSince(e.target.value);
                loadAudit(auditType, e.target.value);
              }}
              inputProps={{ 'aria-label': 'Since' }}
              size="small"
            />
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Timestamp</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Fleet</TableCell>
                <TableCell>Commit</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {audit.map((row, i) => (
                <TableRow key={i}>
                  <TableCell>{row.ts}</TableCell>
                  <TableCell>{row.type}</TableCell>
                  <TableCell>{row.fleet}</TableCell>
                  <TableCell>{row.commit}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {cfg && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Configuration</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 480 }}>
              <TextField
                label="Schedule (cron)"
                value={cfg.schedule}
                onChange={(e) => setField(['schedule'], e.target.value)}
                inputProps={{ 'aria-label': 'Schedule (cron)' }}
              />
              <TextField
                label="Window (days)"
                type="number"
                value={cfg.release_cleanup.window_days}
                onChange={(e) => setField(['release_cleanup', 'window_days'], Number(e.target.value))}
                inputProps={{ 'aria-label': 'Window (days)' }}
              />
              <TextField
                label="Retention per fleet"
                type="number"
                value={cfg.registry_gc.retention_keep_per_fleet}
                onChange={(e) => setField(['registry_gc', 'retention_keep_per_fleet'], Number(e.target.value))}
                inputProps={{ 'aria-label': 'Retention per fleet' }}
              />
              <TextField
                label="Failed grace (hours)"
                type="number"
                value={cfg.registry_gc.failed_grace_hours}
                onChange={(e) => setField(['registry_gc', 'failed_grace_hours'], Number(e.target.value))}
                inputProps={{ 'aria-label': 'Failed grace (hours)' }}
              />
            </Box>
            <Typography sx={{ mt: 2, mb: 1 }}>Exclude fleets from scheduled cleanup:</Typography>
            <Box>
              {fleets.map((f) => (
                <FormControlLabel
                  key={f.id}
                  label={f.name}
                  control={
                    <Checkbox
                      checked={excluded.includes(f.name)}
                      onChange={() => toggleExclude(f.name)}
                      inputProps={{ 'aria-label': f.name }}
                    />
                  }
                />
              ))}
            </Box>
            <Box sx={{ mt: 2 }}>
              <Button variant="contained" onClick={save}>
                Save Config
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default { list: HousekeepingPage };
