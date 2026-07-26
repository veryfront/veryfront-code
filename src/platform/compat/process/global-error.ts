export type GlobalErrorType = "uncaughtException" | "unhandledRejection";

export type GlobalErrorHandler = (
  error: Error,
  type: GlobalErrorType,
) => boolean | void;

type HandlerFailureReporter = (
  error: Error,
  type: GlobalErrorType,
) => void;

const NON_ERROR_VALUE_MESSAGE = "A non-Error object was thrown";

/**
 * Convert an arbitrary thrown value without invoking object conversion hooks.
 *
 * Rejected promises and manual event dispatch can carry any JavaScript value.
 * Calling String(value) is unsafe here because a hostile toString or
 * Symbol.toPrimitive implementation can throw while the runtime is already
 * handling a global failure.
 */
export function normalizeGlobalError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (value === null) return new Error("null");

  switch (typeof value) {
    case "string":
      return new Error(value);
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
      return new Error(String(value));
    default:
      return new Error(NON_ERROR_VALUE_MESSAGE);
  }
}

function reportHandlerFailure(
  error: Error,
  type: GlobalErrorType,
): void {
  let message = "Unknown handler failure";
  try {
    if (typeof error.message === "string" && error.message) {
      message = error.message;
    }
  } catch {
    // Error.message can be replaced with a throwing accessor.
  }

  try {
    console.error(
      `Global error handler threw while processing ${type}: ${message}`,
    );
  } catch {
    // A replaced console implementation must not recurse into global handling.
  }
}

/**
 * Invoke a global error callback while preserving the runtime's fatal default
 * when the callback itself fails.
 */
export function invokeGlobalErrorHandler(
  handler: GlobalErrorHandler,
  error: Error,
  type: GlobalErrorType,
  reportFailure: HandlerFailureReporter = reportHandlerFailure,
): boolean {
  try {
    return handler(error, type) === true;
  } catch (handlerError) {
    reportFailure(normalizeGlobalError(handlerError), type);
    return false;
  }
}
