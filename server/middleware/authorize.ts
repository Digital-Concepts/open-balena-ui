import type { RequestHandler } from 'express';
import { jwtVerify } from 'jose';
import { HttpError } from '../lib/httpError';
import { verifySession } from '../lib/sessionCheck';

const authorize: RequestHandler = async (req, res, next) => {
  try {
    const authorizationHeader = req.headers.authorization;
    const secret = process.env.OPEN_BALENA_JWT_SECRET;

    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ') || !secret) {
      res.status(401).json({ success: false, message: 'Invalid token' });
      return;
    }

    const token = authorizationHeader.split('Bearer ')[1];
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      requiredClaims: ['exp'],
    });
    const id = (payload as { id?: unknown }).id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      res.status(401).json({ success: false, message: 'Invalid token' });
      return;
    }
    await verifySession(token, id);
    req.user = { id };
    next();
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ success: false, message: error.message });
      return;
    }
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

export default authorize;
