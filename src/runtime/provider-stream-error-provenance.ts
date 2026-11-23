const reflectApply = Reflect.apply;
const weakMapGet = WeakMap.prototype.get;
const weakMapHas = WeakMap.prototype.has;
const weakMapSet = WeakMap.prototype.set;
const runtimeProviderStreamFailureCauses = new WeakMap<object, unknown>();

class RuntimeProviderStreamFailure extends Error {
  constructor(cause: unknown) {
    super("Provider stream failed");
    this.name = "RuntimeProviderStreamFailure";
    reflectApply(weakMapSet, runtimeProviderStreamFailureCauses, [this, cause]);
  }
}

/** Mark an error from a proven provider-owned stream boundary. */
export function createRuntimeProviderStreamFailure(error: unknown): Error {
  if (readRuntimeProviderStreamFailureCause(error).found) return error as Error;
  return new RuntimeProviderStreamFailure(error);
}

/** Read a provider-owned cause without exposing it on the public error object. */
export function readRuntimeProviderStreamFailureCause(
  error: unknown,
): { found: false } | { found: true; cause: unknown } {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return { found: false };
  }
  if (!reflectApply(weakMapHas, runtimeProviderStreamFailureCauses, [error])) {
    return { found: false };
  }
  return {
    found: true,
    cause: reflectApply(weakMapGet, runtimeProviderStreamFailureCauses, [error]),
  };
}

const streamFailureDiagnosticCauses = new WeakMap<object, unknown>();

/**
 * Record what a stream failure wraps, for diagnostics only. Unlike
 * {@link createRuntimeProviderStreamFailure}, this does not mark the error as
 * provider-owned, so its classification and public message do not change.
 */
export function recordStreamFailureDiagnosticCause(error: Error, cause: unknown): void {
  reflectApply(weakMapSet, streamFailureDiagnosticCauses, [error, cause]);
}

/** Read a diagnostic cause without exposing it on the public error object. */
export function readStreamFailureDiagnosticCause(
  error: unknown,
): { found: false } | { found: true; cause: unknown } {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return { found: false };
  }
  if (!reflectApply(weakMapHas, streamFailureDiagnosticCauses, [error])) {
    return { found: false };
  }
  return {
    found: true,
    cause: reflectApply(weakMapGet, streamFailureDiagnosticCauses, [error]),
  };
}
