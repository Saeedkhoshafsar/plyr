import { describe, it, expect } from 'vitest';
import { toCsv, csvEscape } from '../../src/pipeline';

// Step 11 (category E3): CSV export serializer used by the `export-data` action.
// These are pure-function tests — no Redis / browser / pipeline execution needed.

describe('csvEscape', () => {
  it('passes plain values through unchanged', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(0)).toBe('0');
  });

  it('renders null/undefined as empty string', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('quotes and escapes values containing comma, quote or newline', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('serializes objects/arrays as JSON', () => {
    expect(csvEscape({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('toCsv', () => {
  it('serializes an array of objects with a union header', () => {
    const rows = [
      { name: 'a', price: 10 },
      { name: 'b', qty: 3 },
    ];
    const csv = toCsv(rows);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('name,price,qty');
    expect(lines[1]).toBe('a,10,');
    expect(lines[2]).toBe('b,,3');
  });

  it('serializes an array of scalars as a single column', () => {
    expect(toCsv(['x', 'y', 'z'])).toBe('x\r\ny\r\nz');
  });

  it('serializes a single object as key,value pairs', () => {
    const csv = toCsv({ title: 'Hello', count: 2 });
    expect(csv.split('\r\n')).toEqual(['key,value', 'title,Hello', 'count,2']);
  });

  it('returns empty string for an empty array', () => {
    expect(toCsv([])).toBe('');
  });

  it('serializes a scalar as a single cell', () => {
    expect(toCsv('just text')).toBe('just text');
    expect(toCsv(123)).toBe('123');
  });

  it('escapes embedded commas/quotes inside object rows', () => {
    const csv = toCsv([{ a: 'x,y', b: 'q"q' }]);
    expect(csv.split('\r\n')[1]).toBe('"x,y","q""q"');
  });
});
