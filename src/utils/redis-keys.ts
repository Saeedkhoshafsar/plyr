export const STATS_KEY = {
  TOTAL_JOBS: 'stats:jobs:total',
  TOTAL_FAILED: 'stats:jobs:failed',
  TOTAL_STEPS: 'stats:steps:total',
  TOTAL_SUCCESS: 'stats:jobs:success',
  MODULE_USAGE_ZSET: 'stats:modules:usage:zset',
} as const;

export const getUserActiveJobsKey = (userId: string): string =>
  `user:active_jobs:${userId}`;

export const getUserLockKey = (userId: string): string =>
  `user:lock:${userId}`;