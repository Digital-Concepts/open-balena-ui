import * as React from 'react';
import { MenuItemLink } from 'react-admin';
import DefaultIcon from '@mui/icons-material/ViewList';
import { useSecurityApi } from '../lib/securityApi';
import { highestSeverity, severityColor, loadCachedSeverity, storeCachedSeverity, type Severity } from '../lib/severity';

interface Props {
  resource: any;
  primaryText: string;
  onClick?: (event?: unknown) => void;
  dense?: boolean;
  sidebarIsOpen?: boolean;
}

/**
 * The Security menu item, tinted a muted shade of the highest-severity finding in
 * the latest scan (nothing found → default colour).
 */
const SecurityMenuItem: React.FC<Props> = ({ resource, primaryText, onClick, dense, sidebarIsOpen }) => {
  const api = useSecurityApi();
  // Seed from the cached severity so the tint paints on first render; revalidate below.
  const [sev, setSev] = React.useState<Severity | null | undefined>(() => loadCachedSeverity());

  React.useEffect(() => {
    let active = true;
    api.getLatest()
      .then((l: any) => {
        const next = highestSeverity(l?.totals || {});
        storeCachedSeverity(next);
        if (active) setSev(next);
      })
      .catch(() => { /* keep the cached tint on failure */ });
    return () => { active = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const color = severityColor(sev ?? null, true);
  const Icon = resource.icon || DefaultIcon;

  return (
    <MenuItemLink
      to={`/${encodeURIComponent(resource.name)}`}
      primaryText={primaryText}
      leftIcon={<Icon />}
      onClick={onClick}
      dense={dense}
      sidebarIsOpen={sidebarIsOpen}
      data-severity={sev ?? 'none'}
      sx={color
        ? { 'backgroundColor': `${color} !important`, '&:hover': { backgroundColor: `${color} !important` } }
        : undefined}
    />
  );
};

export default SecurityMenuItem;
