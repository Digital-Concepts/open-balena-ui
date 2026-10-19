import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postgrestAsAdmin } from '../postgrestAsAdmin';

const failWith = (code?: string) =>
  vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), code ? { cause: { code } } : {}));

describe('postgrestAsAdmin fetch errors', () => {
  beforeEach(() => {
    process.env.ADMIN_UI_POSTGREST_URL = 'https://pg.example';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ADMIN_UI_POSTGREST_URL;
  });

  it.each([
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  ])('reports untrusted certificate for %s', async (code) => {
    vi.stubGlobal('fetch', failWith(code));
    await expect(postgrestAsAdmin('Bearer t', 'GET', 'device')).rejects.toMatchObject({
      status: 502,
      message: `PostgREST TLS certificate not trusted (${code}) — the proxy must serve the full certificate chain`,
    });
  });

  it('appends the cause code for other errors', async () => {
    vi.stubGlobal('fetch', failWith('ECONNREFUSED'));
    await expect(postgrestAsAdmin('Bearer t', 'GET', 'device')).rejects.toMatchObject({
      status: 502,
      message: 'PostgREST unreachable (ECONNREFUSED)',
    });
  });

  it('keeps the plain message without a cause', async () => {
    vi.stubGlobal('fetch', failWith());
    await expect(postgrestAsAdmin('Bearer t', 'GET', 'device')).rejects.toMatchObject({
      status: 502,
      message: 'PostgREST unreachable',
    });
  });
});
