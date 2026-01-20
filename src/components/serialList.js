import * as React from 'react';
import {
  Datagrid,
  List,
  TextField,
  FunctionField,
  TextInput,
  SelectInput,
  downloadCSV,
  useRefresh,
  useNotify,
} from 'react-admin';
import {
  Typography,
  Divider,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField as MuiTextField,
  Box,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import jsonExport from 'jsonexport/dist';

export const SerialList = () => {
  const [productIdChoices, setProductIdChoices] = React.useState([]);
  const [openDialog, setOpenDialog] = React.useState(false);
  const [eurid, setEurid] = React.useState('');
  const [serial, setSerial] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const refresh = useRefresh();
  const notify = useNotify();

  const handleCreateSerial = async () => {
    if (!eurid || !serial) {
      notify('Please fill in both EURID and Serial fields', { type: 'error' });
      return;
    }

    setLoading(true);
    try {
      const cpuSerial = `imported_${eurid}`;
      const randomBytes = Array.from({ length: 3 }, () => 
        Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
      ).join(':');
      const macAddress = `${randomBytes}:00:00`.toUpperCase();
      const productId = '004000000025';

      const authToken = localStorage.getItem('auth');

      const response = await fetch('/registerGateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          eurid: eurid,
          cpu_serial: cpuSerial,
          mac_address: macAddress,
          productId: productId,
          serial: serial,
        }),
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        notify('Serial number registered successfully', { type: 'success' });
        setOpenDialog(false);
        setEurid('');
        setSerial('');
        refresh();
      } else {
        notify(`Failed to register: ${data.message}`, { type: 'error' });
      }
    } catch (error) {
      notify(`Error: ${error.message}`, { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    const authToken = localStorage.getItem('auth');
    
    fetch('/getGateways', {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    })
      .then(response => response.json())
      .then(data => {
        const gateways = data || [];
        
        const uniqueProductIds = [...new Set(
          gateways
            .map(g => g.product_id)
            .filter(Boolean)
        )].sort();
        
        const choices = uniqueProductIds.map(id => ({
          id: id,
          name: id,
        }));
        
        setProductIdChoices(choices);
      })
      .catch(err => {
        console.error('Error loading product IDs:', err);
      });
  }, []);

  const exporter = (records, fetchRelatedRecords, dataProvider, resource) => {
    const dataForExport = records.map(record => ({
      ID: record.id,
      Serial: record.serial || 'N/A',
      EURID: record.eurid,
      'CPU Serial': record.cpu_serial,
      'MAC Address': record.mac_address,
      'Product ID': record.product_id,
      'Registered At': record.registered_at ? new Date(record.registered_at).toLocaleString() : '',
    }));
    
    jsonExport(dataForExport, (err, csv) => {
      if (err) {
        console.error('Export error:', err);
        return;
      }
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = resource === 'recentGateways' 
        ? `recent-gateways-${timestamp}.csv`
        : `all-gateways-${timestamp}.csv`;
      downloadCSV(csv, filename);
    });
  };

  const gatewayFilters = [
    <TextInput 
      key="search" 
      label="Search" 
      source="q" 
      alwaysOn 
      size="small"
      variant="outlined"
      margin="dense"
      sx={{
        width: 220,
        minWidth: 220,
      }}
    />,
    <SelectInput 
      key="product" 
      source="product_id" 
      label="Product ID" 
      choices={productIdChoices}
      alwaysOn
      size="small"
      variant="outlined"
      margin="dense"
      sx={{
        width: 220,
        minWidth: 220,
        '& .MuiOutlinedInput-root': {
          height: 35,
        },
      }}
    />,
  ];

  return (
    <div>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginLeft: '16px', marginRight: '16px', marginTop: '16px', marginBottom: '8px' }}>
        <Typography variant="h5">
          Recent Gateways (Last 7 Days)
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setOpenDialog(true)}
          sx={{
            backgroundColor: '#2A506F',
            height: '40px',
            '&:hover': {
              backgroundColor: '#34607F',
            },
          }}
        >
          Register New Gateway
        </Button>
      </Box>

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Register New Gateway</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <MuiTextField
              label="EURID"
              value={eurid}
              onChange={(e) => setEurid(e.target.value)}
              fullWidth
              required
              placeholder="e.g., 052170B0"
            />
            <MuiTextField
              label="Serial"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              fullWidth
              required
              placeholder="e.g., 02024031"
            />
            <Typography variant="caption" color="text.secondary">
              CPU Serial will be automatically set to: imported_{eurid || '...'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              MAC Address will be auto-generated from EURID
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Random Product ID '004000000025' will be assigned
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateSerial}
            variant="contained"
            disabled={loading}
            sx={{
              backgroundColor: '#2A506F',
              '&:hover': {
                backgroundColor: '#34607F',
              },
            }}
          >
            {loading ? 'Registering...' : 'Register'}
          </Button>
        </DialogActions>
      </Dialog>

      <List
        resource="recentGateways"
        hasCreate={false}
        hasEdit={false}
        exporter={exporter}
        title=""
        storeKey="recentGateways.list"
        perPage={10}
        disableSyncWithLocation
        filters={gatewayFilters}
      >          
        <Datagrid bulkActionButtons={false} rowClick={false}>
          <TextField source="id" label="ID" sortable />
          <FunctionField
            label="Serial"
            render={(record) => record.serial || 'N/A'}
            sortBy="serial"
          />
          <TextField source="eurid" label="EURID" sortable />
          <TextField source="cpu_serial" label="CPU Serial" />
          <TextField source="mac_address" label="MAC Address"/>
          <TextField source="product_id" label="Product ID" sortable />
          <FunctionField
            label="Registered At"
            render={(record) => new Date(record.registered_at).toLocaleString()}
            sortBy="registered_at"
          />
        </Datagrid>
      </List>

      <Divider style={{ margin: '30px 0' }} />

      <Typography variant="h5" gutterBottom style={{ marginLeft: '16px' }}>
        All Gateways
      </Typography>
      <List
        resource="gateways"
        hasCreate={false}
        hasEdit={false}
        exporter={exporter}
        title=""
        storeKey="gateways.list"
        perPage={10}
        disableSyncWithLocation
        filters={gatewayFilters}
      >          
        <Datagrid bulkActionButtons={false} rowClick={false}>
          <TextField source="id" label="ID" sortable />
          <FunctionField
            label="Serial"
            render={(record) => record.serial || 'N/A'}
            sortBy="serial"
          />
          <TextField source="eurid" label="EURID" sortable />
          <TextField source="cpu_serial" label="CPU Serial" />
          <TextField source="mac_address" label="MAC Address"/>
          <TextField source="product_id" label="Product ID" sortable />
          <FunctionField
            label="Registered At"
            render={(record) => new Date(record.registered_at).toLocaleString()}
            sortBy="registered_at"
          />
        </Datagrid>
      </List>
    </div>
  );
};

const serialList = {
  list: SerialList,
};

export default serialList;