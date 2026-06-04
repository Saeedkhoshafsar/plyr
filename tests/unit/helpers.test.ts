import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  parseNumber,
  parseInteger,
  parseBoolean,
  securePath,
  isVipUser,
} from '../../src/utils/helpers';

describe('parseNumber', () => {
  it('passes through finite numbers', () => {
    expect(parseNumber(5)).toBe(5);
    expect(parseNumber(5.5)).toBe(5.5);
    expect(parseNumber(0)).toBe(0);
    expect(parseNumber(-3)).toBe(-3);
  });
  it('parses numeric strings', () => {
    expect(parseNumber('5')).toBe(5);
    expect(parseNumber('5.5')).toBe(5.5);
    expect(parseNumber('  12 ')).toBe(12); // parseFloat tolerates leading space
  });
  it('returns undefined for empty / null / undefined', () => {
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber(null)).toBeUndefined();
    expect(parseNumber(undefined)).toBeUndefined();
  });
  it('returns undefined for NaN and non-parseable input', () => {
    expect(parseNumber(NaN)).toBeUndefined();
    expect(parseNumber('abc')).toBeUndefined();
    expect(parseNumber({})).toBeUndefined();
    expect(parseNumber([])).toBeUndefined();
  });
});

describe('parseInteger', () => {
  it('floors numeric values', () => {
    expect(parseInteger(5.9)).toBe(5);
    expect(parseInteger('7.99')).toBe(7);
    expect(parseInteger(10)).toBe(10);
  });
  it('returns undefined for invalid input', () => {
    expect(parseInteger('xyz')).toBeUndefined();
    expect(parseInteger(undefined)).toBeUndefined();
  });
});

describe('parseBoolean', () => {
  it('passes through booleans', () => {
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean(false)).toBe(false);
  });
  it('coerces truthy/falsy strings', () => {
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('TRUE')).toBe(true);
    expect(parseBoolean('1')).toBe(true);
    expect(parseBoolean('yes')).toBe(true);
    expect(parseBoolean('false')).toBe(false);
    expect(parseBoolean('0')).toBe(false);
    expect(parseBoolean('no')).toBe(false);
  });
  it('coerces numbers (0 = false, else true)', () => {
    expect(parseBoolean(1)).toBe(true);
    expect(parseBoolean(42)).toBe(true);
    expect(parseBoolean(0)).toBe(false);
  });
  it('returns undefined for unknown strings / null / undefined', () => {
    expect(parseBoolean('maybe')).toBeUndefined();
    expect(parseBoolean(null)).toBeUndefined();
    expect(parseBoolean(undefined)).toBeUndefined();
  });
});

describe('securePath', () => {
  const base = '/srv/data';
  it('resolves safe sub-paths', () => {
    expect(securePath(base, 'user', 'file.json')).toBe(path.resolve(base, 'user', 'file.json'));
    expect(securePath(base, 'a/b/c')).toBe(path.resolve(base, 'a/b/c'));
  });
  it('throws on path traversal attempts', () => {
    expect(() => securePath(base, '../etc/passwd')).toThrow(/Path Traversal/);
    expect(() => securePath(base, '..', '..', 'root')).toThrow(/Path Traversal/);
  });
});

describe('isVipUser', () => {
  it('returns true when priority is below threshold', () => {
    expect(isVipUser(10, 100)).toBe(true);
    expect(isVipUser(99, 100)).toBe(true);
  });
  it('returns false when priority equals or exceeds threshold', () => {
    expect(isVipUser(100, 100)).toBe(false);
    expect(isVipUser(150, 100)).toBe(false);
  });
});
