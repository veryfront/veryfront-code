import { normalizeTimerDurationMs } from "./timer.ts";

/** Resolve after `ms` milliseconds; rejects with `abortSignal.reason` if aborted first. */
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
