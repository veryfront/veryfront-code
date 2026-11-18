import { INVALID_ARGUMENT } from "#veryfront/errors";

/**
 * Wait for the owning API to take over a tool call. The API parks the run from
 * the persisted tool call and cancels this turn; its next dispatch carries the
 * tool result in the replay messages. So the returned promise never resolves:
 * it rejects with the cancellation reason, which the runtime does not persist
 * as a tool error.
 */
export function waitForControlPlaneReplay(
  signal: AbortSignal | undefined,
  missingSignalDetail: string,
): Promise<never> {
  if (!signal) {
    throw INVALID_ARGUMENT.create({ detail: missingSignalDetail });
  }
  return new Promise((_resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("Execution suspended", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
