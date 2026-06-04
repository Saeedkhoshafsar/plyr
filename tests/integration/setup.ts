// Integration-test environment bootstrap.
// Force a deterministic config BEFORE any src module (which imports
// src/config.ts -> dotenv) is loaded. vitest's `setupFiles` runs this first.
// These integration suites exercise the multi-tenant auth path (env-key admin,
// strict per-user API-key binding), so pin DEPLOYMENT_MODE=multi. The
// single-user mode short-circuits are covered separately in
// tests/unit/single-user-mode.test.ts (which mocks config).
process.env.DEPLOYMENT_MODE = 'multi';
process.env.API_KEYS_ENABLED = 'true';
process.env.API_KEYS = 'test_key_123';
process.env.ADMIN_SECRET = 'admin_test_secret';
process.env.CORS_ALLOWED_ORIGINS = '*';
process.env.NODE_ENV = 'test';
// Keep Redis URL pointing at the default local instance; integration tests that
// need Redis probe it and self-skip when it is unavailable.
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
