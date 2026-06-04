import { describe, it, expect } from 'vitest';
import {
  sanitizeUserId,
  sanitizeModuleName,
  sanitizeLogMessage,
  validateWebhookUrl,
  validateHeadless,
  validateSteps,
} from '../../src/validation';

describe('sanitizeUserId', () => {
  it('accepts valid ids and trims', () => {
    expect(sanitizeUserId('user_1')).toBe('user_1');
    expect(sanitizeUserId('  abc-123 ')).toBe('abc-123');
    expect(sanitizeUserId(42)).toBe('42');
  });
  it('rejects empty', () => {
    expect(() => sanitizeUserId('')).toThrow(/cannot be empty/);
    expect(() => sanitizeUserId('   ')).toThrow(/cannot be empty/);
    expect(() => sanitizeUserId(null)).toThrow(/cannot be empty/);
  });
  it('rejects illegal characters and over-length', () => {
    expect(() => sanitizeUserId('bad id')).toThrow(/Invalid userId/);
    expect(() => sanitizeUserId('a/b')).toThrow(/Invalid userId/);
    expect(() => sanitizeUserId('x'.repeat(51))).toThrow(/Invalid userId/);
  });
});

describe('sanitizeModuleName', () => {
  it('accepts valid action names', () => {
    expect(sanitizeModuleName('goto')).toBe('goto');
    expect(sanitizeModuleName('set_variable')).toBe('set_variable');
    expect(sanitizeModuleName('http-fetch')).toBe('http-fetch');
  });
  it('requires a leading letter', () => {
    expect(() => sanitizeModuleName('1bad')).toThrow(/Invalid module name/);
    expect(() => sanitizeModuleName('_x')).toThrow(/Invalid module name/);
  });
  it('rejects non-strings and bad characters', () => {
    expect(() => sanitizeModuleName(123)).toThrow(/must be a string/);
    expect(() => sanitizeModuleName('a.b')).toThrow(/Invalid module name/);
    expect(() => sanitizeModuleName('a b')).toThrow(/Invalid module name/);
  });
});

describe('sanitizeLogMessage', () => {
  it('strips newlines (log injection) and control chars', () => {
    expect(sanitizeLogMessage('line1\nline2\rline3')).toBe('line1 line2 line3');
    expect(sanitizeLogMessage('a\x00b\x07c')).toBe('abc');
  });
  it('strips ANSI escape codes', () => {
    expect(sanitizeLogMessage('\x1b[31mred\x1b[0m')).toBe('red');
  });
  it('coerces non-strings and truncates to 500 chars', () => {
    expect(sanitizeLogMessage(123)).toBe('123');
    expect(sanitizeLogMessage('x'.repeat(600)).length).toBe(500);
  });
});

describe('validateWebhookUrl', () => {
  it('accepts public http/https URLs', () => {
    expect(validateWebhookUrl('https://example.com/hook')).toBe('https://example.com/hook');
    expect(validateWebhookUrl('http://example.org')).toBe('http://example.org');
  });
  it('rejects non-strings, empty, and over-length', () => {
    expect(validateWebhookUrl(null)).toBeNull();
    expect(validateWebhookUrl('')).toBeNull();
    expect(validateWebhookUrl('https://x.com/' + 'a'.repeat(2100))).toBeNull();
  });
  it('rejects non-http(s) protocols', () => {
    expect(validateWebhookUrl('ftp://example.com')).toBeNull();
    expect(validateWebhookUrl('javascript:alert(1)')).toBeNull();
    expect(validateWebhookUrl('file:///etc/passwd')).toBeNull();
  });
  it('blocks private IPs and metadata endpoints (SSRF protection)', () => {
    expect(validateWebhookUrl('http://127.0.0.1/x')).toBeNull();
    expect(validateWebhookUrl('http://localhost/x')).toBeNull();
    expect(validateWebhookUrl('http://10.0.0.5/x')).toBeNull();
    expect(validateWebhookUrl('http://192.168.1.1/x')).toBeNull();
    expect(validateWebhookUrl('http://169.254.169.254/latest/meta-data')).toBeNull();
  });
  it('rejects credentials embedded in URL', () => {
    expect(validateWebhookUrl('https://user:pass@example.com')).toBeNull();
  });
});

describe('validateHeadless', () => {
  it('passes through booleans', () => {
    expect(validateHeadless(true)).toBe(true);
    expect(validateHeadless(false)).toBe(false);
  });
  it('coerces string and number variants', () => {
    expect(validateHeadless('true')).toBe(true);
    expect(validateHeadless('1')).toBe(true);
    expect(validateHeadless('no')).toBe(false);
    expect(validateHeadless(0)).toBe(false);
    expect(validateHeadless(5)).toBe(true);
  });
  it('falls back to default for unknown input', () => {
    expect(validateHeadless('weird')).toBe(true); // default true
    expect(validateHeadless(undefined, false)).toBe(false);
    expect(validateHeadless({}, false)).toBe(false);
  });
});

describe('validateSteps', () => {
  it('accepts a minimal valid step array', () => {
    const out = validateSteps([{ action: 'goto', params: { url: 'https://example.com' } }]);
    expect(Array.isArray(out)).toBe(true);
    expect(out[0].action).toBe('goto');
  });
  it('rejects non-arrays and empty arrays', () => {
    expect(() => validateSteps('nope' as unknown)).toThrow(/must be an array/);
    expect(() => validateSteps([])).toThrow(/cannot be empty/);
  });
  it('enforces the plan maxSteps limit', () => {
    const many = Array.from({ length: 6 }, () => ({ action: 'log', params: { message: 'x' } }));
    expect(() => validateSteps(many, { maxSteps: 5 } as never)).toThrow(/Maximum 5 steps/);
  });
  it('rejects steps with an invalid action name', () => {
    expect(() => validateSteps([{ action: '1bad' }])).toThrow(/Invalid module name/);
    expect(() => validateSteps([{ action: 123 }])).toThrow(/must be a string/);
  });
  it('rejects a non-object step entry', () => {
    expect(() => validateSteps(['not-an-object'])).toThrow(/must be an object/);
  });
});
