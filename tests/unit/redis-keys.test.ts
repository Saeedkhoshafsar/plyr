import { describe, it, expect } from 'vitest';
import {
  getUserActiveJobsKey,
  getUserLockKey,
  getIdempotencyKey,
  isValidIdempotencyKey,
  getLiveChannel,
  getLiveBufferKey,
  getWorkflowKey,
  getUserWorkflowsKey,
  getWorkflowVersionKey,
  getWorkflowVersionIndexKey,
  isValidWorkflowId,
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

describe('workflow key builders (G2)', () => {
  it('builds per-user-scoped workflow keys', () => {
    expect(getWorkflowKey('u1', 'wf_abc')).toBe('wf:meta:u1:wf_abc');
    expect(getUserWorkflowsKey('u1')).toBe('wf:index:u1');
    expect(getWorkflowVersionKey('u1', 'wf_abc', 3)).toBe('wf:ver:u1:wf_abc:3');
    expect(getWorkflowVersionIndexKey('u1', 'wf_abc')).toBe('wf:verindex:u1:wf_abc');
  });

  it('scopes workflow keys so different users cannot collide', () => {
    expect(getWorkflowKey('u1', 'wf_x')).not.toBe(getWorkflowKey('u2', 'wf_x'));
  });
});

describe('isValidWorkflowId', () => {
  it('accepts server-style ids', () => {
    expect(isValidWorkflowId('wf_0123abcd4567ef89')).toBe(true);
    expect(isValidWorkflowId('my-workflow_1')).toBe(true);
  });

  it('rejects empty, oversized, or unsafe ids', () => {
    expect(isValidWorkflowId('')).toBe(false);
    expect(isValidWorkflowId('a'.repeat(65))).toBe(false);
    expect(isValidWorkflowId('has space')).toBe(false);
    expect(isValidWorkflowId('colon:bad')).toBe(false);
    expect(isValidWorkflowId('slash/x')).toBe(false);
  });
});
