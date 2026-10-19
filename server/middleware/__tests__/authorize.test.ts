// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import authorize from '../authorize';
import { verifySession } from '../../lib/sessionCheck';
import { HttpError } from '../../lib/httpError';

const SECRET = 'test-secret';
const key = new TextEncoder().encode(SECRET);
const app = express();
app.get('/x', authorize, (req, res) => res.json({ id: req.user?.id }));
const get = (token: string) => request(app).get('/x').set('Authorization', `Bearer ${token}`);

beforeEach(() => {
  process.env.OPEN_BALENA_JWT_SECRET = SECRET;
  vi.mocked(verifySession).mockReset().mockResolvedValue(undefined);
});

describe('authorize', () => {
  it('accepts a signed, unexpired token with a numeric id after the session check', async () => {
    const token = await new SignJWT({ id: 5 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key);
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 5 });
    expect(verifySession).toHaveBeenCalledWith(token, 5);
  });
  it('401 for a token without exp', async () => {
    const token = await new SignJWT({ id: 5 }).setProtectedHeader({ alg: 'HS256' }).sign(key);
    expect((await get(token)).status).toBe(401);
    expect(verifySession).not.toHaveBeenCalled();
  });
  it('401 for a string id', async () => {
    const token = await new SignJWT({ id: '5' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key);
    expect((await get(token)).status).toBe(401);
  });
  it('passes on the session check status (revoked → 401, API down → 503)', async () => {
    const token = await new SignJWT({ id: 5 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key);
    vi.mocked(verifySession).mockRejectedValueOnce(new HttpError(401, 'Session no longer valid'));
    expect((await get(token)).status).toBe(401);
    vi.mocked(verifySession).mockRejectedValueOnce(new HttpError(503, 'Session check failed'));
    expect((await get(token)).status).toBe(503);
  });
});
