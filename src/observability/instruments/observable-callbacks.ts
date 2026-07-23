import type {
  ObservableGauge,
  ObservableResult,
} from "#veryfront/observability/tracing/api-shim.ts";

export type ObservableCallback = (result: ObservableResult) => void;

export interface ObservableCallbackBinding {
  instrument: ObservableGauge;
  callback: ObservableCallback;
}

/**
 * Install callbacks as one reversible transaction.
 *
 * OpenTelemetry observable instruments support `removeCallback`. Requiring it
 * before the first registration prevents a partially compatible provider from
 * leaving callbacks behind when a later registration fails.
 */
export function installObservableCallbacks(
  bindings: readonly ObservableCallbackBinding[],
): () => void {
  for (const { instrument } of bindings) {
    if (typeof instrument.addCallback !== "function") {
      throw new TypeError("Observable instrument must implement addCallback()");
    }
    if (typeof instrument.removeCallback !== "function") {
      throw new TypeError("Observable instrument must implement removeCallback()");
    }
  }

  const installed: ObservableCallbackBinding[] = [];
  try {
    for (const binding of bindings) {
      binding.instrument.addCallback(binding.callback);
      installed.push(binding);
    }
  } catch (error) {
    for (let index = installed.length - 1; index >= 0; index--) {
      const binding = installed[index]!;
      try {
        binding.instrument.removeCallback?.(binding.callback);
      } catch (_) {
        /* expected: continue rolling back every provider callback */
      }
    }
    throw error;
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (let index = installed.length - 1; index >= 0; index--) {
      const binding = installed[index]!;
      try {
        binding.instrument.removeCallback?.(binding.callback);
      } catch (_) {
        /* expected: shutdown remains fail-open if a provider rejects cleanup */
      }
    }
  };
}
