import { logger } from "./logger";
import { sleep } from "./humanDelay";

export interface RetryOptions {
  label: string;
  retries?: number;
  delaysMs?: number[];
}

export const withRetry = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> => {
  const retries = options.retries ?? 4;
  const delaysMs = options.delaysMs ?? [1_000, 2_000, 4_000, 8_000];

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isFinalAttempt = attempt >= retries;

      logger.warn(`Retryable operation failed: ${options.label}`, {
        attempt: attempt + 1,
        retries: retries + 1,
        isFinalAttempt,
        error: error instanceof Error ? error.message : String(error),
      });

      if (isFinalAttempt) {
        break;
      }

      const waitTime = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? delaysMs[delaysMs.length - 1];
      await sleep(waitTime);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Operation failed: ${options.label}`);
};
