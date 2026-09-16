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

/**
 * The observer is process-wide rather than async-local on purpose. An
 * `AsyncLocalStorage` here would pull `node:async_hooks` (and with it the Node
 * global types) into the provider type graph, which changes how `fetch` types
 * resolve for unrelated test entry points. A single-command surface such as
 * `veryfront eval` installs one observer for the whole run, so the simpler
 * scope is enough. Nested scopes restore the previous observer on exit.
 */
let currentObserver: ProviderRequestObserver | undefined;

/**
 * Run `fn` with an observer that sees provider request retries issued while it
 * runs, including retries of nested agent and model calls.
 */
export async function runWithProviderRequestObserver<T>(
  observer: ProviderRequestObserver,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = currentObserver;
  currentObserver = observer;
  try {
    return await fn();
  } finally {
    currentObserver = previous;
  }
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
  const observer = currentObserver;
  if (!observer?.onRetry) return;
  try {
    // An async observer rejects after this frame returns, so contain that too:
    // an unhandled rejection can take the process down.
    void Promise.resolve(observer.onRetry(event)).catch(() => {});
  } catch {
    // Observers are advisory and must not change request behavior.
  }
}
