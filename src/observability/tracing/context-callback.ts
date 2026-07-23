type ActivationFailureHandler = (error: unknown) => void;

function reportActivationFailure(
  handler: ActivationFailureHandler | undefined,
  error: unknown,
): void {
  try {
    handler?.(error);
  } catch (_) {
    /* expected: diagnostics must not affect the protected callback */
  }
}

function consumeIgnoredThenable(value: unknown): void {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return;

  let then: unknown;
  try {
    then = (value as { then?: unknown }).then;
  } catch (_) {
    return;
  }
  if (typeof then !== "function") return;

  try {
    Reflect.apply(then, value, [() => {}, () => {}]);
  } catch (_) {
    /* expected: provider-owned thenables cannot affect application outcomes */
  }
}

/**
 * Run an async callback at most once, falling back when context activation fails.
 *
 * Context providers are synchronous callback invokers by contract. Once the
 * application callback has been invoked, its promise is authoritative: a
 * provider-owned replacement (including a promise that never settles) must not
 * delay or replace application work.
 */
export function runAsyncWithContextFallback<T>(
  activate: (callback: () => Promise<T>) => Promise<T>,
  callback: () => Promise<T>,
  onActivationFailure?: ActivationFailureHandler,
): Promise<T> {
  let callbackInvoked = false;
  let callbackResult: Promise<T> | undefined;
  const invoke = (): Promise<T> => {
    if (callbackInvoked && callbackResult) return callbackResult;
    callbackInvoked = true;
    try {
      callbackResult = callback();
    } catch (error) {
      callbackResult = Promise.reject(error);
    }
    return callbackResult;
  };

  try {
    const providerResult = activate(invoke);
    if (callbackInvoked && callbackResult) {
      if (providerResult !== callbackResult) consumeIgnoredThenable(providerResult);
      return callbackResult;
    }

    reportActivationFailure(
      onActivationFailure,
      new Error("Context activation returned without invoking its callback"),
    );
    consumeIgnoredThenable(providerResult);
    return invoke();
  } catch (activationError) {
    if (callbackInvoked && callbackResult) return callbackResult;
    reportActivationFailure(onActivationFailure, activationError);
    return invoke();
  }
}

/** Run a sync callback at most once, falling back when context activation fails. */
export function runSyncWithContextFallback<T>(
  activate: (callback: () => T) => T,
  callback: () => T,
  onActivationFailure?: ActivationFailureHandler,
): T {
  let callbackInvoked = false;
  let callbackSucceeded = false;
  let callbackResult: T | undefined;
  let callbackError: unknown;

  const invoke = (): T => {
    if (callbackInvoked) {
      if (!callbackSucceeded) throw callbackError;
      return callbackResult as T;
    }
    callbackInvoked = true;
    try {
      callbackResult = callback();
      callbackSucceeded = true;
      return callbackResult;
    } catch (error) {
      callbackError = error;
      throw error;
    }
  };

  try {
    activate(invoke);
    if (callbackInvoked) {
      if (!callbackSucceeded) throw callbackError;
      return callbackResult as T;
    }

    reportActivationFailure(
      onActivationFailure,
      new Error("Context activation returned without invoking its callback"),
    );
    return invoke();
  } catch (activationError) {
    if (callbackInvoked) {
      if (!callbackSucceeded) throw callbackError;
      return callbackResult as T;
    }
    reportActivationFailure(onActivationFailure, activationError);
    return invoke();
  }
}
