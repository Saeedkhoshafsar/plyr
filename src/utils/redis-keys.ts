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

// [C6] Non-blocking replacement for KEYS. Iterates with SCAN so it never blocks
// the Redis event loop (KEYS is O(N) over the whole keyspace).
export const scanKeys = async (
  redis: { scan: (...args: any[]) => Promise<[string, string[]]> },
  pattern: string,
  batch = 200
): Promise<string[]> => {
  let cursor = '0';
  const found: string[] = [];
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', batch);
    cursor = next;
    if (keys.length) found.push(...keys);
  } while (cursor !== '0');
  return found;
};
