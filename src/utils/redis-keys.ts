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

// [F3] Idempotency-Key dedupe. Maps a (userId, client-supplied key) pair to the
// jobId that was created for the first request, so retried POST /run calls return
// the original job instead of enqueuing a duplicate. Scoped per-user so keys from
// different users can never collide.
export const getIdempotencyKey = (userId: string, key: string): string =>
  `idem:run:${userId}:${key}`;

// [F3] Format guard for a client-supplied Idempotency-Key: short, opaque, no
// control chars, so it is safe to embed directly in a Redis key.
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
export const isValidIdempotencyKey = (key: string): boolean =>
  IDEMPOTENCY_KEY_RE.test(key);

// === LIVE CHANNEL (Step 16) ===
// Pub/Sub channel name for a job's live events.
export const getLiveChannel = (userId: string, jobId: string): string =>
  `live:ch:${userId}:${jobId}`;

// Short replay buffer (Redis list) so a late subscriber can fetch recent events.
export const getLiveBufferKey = (userId: string, jobId: string): string =>
  `live:buf:${userId}:${jobId}`;

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

// === WORKFLOW STORAGE (Step 17, category G2) ===
// A saved workflow is a reusable, versioned bundle of steps owned by a user.
// Storage layout (all per-user scoped so ids from different users never clash):
//   wf:meta:<userId>:<workflowId>          -> JSON of the current Workflow record
//   wf:index:<userId>                       -> SET of that user's workflow ids
//   wf:ver:<userId>:<workflowId>:<version>  -> JSON snapshot of a past version
//   wf:verindex:<userId>:<workflowId>       -> SET of version numbers kept in history

export const getWorkflowKey = (userId: string, workflowId: string): string =>
  `wf:meta:${userId}:${workflowId}`;

export const getUserWorkflowsKey = (userId: string): string =>
  `wf:index:${userId}`;

export const getWorkflowVersionKey = (
  userId: string,
  workflowId: string,
  version: number
): string => `wf:ver:${userId}:${workflowId}:${version}`;

export const getWorkflowVersionIndexKey = (
  userId: string,
  workflowId: string
): string => `wf:verindex:${userId}:${workflowId}`;

// Workflow ids are server-generated, but we validate any externally-supplied id
// (e.g. on GET/PUT/DELETE) before embedding it in a Redis key.
const WORKFLOW_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const isValidWorkflowId = (id: string): boolean =>
  WORKFLOW_ID_RE.test(id);
