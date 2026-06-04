import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Self-Hosted single-user mode (Step 18, category H) ─────────────────────
// Verifies the DEPLOYMENT_MODE=single behaviour in isolation:
//   1. UserManager.getEffectivePlan short-circuits to FULL_ACCESS_PLAN
//   2. UserManager.isUserBlocked always returns false (no Redis lookup)
//   3. requireApiKey authenticates with the single shared API_TOKEN and
//      resolves to the fixed SINGLE_USER_ID ('local'); rejects missing /
//      wrong tokens with 401 / 403 respectively.
//   4. (multi guard) getEffectivePlan does NOT short-circuit in multi mode.
//
// config is mocked so we can flip IS_SINGLE_USER / DEPLOYMENT_MODE / API_TOKEN
// per scenario without any environment plumbing.

const FULL_ACCESS_PLAN = {
  quota: 0,
  maxTabs: 50,
  maxSteps: 10000,
  priority: 1,
  maxSchedules: 1000,
  runLimit: 0,
};

// Mutable config object so individual tests can toggle the mode.
const cfg: Record<string, unknown> = {
  IS_SINGLE_USER: true,
  DEPLOYMENT_MODE: 'single',
  API_TOKEN: 'tok_secret_single_token',
  API_TOKEN_AUTO_GENERATED: false,
  API_KEYS_ENABLED: true,
  FULL_ACCESS_PLAN,
  USER_PLANS: { '0': { quota: 10, maxTabs: 2, maxSteps: 100, priority: 1, maxSchedules: 5, runLimit: 0 } },
  DEFAULT_USER_LEVEL: '0',
};

vi.mock('../../src/config', () => ({
  get config() {
    return cfg;
  },
}));

import { UserManager } from '../../src/core/UserManager';
import { requireApiKey, SINGLE_USER_ID } from '../../src/middleware/auth';

// A Redis stub that THROWS if touched — proves single mode never reads Redis.
function explodingRedis() {
  const boom = () => {
    throw new Error('Redis must not be touched in single-user mode');
  };
  return new Proxy({}, { get: () => boom }) as unknown as Parameters<typeof UserManager.getEffectivePlan>[0];
}

// Minimal Express req/res doubles for the middleware.
function makeRes() {
  const res: Record<string, unknown> = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res.body = payload;
    return res;
  };
  return res as { statusCode: number; body: any; status: (c: number) => unknown; json: (p: unknown) => unknown };
}

function makeReq(opts: { authorization?: string; xApiKey?: string } = {}) {
  return {
    headers: {
      authorization: opts.authorization,
      'x-api-key': opts.xApiKey,
    },
    query: {},
    ip: '127.0.0.1',
  } as any;
}

beforeEach(() => {
  // Reset to single-mode defaults before each test.
  cfg.IS_SINGLE_USER = true;
  cfg.DEPLOYMENT_MODE = 'single';
  cfg.API_TOKEN = 'tok_secret_single_token';
  cfg.API_KEYS_ENABLED = true;
});

describe('single-user mode — UserManager', () => {
  it('getEffectivePlan returns the full-access plan without touching Redis', async () => {
    const plan = await UserManager.getEffectivePlan(explodingRedis(), 'anyone');
    expect(plan.maxTabs).toBe(FULL_ACCESS_PLAN.maxTabs);
    expect(plan.maxSteps).toBe(FULL_ACCESS_PLAN.maxSteps);
    expect(plan.quota).toBe(FULL_ACCESS_PLAN.quota);
    expect(plan.baseLevel).toBe('single');
    expect(plan.isOverridden).toBe(false);
  });

  it('isUserBlocked is always false without touching Redis', async () => {
    const blocked = await UserManager.isUserBlocked(explodingRedis(), 'anyone');
    expect(blocked).toBe(false);
  });
});

describe('single-user mode — requireApiKey', () => {
  it('accepts the correct API_TOKEN (Bearer) and resolves to SINGLE_USER_ID', async () => {
    const req = makeReq({ authorization: 'Bearer tok_secret_single_token' });
    const res = makeRes();
    const next = vi.fn();
    await requireApiKey(req, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.apiKeyUserId).toBe(SINGLE_USER_ID);
    expect(req.apiKeyUserId).toBe('local');
    expect(req.apiKey).toBe('tok_secret_single_token');
  });

  it('accepts the correct API_TOKEN via x-api-key header', async () => {
    const req = makeReq({ xApiKey: 'tok_secret_single_token' });
    const res = makeRes();
    const next = vi.fn();
    await requireApiKey(req, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.apiKeyUserId).toBe('local');
  });

  it('rejects a missing token with 401', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await requireApiKey(req, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a wrong token with 403', async () => {
    const req = makeReq({ authorization: 'Bearer tok_wrong' });
    const res = makeRes();
    const next = vi.fn();
    await requireApiKey(req, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('Invalid API token');
  });
});

describe('multi mode — UserManager.getEffectivePlan delegates to plans', () => {
  it('does NOT short-circuit to full-access when DEPLOYMENT_MODE=multi', async () => {
    cfg.IS_SINGLE_USER = false;
    cfg.DEPLOYMENT_MODE = 'multi';
    // Redis stub returning a saved level + no overrides.
    const redis = {
      async get(k: string) {
        if (k.startsWith('user:level:')) return '0';
        return null;
      },
      async hgetall() {
        return {} as Record<string, string>;
      },
    } as unknown as Parameters<typeof UserManager.getEffectivePlan>[0];
    const plan = await UserManager.getEffectivePlan(redis, 'tenant-a');
    // Comes from USER_PLANS['0'], not FULL_ACCESS_PLAN.
    expect(plan.maxTabs).toBe(2);
    expect(plan.baseLevel).toBe('0');
  });
});
