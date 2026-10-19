import { OpenInFull } from '@mui/icons-material';
import { Box, Card, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import * as React from 'react';
import { TabbedShowLayout, Title, useRecordContext } from 'react-admin';
import SummaryWidget from '../dashboards/device/summaryWidget';
import UsageWidget from '../dashboards/device/usageWidget';
import DeviceConnectButton from '../ui/DeviceConnectButton';
import Can from './Can';
import CustomerDeviceConnect from './widgets/CustomerDeviceConnect';
import CustomerControlsWidget from './widgets/CustomerControlsWidget';
import CustomerDeviceLogs from './widgets/CustomerDeviceLogs';
import CustomerDeviceServices from './widgets/CustomerDeviceServices';
import CustomerTagsWidget from './widgets/CustomerTagsWidget';
import ReleasePinControl from './widgets/ReleasePinControl';

const SummaryTab: React.FC = () => (
  <>
    <SummaryWidget />
    <Can cap='device.release.pin'>
      <ReleasePinControl />
    </Can>
  </>
);

// Same layout as the admin device dashboard, without the config/env/service-var tabs.
const CustomerDashboardLayout: React.FC = () => {
  const record = useRecordContext();
  const theme = useTheme();

  React.useEffect(() => {
    document.title = record ? `${record['device name']} - Open Balena Admin` : 'Device Dashboard';
    return () => {
      document.title = 'Open Balena Admin';
    };
  }, [record]);

  if (!record) return null;

  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div style={{ flex: 2, margin: '7.5px', minWidth: '600px' }}>
        <Card style={{ padding: '15px' }}>
          <CustomerControlsWidget />
        </Card>
        <Card sx={{ padding: '15px', marginTop: '15px' }}>
          <Title title='/' />
          <TabbedShowLayout>
            <TabbedShowLayout.Tab label='Summary'>
              <SummaryTab />
            </TabbedShowLayout.Tab>
            <TabbedShowLayout.Tab label='Tags'>
              <CustomerTagsWidget />
            </TabbedShowLayout.Tab>
          </TabbedShowLayout>
        </Card>

        <Card sx={{ padding: '15px', marginTop: '15px' }}>
          <CustomerDeviceServices device={record as any} />
        </Card>
      </div>

      <div style={{ flex: 3, margin: '7.5px', minWidth: '550px' }}>
        <Card sx={{ padding: '15px' }}>
          <UsageWidget />
        </Card>

        <Can cap='device.logs'>
          <Card sx={{ padding: 0, marginTop: '15px' }}>
            <CustomerDeviceLogs />
          </Card>
        </Can>

        <Can cap='device.terminal'>
          <Card sx={{ padding: 0, marginTop: '15px', position: 'relative' }}>
            <DeviceConnectButton
              size='small'
              ConnectComponent={CustomerDeviceConnect}
              sx={{
                'width': 32,
                'height': 32,
                'minWidth': 32,
                'padding': 0,
                'display': 'inline-flex',
                'alignItems': 'center',
                'justifyContent': 'center',
                'gap': 0,
                'borderRadius': '6px',
                'position': 'absolute',
                'top': 10,
                'right': 15,
                'color': theme.palette.mode === 'dark' ? alpha(theme.palette.common.white, 0.9) : theme.palette.text.secondary,
                'backgroundColor':
                  theme.palette.mode === 'dark' ? alpha(theme.palette.common.white, 0.14) : theme.palette.background.paper,
                'border': 'none',
                'boxShadow': 'none',
                '&:hover': {
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.22)
                      : alpha(theme.palette.background.paper, 0.9),
                  boxShadow: 'none',
                },
                '& .MuiButton-startIcon': { margin: 0 },
              }}
              connectIcon={<OpenInFull fontSize='small' />}
              connectIconTooltip='Open Fullscreen View'
            />
            <CustomerDeviceConnect />
          </Card>
        </Can>
      </div>
    </Box>
  );
};

export default CustomerDashboardLayout;
