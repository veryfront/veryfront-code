export function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason ??
    new DOMException("The operation was aborted", "AbortError");
}

export function combineAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const unique = [
    ...new Set(signals.filter((signal): signal is AbortSignal => signal !== undefined)),
  ];
  if (unique.length === 0) return undefined;
  if (unique.length === 1) return unique[0];
  return AbortSignal.any(unique);
}

/**
 * Stop waiting when the caller disconnects without cancelling shared or
 * dependency-accounted work. The producer remains observed, so a later
 * rejection cannot become unhandled.
 */
export function raceWithCallerAbort<T>(
  producer: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return producer;
  if (signal.aborted) return Promise.reject(getAbortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener("abort", abort);
      reject(getAbortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });

    producer.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/** Whether a dependency rejection was caused by this exact caller signal. */
export function isCallerAbort(error: unknown, signal?: AbortSignal): boolean {
  if (!signal?.aborted) return false;
  return error === getAbortReason(signal);
}
