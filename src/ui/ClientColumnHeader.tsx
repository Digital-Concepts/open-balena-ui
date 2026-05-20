import * as React from 'react';
import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowDropDown, FilterAlt } from '@mui/icons-material';

export const UNCLASSIFIED_SENTINEL = '__unclassified__';

interface ClientColumnHeaderProps {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  loading?: boolean;
  counts?: Record<string, number>;
  unclassifiedCount?: number;
}

const ClientColumnHeader: React.FC<ClientColumnHeaderProps> = ({
  options,
  selected,
  onChange,
  loading,
  counts,
  unclassifiedCount,
}) => {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [search, setSearch] = React.useState('');
  const open = Boolean(anchorEl);

  const filteredOptions = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const clear = () => onChange([]);

  const renderCount = (n: number | undefined) =>
    n === undefined ? '' : ` (${n})`;

  return (
    <>
      <Button
        size='small'
        variant='text'
        color='inherit'
        onClick={(e) => setAnchorEl(e.currentTarget)}
        endIcon={<ArrowDropDown />}
        startIcon={selected.length > 0 ? <FilterAlt fontSize='small' /> : undefined}
        sx={{
          padding: '0 6px',
          minWidth: 0,
          textTransform: 'none',
          fontWeight: 'inherit',
          background: 'none',
          '&:hover': { background: 'rgba(127,127,127,0.08)' },
        }}
      >
        <Typography component='span' variant='body2' sx={{ fontWeight: 'bold' }}>
          Client
          {selected.length > 0 ? ` (${selected.length})` : ''}
        </Typography>
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        slotProps={{ paper: { sx: { maxHeight: 360, minWidth: 240 } } }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            width: '100%',
            px: 2,
            py: 0.75,
            opacity: loading ? 0.6 : 1,
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
            <Typography variant='caption' sx={{ opacity: 0.7 }}>
              {loading
                ? 'Loading…'
                : `${filteredOptions.length}${search ? ` / ${options.length}` : ''} clients`}
            </Typography>
            <Button size='small' onClick={clear} disabled={selected.length === 0}>
              Clear
            </Button>
          </Box>
          <TextField
            size='small'
            placeholder='Search…'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            autoFocus
            fullWidth
          />
        </Box>
        <Divider />
        <MenuItem dense onClick={() => toggle(UNCLASSIFIED_SENTINEL)}>
          <FormControlLabel
            control={<Checkbox checked={selected.includes(UNCLASSIFIED_SENTINEL)} size='small' />}
            label={
              <span>
                <em>Unclassified</em>
                {renderCount(unclassifiedCount)}
              </span>
            }
            onClick={(e) => e.preventDefault()}
          />
        </MenuItem>
        <Divider />
        {filteredOptions.map((opt) => (
          <MenuItem key={opt} dense onClick={() => toggle(opt)}>
            <FormControlLabel
              control={<Checkbox checked={selected.includes(opt)} size='small' />}
              label={`${opt}${renderCount(counts?.[opt])}`}
              onClick={(e) => e.preventDefault()}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

export default ClientColumnHeader;
