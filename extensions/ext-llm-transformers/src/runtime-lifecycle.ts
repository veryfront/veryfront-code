/** Lifecycle fence shared by runtimes created by one extension setup generation. */
export interface LocalRuntimeLifecycle {
  readonly signal: AbortSignal;
  assertActive(): void;
}

export interface LinkedAbortSignal {
  readonly signal: AbortSignal | undefined;
  cleanup(): void;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/** Link caller and extension-lifecycle cancellation without relying on AbortSignal.any(). */
export function linkAbortSignals(
  ...candidates: Array<AbortSignal | undefined>
): LinkedAbortSignal {
  const signals = [
    ...new Set(candidates.filter((value): value is AbortSignal => value !== undefined)),
  ];
  if (signals.length === 0) return { signal: undefined, cleanup() {} };
  if (signals.length === 1) return { signal: signals[0], cleanup() {} };

  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  for (const signal of signals) {
    const forward = () => {
      if (!controller.signal.aborted) controller.abort(abortReason(signal));
    };
    listeners.set(signal, forward);
    if (signal.aborted) {
      forward();
      break;
    }
    signal.addEventListener("abort", forward, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      for (const [signal, listener] of listeners) {
        signal.removeEventListener("abort", listener);
      }
      listeners.clear();
    },
  };
}
