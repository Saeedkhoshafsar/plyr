import type { PlanConfig } from './config';
import { config } from './config';

// === REGEX PATTERNS ===
const SAFE_MODULE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/;
const SAFE_USER_ID_REGEX = /^[a-zA-Z0-9_-]{1,50}$/;

// === PRIVATE IP PATTERNS (for SSRF protection) ===
const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // Loopback
  /^10\./,                           // Private Class A
  /^192\.168\./,                     // Private Class C
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Private Class B
  /^0\./,                            // Current network
  /^169\.254\./,                     // Link-local
  /^::1$/,                           // IPv6 Loopback
  /^fc00:/i,                         // IPv6 Unique local
  /^fe80:/i,                         // IPv6 Link-local
  /^fd[0-9a-f]{2}:/i,                // IPv6 Unique local
];

const BLOCKED_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  '169.254.169.254',
  'metadata',
  'kubernetes.default',
];

// === INTERFACES ===
export interface StepInput {
  action: string;
  params?: Record<string, any>;
  saveAs?: string;
  condition?: any;
  then?: StepInput[];
  else?: StepInput[];
  steps?: StepInput[];
  catch?: StepInput[];
  finally?: StepInput[];
  cases?: Record<string, StepInput[]>;
  [key: string]: any;
}

// === SANITIZATION FUNCTIONS ===

export const sanitizeModuleName = (name: unknown): string => {
  if (typeof name !== 'string') {
    throw new Error('Module name must be a string');
  }

  const trimmed = name.trim();

  if (!SAFE_MODULE_NAME_REGEX.test(trimmed)) {
    throw new Error(`Invalid module name format: "${trimmed}". Use alphanumeric characters, dashes, and underscores only.`);
  }

  return trimmed;
};

export const sanitizeUserId = (id: unknown): string => {
  const str = String(id ?? '').trim();

  if (str.length === 0) {
    throw new Error('userId cannot be empty');
  }

  if (!SAFE_USER_ID_REGEX.test(str)) {
    throw new Error('Invalid userId format. Use alphanumeric characters, dashes, or underscores (1-50 chars).');
  }

  return str;
};

export const sanitizeLogMessage = (msg: unknown): string => {
  if (typeof msg !== 'string') {
    return String(msg ?? '');
  }

  return msg
    .replace(/[\r\n]/g, ' ')           // Remove newlines (log injection)
    .replace(/\x1b\[[0-9;]*m/g, '')    // Remove ANSI escape codes
    .replace(/[\x00-\x1f\x7f]/g, '')   // Remove control characters
    .substring(0, 500);                 // Limit length
};

// === PRIVATE IP CHECK (SSRF Protection) ===

const isPrivateIP = (hostname: string): boolean => {
  const lowerHost = hostname.toLowerCase();

  // Check blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(lowerHost)) {
    return true;
  }

  // Check IP patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }

  return false;
};

// === WEBHOOK VALIDATION ===

export const validateWebhookUrl = (url: unknown): string | null => {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const trimmed = url.trim();

  if (trimmed.length === 0 || trimmed.length > 2048) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);

    // Only allow http/https
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }

    // Block private IPs unless explicitly allowed
    if (!config.WEBHOOK_ALLOW_PRIVATE_IPS && isPrivateIP(parsed.hostname)) {
      console.warn(`[SECURITY] Blocked webhook to private IP: ${parsed.hostname}`);
      return null;
    }

    // Block credentials in URL
    if (parsed.username || parsed.password) {
      return null;
    }

    return trimmed;
  } catch {
    return null;
  }
};

// === HEADLESS VALIDATION ===

export const validateHeadless = (value: unknown, defaultValue: boolean = true): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  return defaultValue;
};

// === STEPS VALIDATION ===

export const validateSteps = (input: unknown, userPlan?: PlanConfig): StepInput[] => {
  if (!Array.isArray(input)) {
    throw new Error('Steps must be an array');
  }

  if (input.length === 0) {
    throw new Error('Steps cannot be empty');
  }

  const maxSteps = userPlan?.maxSteps || 200;
  if (input.length > maxSteps) {
    throw new Error(`Maximum ${maxSteps} steps allowed for your plan`);
  }

  // Check total size
  const jsonSize = JSON.stringify(input).length;
  if (jsonSize > 1024 * 100) { // 100KB
    throw new Error('Steps data too large (max 100KB)');
  }

  const mapStep = (step: any, index: number): StepInput => {
    if (typeof step !== 'object' || step === null) {
      throw new Error(`Step at index ${index} must be an object`);
    }

    // Validate action name
    const action = sanitizeModuleName(step.action);

    // Extract params
    let params: Record<string, any> = {};

    if (step.params && typeof step.params === 'object' && !Array.isArray(step.params)) {
      params = step.params;
    } else {
      // Legacy format: params are in step directly
      const {
        action: _,
        saveAs: __,
        condition: ___,
        then: ____,
        else: _____,
        steps: ______,
        catch: _______,
        finally: ________,
        cases: _________,
        ...rest
      } = step;

      if (Object.keys(rest).length > 0) {
        params = rest;
      }
    }

    const cleanStep: StepInput = { action, params };

    // Optional fields
    if (step.saveAs && typeof step.saveAs === 'string') {
      cleanStep.saveAs = step.saveAs.trim();
    }

    if (step.condition) {
      cleanStep.condition = step.condition;
    }

    if (step.cases && typeof step.cases === 'object') {
      cleanStep.cases = {};
      for (const [key, steps] of Object.entries(step.cases)) {
        if (Array.isArray(steps)) {
          cleanStep.cases[key] = steps.map((s: any, i: number) => mapStep(s, i));
        }
      }
    }

    // Recursive validation for nested steps
    if (Array.isArray(step.then)) {
      cleanStep.then = step.then.map((s: any, i: number) => mapStep(s, i));
    }

    if (Array.isArray(step.else)) {
      cleanStep.else = step.else.map((s: any, i: number) => mapStep(s, i));
    }

    if (Array.isArray(step.steps)) {
      cleanStep.steps = step.steps.map((s: any, i: number) => mapStep(s, i));
    }

    if (Array.isArray(step.catch)) {
      cleanStep.catch = step.catch.map((s: any, i: number) => mapStep(s, i));
    }

    if (Array.isArray(step.finally)) {
      cleanStep.finally = step.finally.map((s: any, i: number) => mapStep(s, i));
    }

    return cleanStep;
  };

  return input.map((step, index) => mapStep(step, index));
};