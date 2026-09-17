import { AsyncLocalStorage } from "#veryfront/platform/compat/async-context.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";

/** A provider request that failed transiently and is about to be sent again. */
export interface ProviderRequestRetryEvent {
  /** Provider label the request was sent through. */
  providerLabel: string;
  /** Model the request is for, when the caller supplied one. */
  modelId?: string;
  /** HTTP status of the failed attempt, or `"timeout"` / `"stream interrupted"`. */
  reason: string;
  /** One-based number of the attempt about to be sent. */
  attempt: number;
  /** Most attempts the request can make, counting the first one. */
  maxAttempts: number;
  /** Wait before the next attempt, in milliseconds. */
  delayMs: number;
}

/** Receives provider request notifications while a scope is active. */
export interface ProviderRequestObserver {
  onRetry?: (event: ProviderRequestRetryEvent) => void | Promise<void>;
}

const observerStorage = new AsyncLocalStorage<ProviderRequestObserver>();

/**
 * Run `fn` with an observer that sees provider request retries issued while it
 * runs, including retries of nested agent and model calls. The observer is
 * bound to the async execution context, so overlapping scopes each see only
 * their own requests.
 */
export async function runWithProviderRequestObserver<T>(
  observer: ProviderRequestObserver,
  fn: () => Promise<T>,
): Promise<T> {
  return await observerStorage.run(observer, fn);
}

/**
 * Report a provider request retry to the debug log and to the active observer.
 * An observer that throws, or whose promise rejects, never affects the request.
 */
export function notifyProviderRequestRetry(event: ProviderRequestRetryEvent): void {
  logger.debug("Provider request retrying", {
    provider: event.providerLabel,
    ...(event.modelId === undefined ? {} : { model: event.modelId }),
    reason: event.reason,
    attempt: event.attempt,
    maxAttempts: event.maxAttempts,
    delayMs: event.delayMs,
  });
  const observer = observerStorage.getStore();
  if (!observer?.onRetry) return;
  try {
    // An async observer rejects after this frame returns, so contain that too:
    // an unhandled rejection can take the process down.
    void Promise.resolve(observer.onRetry(event)).catch(() => {});
  } catch {
    // Observers are advisory and must not change request behavior.
  }
}
