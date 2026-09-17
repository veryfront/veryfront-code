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
 * Observers are held in a stack rather than one variable, and kept out of
 * `AsyncLocalStorage` on purpose: `node:async_hooks` here would pull the Node
 * global types into the provider type graph, which changes how `fetch` types
 * resolve for unrelated test entry points. The newest scope receives the
 * notifications, and a scope that ends removes its own entry, so overlapping
 * scopes cannot restore a stale observer over a live one.
 */
const observerStack: ProviderRequestObserver[] = [];

/**
 * Run `fn` with an observer that sees provider request retries issued while it
 * runs, including retries of nested agent and model calls. Notifications go to
 * the most recently entered scope.
 */
export async function runWithProviderRequestObserver<T>(
  observer: ProviderRequestObserver,
  fn: () => Promise<T>,
): Promise<T> {
  observerStack.push(observer);
  try {
    return await fn();
  } finally {
    const index = observerStack.lastIndexOf(observer);
    if (index !== -1) observerStack.splice(index, 1);
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
  const observer = observerStack.at(-1);
  if (!observer?.onRetry) return;
  try {
    // An async observer rejects after this frame returns, so contain that too:
    // an unhandled rejection can take the process down.
    void Promise.resolve(observer.onRetry(event)).catch(() => {});
  } catch {
    // Observers are advisory and must not change request behavior.
  }
}
