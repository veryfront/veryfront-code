const runtimeProviderStreamFailureCauses = new WeakMap<object, unknown>();
const apply = Reflect.apply;
const weakMapHas = WeakMap.prototype.has;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;

class RuntimeProviderStreamFailure extends Error {
  constructor(cause: unknown) {
    super("Provider stream failed");
    this.name = "RuntimeProviderStreamFailure";
    apply(weakMapSet, runtimeProviderStreamFailureCauses, [this, cause]);
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
  if (!apply(weakMapHas, runtimeProviderStreamFailureCauses, [error])) return { found: false };
  return { found: true, cause: apply(weakMapGet, runtimeProviderStreamFailureCauses, [error]) };
}
