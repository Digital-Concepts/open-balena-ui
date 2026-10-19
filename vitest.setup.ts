import '@testing-library/jest-dom/vitest';

// The openBalena session check is network-bound; route tests treat every signed token as a live session.
vi.mock('./server/lib/sessionCheck', () => ({ verifySession: vi.fn(async () => {}), clearSessionCache: vi.fn() }));
