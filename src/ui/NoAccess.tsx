import { Box, Button, Typography } from '@mui/material';
import * as React from 'react';
import { Title, useLogout } from 'react-admin';

const NoAccess: React.FC = () => {
  const logout = useLogout();
  return (
    <Box sx={{ p: 4, maxWidth: 520 }}>
      <Title title='No access' />
      <Typography variant='h5' gutterBottom>
        No access
      </Typography>
      <Typography sx={{ mb: 3 }}>
        Your account has no permissions in this interface yet. Please contact your administrator.
      </Typography>
      <Button variant='contained' onClick={() => logout()}>
        Log out
      </Button>
    </Box>
  );
};

export default NoAccess;
