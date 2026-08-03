import { normalizeTimerDurationMs } from "./timer.ts";

/**
 * Return a promise that resolves after `ms` milliseconds.
 *
 * Throws `RangeError` synchronously when `ms` is negative, non-finite, or
 * exceeds the portable JavaScript timer range. The returned promise rejects
 * with `abortSignal.reason` if the signal is aborted first.
 */
export function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  const durationMs = normalizeTimerDurationMs(ms, "Sleep duration");
  abortSignal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);
    const onAbort = () => {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(abortSignal?.reason);
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();
  });
}
