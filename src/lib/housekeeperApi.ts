import { useAuthProvider } from 'react-admin';
import axios from 'axios';
import environment from './reactAppEnv';

export function useHousekeeperApi() {
  const authProvider = useAuthProvider();
  const baseUrl = `${environment.REACT_APP_OPEN_BALENA_UI_URL}/housekeeper`;

  const headers = () => {
    const jwt = authProvider?.getSession?.()?.jwt;
    return { Authorization: `Bearer ${jwt}` };
  };

  return {
    getStatus: async () => (await axios.get(`${baseUrl}/status`, { headers: headers() })).data,
    getConfig: async () => (await axios.get(`${baseUrl}/config`, { headers: headers() })).data,
    putConfig: async (cfg: Record<string, any>) =>
      (await axios.put(`${baseUrl}/config`, cfg, { headers: headers() })).data,
    getRuns: async () => (await axios.get(`${baseUrl}/runs`, { headers: headers() })).data,
    getRunLog: async (id: string) =>
      (await axios.get(`${baseUrl}/runs/${encodeURIComponent(id)}/log`, { headers: headers() })).data,
    getAudit: async (params: Record<string, any> = {}) =>
      (await axios.get(`${baseUrl}/audit`, { headers: headers(), params })).data,
    getFleets: async () => (await axios.get(`${baseUrl}/fleets`, { headers: headers() })).data.fleets,
    triggerRun: async (body: Record<string, any>) =>
      (await axios.post(`${baseUrl}/run`, body, { headers: headers() })).data,
  };
}
