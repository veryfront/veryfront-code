import { AsyncLocalStorage } from "#veryfront/platform/compat/async-context.ts";

const requestPreparationSignalStorage = new AsyncLocalStorage<AbortSignal>();

/** Return the inbound request signal while hosted execution preparation is active. */
export function getHostedRequestPreparationSignal(): AbortSignal | undefined {
  return requestPreparationSignalStorage.getStore();
}

/** Resolve the active inbound signal or a fresh signal for direct preparation calls. */
export function resolveHostedRequestPreparationSignal(): AbortSignal {
  return getHostedRequestPreparationSignal() ?? new AbortController().signal;
}

/** Run hosted execution preparation with its inbound request cancellation context. */
export function runWithHostedRequestPreparationSignal<TResult>(
  signal: AbortSignal,
  operation: () => TResult,
): TResult {
  return requestPreparationSignalStorage.run(signal, operation);
}
