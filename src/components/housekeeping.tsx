import * as React from 'react';
import { useNotify } from 'react-admin';
import { Card, CardContent, Typography, TextField, FormControlLabel, Checkbox, Button, Chip, Box } from '@mui/material';
import { useHousekeeperApi } from '../lib/housekeeperApi';

export const HousekeepingPage: React.FC = () => {
  const api = useHousekeeperApi();
  const notify = useNotify();
  const [status, setStatus] = React.useState<any>(null);
  const [cfg, setCfg] = React.useState<any>(null);
  const [fleets, setFleets] = React.useState<{ name: string; id: number }[]>([]);

  React.useEffect(() => {
    let active = true;
    const loadStatus = () => api.getStatus().then((s: any) => { if (active) setStatus(s); }).catch(() => {});
    loadStatus();
    const t = setInterval(loadStatus, 10000);
    api.getConfig().then((c: any) => { if (active) setCfg(c); }).catch(() => {});
    api.getFleets().then((f: any) => { if (active) setFleets(f); }).catch(() => {});
    return () => { active = false; clearInterval(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
