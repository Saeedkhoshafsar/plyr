import { config } from '../config';
import type { WebhookPayload } from '../types';

export const sendWebhook = async (
  url: string,
  payload: WebhookPayload,
  maxRetries: number = config.WEBHOOK_MAX_RETRIES
): Promise<void> => {
  const baseBackoff = config.WEBHOOK_RETRY_BACKOFF_MS;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.WEBHOOK_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `AutomationBackend/${config.VERSION}`,
          'X-Webhook-Attempt': String(attempt)
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        if (attempt > 1) {
          console.log(`[WEBHOOK] ✓ Sent to ${url} (succeeded on attempt ${attempt})`);
        } else {
          console.log(`[WEBHOOK] ✓ Sent to ${url}`);
        }
        return;
      }

      // Don't retry client errors (except 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        console.log(`[WEBHOOK] ✗ Client error ${response.status} from ${url}, not retrying`);
        return;
      }

      throw new Error(`HTTP ${response.status}`);

    } catch (err: unknown) {
      const error = err as Error & { name?: string };
      const isLastAttempt = attempt === maxRetries;
      const errorMsg = error.name === 'AbortError' ? 'Timeout' : error.message;

      if (isLastAttempt) {
        console.log(`[WEBHOOK] ✗ Failed to send to ${url} after ${maxRetries} attempts: ${errorMsg}`);
        return;
      }

      const delay = baseBackoff * Math.pow(2, attempt - 1);
      console.log(`[WEBHOOK] ⚠️ Attempt ${attempt} failed (${errorMsg}), retrying in ${delay}ms...`);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};