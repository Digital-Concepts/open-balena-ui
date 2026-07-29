import { useAuthProvider } from 'react-admin';
import axios from 'axios';
import environment from './reactAppEnv';

export function useSecurityApi() {
  const authProvider = useAuthProvider();
  const baseUrl = `${environment.REACT_APP_OPEN_BALENA_UI_URL}/security`;

  const headers = () => {
    const jwt = authProvider?.getSession?.()?.jwt;
    return { Authorization: `Bearer ${jwt}` };
  };

  return {
    getStatus: async () => (await axios.get(`${baseUrl}/status`, { headers: headers() })).data,
    getLatest: async () => (await axios.get(`${baseUrl}/runs/latest`, { headers: headers() })).data,
    getRuns: async () => (await axios.get(`${baseUrl}/runs`, { headers: headers() })).data,
    getRunDetail: async (id: string) =>
      (await axios.get(`${baseUrl}/runs/${encodeURIComponent(id)}`, { headers: headers() })).data,
    getRunLog: async (id: string) =>
      (await axios.get(`${baseUrl}/runs/${encodeURIComponent(id)}/log`, { headers: headers() })).data,
    getAudit: async (params: Record<string, any> = {}) =>
      (await axios.get(`${baseUrl}/audit`, { headers: headers(), params })).data,
    getConfig: async () => (await axios.get(`${baseUrl}/config`, { headers: headers() })).data,
    putConfig: async (cfg: Record<string, any>) =>
      (await axios.put(`${baseUrl}/config`, cfg, { headers: headers() })).data,
    triggerRun: async () => (await axios.post(`${baseUrl}/run`, {}, { headers: headers() })).data,
    downloadSbom: async (id: string, name: string) =>
      (await axios.get(`${baseUrl}/runs/${encodeURIComponent(id)}/sbom/${encodeURIComponent(name)}`,
        { headers: headers(), responseType: 'blob' })).data,

    // Fleet SBOM/CVE reports (uploaded by the build system, per release fleet).
    getFleets: async () => (await axios.get(`${baseUrl}/fleets`, { headers: headers() })).data,
    getFleetReleases: async (fleet: string) =>
      (await axios.get(`${baseUrl}/fleets/${encodeURIComponent(fleet)}/releases`,
        { headers: headers() })).data,
    getFleetRelease: async (fleet: string, release: string) =>
      (await axios.get(
        `${baseUrl}/fleets/${encodeURIComponent(fleet)}/releases/${encodeURIComponent(release)}`,
        { headers: headers() })).data,
    downloadFleetSbom: async (fleet: string, release: string, service: string) =>
      (await axios.get(
        `${baseUrl}/fleets/${encodeURIComponent(fleet)}/releases/${encodeURIComponent(release)}` +
        `/sbom/${encodeURIComponent(service)}`,
        { headers: headers(), responseType: 'blob' })).data,
  };
}
