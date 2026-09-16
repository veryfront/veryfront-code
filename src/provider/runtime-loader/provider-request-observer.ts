import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "#veryfront/utils";

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

/** Receives provider request notifications within one async scope. */
export interface ProviderRequestObserver {
  onRetry?: (event: ProviderRequestRetryEvent) => void;
}

const providerRequestObserverStorage = new AsyncLocalStorage<ProviderRequestObserver>();

/**
 * Run `fn` with an observer that sees every provider request retry issued
 * inside it, including retries of nested agent and model calls.
 */
export function runWithProviderRequestObserver<T>(
  observer: ProviderRequestObserver,
  fn: () => T,
): T {
  return providerRequestObserverStorage.run(observer, fn);
}

/**
 * Report a provider request retry to the debug log and to the observer active
 * in the current async scope. An observer that throws never affects the
 * request.
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
  const observer = providerRequestObserverStorage.getStore();
  if (!observer?.onRetry) return;
  try {
    observer.onRetry(event);
  } catch {
    // Observers are advisory and must not change request behavior.
  }
}
