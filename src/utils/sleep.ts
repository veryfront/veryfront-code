/** Resolve after `ms` milliseconds; rejects with `abortSignal.reason` if aborted first. */
export function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  abortSignal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(abortSignal?.reason);
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();
  });
}
