import { describe, it, expect } from 'vitest';
import {
  getUserActiveJobsKey,
  getUserLockKey,
  getIdempotencyKey,
  isValidIdempotencyKey,
  getLiveChannel,
  getLiveBufferKey,
} from '../../src/utils/redis-keys';

describe('redis key builders', () => {
  it('builds stable, namespaced keys', () => {
    expect(getUserActiveJobsKey('u1')).toBe('user:active_jobs:u1');
    expect(getUserLockKey('u1')).toBe('user:lock:u1');
    expect(getLiveChannel('u1', '42')).toBe('live:ch:u1:42');
    expect(getLiveBufferKey('u1', '42')).toBe('live:buf:u1:42');
  });

  it('scopes idempotency keys per user so they cannot collide', () => {
    expect(getIdempotencyKey('u1', 'abc')).toBe('idem:run:u1:abc');
    expect(getIdempotencyKey('u1', 'abc')).not.toBe(getIdempotencyKey('u2', 'abc'));
  });
});

describe('isValidIdempotencyKey', () => {
  it('accepts opaque tokens with the allowed charset', () => {
    expect(isValidIdempotencyKey('abc123')).toBe(true);
    expect(isValidIdempotencyKey('order_2024-01-15.run:1')).toBe(true);
    expect(isValidIdempotencyKey('A'.repeat(200))).toBe(true);
  });

  it('rejects empty, oversized, or control-char keys', () => {
    expect(isValidIdempotencyKey('')).toBe(false);
    expect(isValidIdempotencyKey('A'.repeat(201))).toBe(false);
    expect(isValidIdempotencyKey('has space')).toBe(false);
    expect(isValidIdempotencyKey('new\nline')).toBe(false);
    expect(isValidIdempotencyKey('emoji😀')).toBe(false);
    expect(isValidIdempotencyKey('slash/x')).toBe(false);
  });
});
