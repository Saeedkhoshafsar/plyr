import { describe, it, expect, beforeAll } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// NOTE: tests/integration/setup.ts (wired via vitest setupFiles) forces a
// deterministic env BEFORE the middleware modules import src/config.ts:
//   API_KEYS_ENABLED=true, API_KEYS=test_key_123, ADMIN_SECRET=admin_test_secret
//
// These integration tests intentionally DO NOT import src/index.ts, because
// index.ts calls startServer() at module load (GlobalBrowser.initialize +
// app.listen) which has heavy side-effects. Instead we mount the real auth
// middleware on a fresh, lightweight Express app.

// Imports are deferred to a beforeAll so the setup file has already run and
// config.ts reads the forced env values.
let app: Express;

beforeAll(async () => {
  const { requireApiKey, requireAdminApiKey } = await import('../../src/middleware/auth');
  const { requireAdminAuth } = await import('../../src/middleware/admin-auth');

  app = express();
  app.use(express.json());

  // Public health route — no auth.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '40.0.0' });
  });

  // Protected route — requires a valid API key (env key or Redis-backed key).
  app.get('/protected', requireApiKey, (req, res) => {
    res.json({ ok: true, userId: (req as any).apiKeyUserId });
  });

  // Protected route that echoes a body userId (exercises strict user-binding).
  app.post('/run', requireApiKey, (req, res) => {
    res.json({ ok: true, userId: (req as any).apiKeyUserId, body: req.body });
  });

  // Admin route via env-key admin middleware (requireAdminApiKey -> env_root).
  app.get('/admin/env', requireAdminApiKey, (_req, res) => {
    res.json({ admin: true });
  });

  // Admin route via dedicated admin-token middleware (x-admin-token).
  app.get('/admin/stats', requireAdminAuth, (_req, res) => {
    res.json({ admin: true, version: '40.0.0' });
  });
});

describe('health route', () => {
  it('returns 200 and status ok without any auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('requireApiKey (env-key path, no Redis required)', () => {
  it('401 when no API key is provided', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it('403 when an invalid API key is provided', async () => {
    const res = await request(app).get('/protected').set('x-api-key', 'totally_wrong_key');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/invalid api key/i);
  });

  it('200 and env_root owner when the valid env key is provided', async () => {
    const res = await request(app).get('/protected').set('x-api-key', 'test_key_123');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.userId).toBe('env_root');
  });

  it('accepts the env key via Bearer Authorization header', async () => {
    const res = await request(app)
      .get('/protected')
      .set('authorization', 'Bearer test_key_123');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('env_root');
  });

  it('accepts the env key via api_key query param', async () => {
    const res = await request(app).get('/protected?api_key=test_key_123');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('env_root');
  });

  it('env key bypasses strict user-binding (any body userId allowed)', async () => {
    const res = await request(app)
      .post('/run')
      .set('x-api-key', 'test_key_123')
      .send({ userId: 'someone_else', steps: [] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.userId).toBe('env_root');
  });
});

describe('requireAdminApiKey (env-key admin path)', () => {
  it('200 with the env key (treated as env_root admin)', async () => {
    const res = await request(app).get('/admin/env').set('x-api-key', 'test_key_123');
    expect(res.status).toBe(200);
    expect(res.body.admin).toBe(true);
  });

  it('401 with no key', async () => {
    const res = await request(app).get('/admin/env');
    expect(res.status).toBe(401);
  });

  it('403 with an invalid key', async () => {
    const res = await request(app).get('/admin/env').set('x-api-key', 'nope');
    expect(res.status).toBe(403);
  });
});

describe('requireAdminAuth (x-admin-token path, no Redis required)', () => {
  it('403 when no admin token is provided', async () => {
    const res = await request(app).get('/admin/stats');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/access denied/i);
  });

  it('403 when a wrong admin token is provided', async () => {
    const res = await request(app).get('/admin/stats').set('x-admin-token', 'wrong_secret');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/access denied/i);
  });

  it('200 with the correct admin token', async () => {
    const res = await request(app).get('/admin/stats').set('x-admin-token', 'admin_test_secret');
    expect(res.status).toBe(200);
    expect(res.body.admin).toBe(true);
  });

  it('accepts the admin token via ?token query param', async () => {
    const res = await request(app).get('/admin/stats?token=admin_test_secret');
    expect(res.status).toBe(200);
    expect(res.body.admin).toBe(true);
  });
});
