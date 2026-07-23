/** Return the caller-provided abort reason, or a standard abort error. */
export function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined
    ? new DOMException("The operation was aborted", "AbortError")
    : signal.reason;
}

/** Race an operation with cancellation and always dispose the listener. */
export function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(getAbortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(getAbortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
