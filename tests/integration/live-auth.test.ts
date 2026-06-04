import { describe, it, expect } from 'vitest';

// Step 16 — authorizeLive() tests for the Live Channel (WS + SSE).
// setup.ts forces API_KEYS_ENABLED=true and API_KEYS=test_key_123 BEFORE
// config.ts loads, so the env-key path is exercised without Redis.

describe('authorizeLive (env-key path, no Redis required)', () => {
  it('denies when no API key is provided', async () => {
    const { authorizeLive } = await import('../../src/core/LiveServer');
    const res = await authorizeLive(undefined, '0');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('missing_api_key');
  });

  it('allows the env (admin) key for any userId', async () => {
    const { authorizeLive } = await import('../../src/core/LiveServer');
    const res = await authorizeLive('test_key_123', 'any_user');
    expect(res.ok).toBe(true);
  });

  it('denies an unknown / invalid key', async () => {
    // initApiKeyManager must exist for the non-env path; the API key manager
    // is initialized lazily in index.ts. When it is not initialized we expect
    // a graceful denial rather than a throw.
    const { authorizeLive } = await import('../../src/core/LiveServer');
    const res = await authorizeLive('totally_wrong_key', '0');
    expect(res.ok).toBe(false);
    // reason is either invalid_api_key (manager present) or auth_unavailable.
    expect(['invalid_api_key', 'auth_unavailable']).toContain(res.reason);
  });
});
