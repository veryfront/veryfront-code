/**
 * Compose cancellation sources without depending on `AbortSignal.any`, which
 * is absent from early Node 18 releases still covered by the npm engine range.
 * The first source to abort owns the exact propagated reason, and listeners on
 * every remaining source are detached immediately.
 */
export function composeAbortSignals(
  signals: readonly AbortSignal[],
): AbortSignal {
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();

  const detachAll = (): void => {
    for (const [signal, listener] of listeners) {
      signal.removeEventListener("abort", listener);
    }
    listeners.clear();
  };

  const abortFrom = (signal: AbortSignal): void => {
    if (controller.signal.aborted) return;
    detachAll();
    controller.abort(signal.reason);
  };

  for (const signal of new Set(signals)) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const listener = () => abortFrom(signal);
    listeners.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }

  return controller.signal;
}
