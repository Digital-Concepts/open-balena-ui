import { Box } from '@mui/material';
import * as React from 'react';
import { DeviceEnvVarList } from '../../components/deviceEnvVar';

const EnvVarsWidget: React.FC = () => {
  return (
    <Box
      sx={{
        'px': '15px',
        'width': '100%',
        'maxWidth': '100%',
        // The Datagrid table grows to its content width; let it scroll inside
        // the box instead of spilling past the (overflow-clipping) card.
        '.RaList-content': { overflowX: 'auto' },
        '.RaList-noResults': {
          height: 'auto',
          paddingBottom: '30px',
        },
      }}
    >
      <DeviceEnvVarList />
    </Box>
  );
};

export default EnvVarsWidget;
