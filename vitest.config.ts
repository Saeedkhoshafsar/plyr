import { defineConfig } from 'vitest/config';

// Vitest configuration.
// - Unit tests (tests/unit/**) are pure and import src modules directly.
//   src/config.ts only reads env (no Redis/network), so importing the
//   validation/helpers/condition/schemas modules has no side-effects.
// - Integration tests (tests/integration/**) spin up a lightweight Express
//   app and talk to a live Redis; they self-skip when REDIS is unavailable.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Force a deterministic test env (API keys, admin secret, CORS) BEFORE any
    // src module imports src/config.ts.
    setupFiles: ['./tests/integration/setup.ts'],
    // Run serially to avoid Redis key collisions across integration suites.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
    hookTimeout: 20000,
    reporters: 'default',
  },
});
