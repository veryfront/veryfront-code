import {
  type ErrorCategory,
  isVeryfrontErrorInstance,
  type RFC9457Response,
  VeryfrontError,
  type VeryfrontErrorSnapshot,
} from "./types.ts";
import {
  buildErrorDocsUrl,
  ERROR_OUTPUT_MAX_LENGTH_CHARS,
  sanitizeBoundedDiagnosticText,
  sanitizeBoundedErrorSlug,
  sanitizeBoundedStackText,
  sanitizeBoundedTerminalText,
} from "./diagnostic-policy.ts";
import { type RedactedValue, redactForSerialization } from "#veryfront/utils/logger/redact.ts";
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

export {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

export {
  buildErrorDocsUrl,
  ERROR_CONTEXT_MAX_LENGTH_CHARS,
  ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
  ERROR_DOCS_BASE_URL,
  ERROR_DOCS_SLUG_MAX_LENGTH_CHARS,
  ERROR_OUTPUT_MAX_LENGTH_CHARS,
  ERROR_STACK_MAX_LENGTH_CHARS,
  limitRenderedErrorOutput,
  sanitizeBoundedErrorSlug,
} from "./diagnostic-policy.ts";

const freeze = Object.freeze;
const jsonStringify = JSON.stringify;
const numberIsFinite = Number.isFinite;
const numberIsInteger = Number.isInteger;
const UNKNOWN_ERROR_SNAPSHOT: VeryfrontErrorSnapshot = freeze({
  slug: "unknown-error",
  category: "GENERAL",
  status: 500,
  title: "Unknown/unclassified error",
  message: "Unknown/unclassified error",
  suggestion: "Check logs for more details",
});
const apply = Reflect.apply;
const defineProperties = Object.defineProperties;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const NativeError = Error;
const NativeString = String;
const NATIVE_ERROR_STACK_GETTER = getOwnPropertyDescriptor(new NativeError(), "stack")?.get;
const ERROR_CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
  "CONFIG",
  "BUILD",
  "RUNTIME",
  "ROUTE",
  "MODULE",
  "SERVER",
  "BOUNDARY",
  "DEV",
  "DEPLOY",
  "AGENT",
  "GENERAL",
]);
const MISSING_DATA_FIELD = Symbol("missing-data-field");
const DOM_EXCEPTION_MESSAGE_GETTER = typeof DOMException === "function"
  ? getOwnPropertyDescriptor(DOMException.prototype, "message")?.get
  : undefined;
const DOM_EXCEPTION_NAME_GETTER = typeof DOMException === "function"
  ? getOwnPropertyDescriptor(DOMException.prototype, "name")?.get
  : undefined;

function isProblemDetailsResponseStatus(status: number): boolean {
  return numberIsInteger(status) &&
    status >= 200 &&
    status <= 599 &&
    status !== 204 &&
    status !== 205 &&
    status !== 304;
}

/** Mask credentials embedded in arbitrary diagnostic text. */
export function sanitizeDiagnosticText(value: unknown): string {
  return sanitizeBoundedDiagnosticText(value);
}

/**
 * Prepare one untrusted diagnostic field for terminal or plain-text output.
 * Apply framework-owned ANSI styling only after this sanitizer returns.
 */
export function sanitizeTerminalDiagnosticText(value: unknown): string {
  return sanitizeBoundedTerminalText(value);
}

/** Mask credentials and apply the larger shared stack bound. */
export function sanitizeStackDiagnosticText(value: unknown): string {
  return sanitizeBoundedStackText(value);
}

export function sanitizeOptionalDiagnosticText(value: unknown): string | undefined {
  return value === undefined ? undefined : sanitizeDiagnosticText(value);
}

function ownDataField(
  value: Error,
  key: PropertyKey,
): unknown | typeof MISSING_DATA_FIELD {
  const descriptor = getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : MISSING_DATA_FIELD;
}

function optionalOwnString(
  error: Error,
  key: PropertyKey,
): string | undefined | typeof MISSING_DATA_FIELD {
  const value = ownDataField(error, key);
  if (value === MISSING_DATA_FIELD || value === undefined) return value;
  return typeof value === "string" ? value : MISSING_DATA_FIELD;
}

function readOwnDataStack(error: Error): string | undefined {
  const descriptor = getOwnPropertyDescriptor(error, "stack");
  if (!descriptor) return undefined;
  if ("value" in descriptor) {
    return typeof descriptor.value === "string" ? descriptor.value : undefined;
  }
  if (descriptor.get !== NATIVE_ERROR_STACK_GETTER || !NATIVE_ERROR_STACK_GETTER) {
    return undefined;
  }
  try {
    const stack = apply(NATIVE_ERROR_STACK_GETTER, error, []);
    return typeof stack === "string" ? stack : undefined;
  } catch {
    return undefined;
  }
}

function readNativeErrorName(error: Error): string {
  const ownName = ownDataField(error, "name");
  if (typeof ownName === "string" && ownName) {
    return sanitizeDiagnosticText(ownName);
  }

  const prototype = getPrototypeOf(error);
  if (prototype === null || isProxyWithoutHooks(prototype)) return "Error";
  const descriptor = getOwnPropertyDescriptor(prototype, "name");
  if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
    return sanitizeDiagnosticText(descriptor.value || "Error");
  }
  if (descriptor?.get === DOM_EXCEPTION_NAME_GETTER && DOM_EXCEPTION_NAME_GETTER) {
    try {
      const name = apply(DOM_EXCEPTION_NAME_GETTER, error, []);
      return typeof name === "string" && name ? sanitizeDiagnosticText(name) : "Error";
    } catch {
      return "Error";
    }
  }
  return "Error";
}

interface ThrowableBoundarySnapshot {
  readonly error: VeryfrontErrorSnapshot;
  readonly context?: unknown;
  readonly name: string;
  readonly registered: boolean;
}

function snapshotThrowableBoundary(error: unknown): ThrowableBoundarySnapshot {
  const message = snapshotThrowableDiagnostic(error);
  if (!isNativeErrorWithoutHooks(error)) {
    return {
      error: {
        ...UNKNOWN_ERROR_SNAPSHOT,
        detail: message || "Unknown error",
      },
      name: "Error",
      registered: false,
    };
  }

  try {
    const rawStack = readOwnDataStack(error);
    const stack = rawStack === undefined ? undefined : sanitizeStackDiagnosticText(rawStack);
    const name = readNativeErrorName(error);

    if (isVeryfrontErrorInstance(error)) {
      const slug = ownDataField(error, "slug");
      const category = ownDataField(error, "category");
      const status = ownDataField(error, "status");
      const title = ownDataField(error, "title");
      const suggestion = optionalOwnString(error, "suggestion");
      const exitCode = ownDataField(error, "exitCode");
      const detail = optionalOwnString(error, "detail");
      const instance = optionalOwnString(error, "instance");
      const cause = ownDataField(error, "cause");
      const context = ownDataField(error, "context");

      if (
        typeof slug === "string" &&
        typeof category === "string" &&
        ERROR_CATEGORIES.has(category as ErrorCategory) &&
        typeof status === "number" &&
        numberIsFinite(status) &&
        typeof title === "string" &&
        suggestion !== MISSING_DATA_FIELD &&
        (exitCode === MISSING_DATA_FIELD ||
          exitCode === undefined ||
          (typeof exitCode === "number" && numberIsFinite(exitCode))) &&
        detail !== MISSING_DATA_FIELD &&
        instance !== MISSING_DATA_FIELD
      ) {
        return {
          error: {
            slug: sanitizeBoundedErrorSlug(slug),
            category: category as ErrorCategory,
            status,
            title: sanitizeDiagnosticText(title),
            message,
            suggestion: suggestion === undefined ? undefined : sanitizeDiagnosticText(suggestion),
            exitCode: exitCode === MISSING_DATA_FIELD ? undefined : exitCode,
            detail: detail === undefined ? undefined : sanitizeDiagnosticText(detail),
            cause: typeof cause === "string" ? sanitizeDiagnosticText(cause) : undefined,
            instance: instance === undefined ? undefined : sanitizeDiagnosticText(instance),
            stack,
          },
          context: context === MISSING_DATA_FIELD ? undefined : context,
          name,
          registered: true,
        };
      }
    }

    return {
      error: {
        ...UNKNOWN_ERROR_SNAPSHOT,
        detail: message || "Unknown error",
        stack,
      },
      name,
      registered: false,
    };
  } catch {
    return {
      error: {
        ...UNKNOWN_ERROR_SNAPSHOT,
        detail: "Unknown error",
      },
      name: "Error",
      registered: false,
    };
  }
}

/**
 * Detach an untrusted throwable into framework-owned data properties.
 *
 * The returned Error can safely cross logging and HTTP boundaries: no field on
 * it retains a project accessor, proxy, or object-valued cause/context.
 */
export function detachThrowableForBoundary(error: unknown): Error {
  const boundary = snapshotThrowableBoundary(error);
  const snapshot = boundary.error;
  const detached = boundary.registered
    ? new VeryfrontError(snapshot.message, {
      slug: snapshot.slug,
      category: snapshot.category,
      status: snapshot.status,
      title: snapshot.title,
      suggestion: snapshot.suggestion,
      exitCode: snapshot.exitCode,
      detail: snapshot.detail,
      cause: snapshot.cause,
      instance: snapshot.instance,
    })
    : new NativeError(snapshot.detail ?? snapshot.message);

  defineProperties(detached, {
    name: {
      configurable: true,
      value: boundary.registered ? "VeryfrontError" : boundary.name,
      writable: true,
    },
    stack: {
      configurable: true,
      value: snapshot.stack,
      writable: true,
    },
  });

  return detached;
}

/**
 * Snapshot one thrown value into a bounded diagnostic without invoking
 * conversion hooks on objects or functions.
 *
 * Native and Veryfront errors are detached through their Error fields.
 * Primitive values are safe to convert directly. Arbitrary objects and
 * functions are intentionally opaque because `String(value)` can execute
 * project-owned `Symbol.toPrimitive`, `toString`, or proxy hooks.
 */
export function snapshotThrowableDiagnostic(error: unknown): string {
  if (isNativeErrorWithoutHooks(error)) {
    try {
      const message = getOwnPropertyDescriptor(error, "message");
      if (message) {
        return sanitizeDiagnosticText(
          "value" in message && typeof message.value === "string" ? message.value : "Unknown error",
        );
      }

      if (DOM_EXCEPTION_MESSAGE_GETTER) {
        try {
          const domMessage = apply(DOM_EXCEPTION_MESSAGE_GETTER, error, []);
          if (typeof domMessage === "string") {
            return sanitizeDiagnosticText(domMessage);
          }
        } catch {
          // Ordinary Error objects do not carry DOMException internal slots.
        }
      }

      return sanitizeDiagnosticText("");
    } catch {
      return sanitizeDiagnosticText("Unknown error");
    }
  }

  if (error === null) return sanitizeDiagnosticText("null");

  switch (typeof error) {
    case "string":
      return sanitizeDiagnosticText(error);
    case "number":
    case "bigint":
    case "boolean":
    case "symbol":
    case "undefined":
      return sanitizeDiagnosticText(NativeString(error));
    default:
      return sanitizeDiagnosticText("Unknown error");
  }
}

/**
 * Snapshot a throwable once and return a stable Veryfront-shaped diagnostic.
 *
 * Invalid or unreadable VeryfrontError proxies degrade to the canonical
 * unknown-error identity. Plain errors contribute only safely-read own data.
 * Object-valued context is intentionally excluded so this generic snapshot
 * never retains project-owned accessors, proxies, or serializers.
 */
export function snapshotErrorForBoundary(error: unknown): VeryfrontErrorSnapshot {
  return sanitizeBoundaryErrorSnapshot(snapshotThrowableBoundary(error).error);
}

function sanitizeBoundaryErrorSnapshot(
  candidate: VeryfrontErrorSnapshot,
): VeryfrontErrorSnapshot {
  return {
    slug: sanitizeBoundedErrorSlug(candidate.slug),
    category: candidate.category,
    status: candidate.status,
    title: sanitizeDiagnosticText(candidate.title),
    message: sanitizeDiagnosticText(candidate.message),
    suggestion: sanitizeOptionalDiagnosticText(candidate.suggestion),
    exitCode: candidate.exitCode,
    detail: sanitizeOptionalDiagnosticText(candidate.detail),
    cause: typeof candidate.cause === "string"
      ? sanitizeDiagnosticText(candidate.cause)
      : undefined,
    instance: sanitizeOptionalDiagnosticText(candidate.instance),
    stack: candidate.stack === undefined ? undefined : sanitizeStackDiagnosticText(candidate.stack),
  };
}

export interface ErrorLoggingBoundarySnapshot {
  readonly error: VeryfrontErrorSnapshot;
  readonly context?: RedactedValue;
}

/**
 * Capture the error identity plus a framework-owned context copy for logging.
 *
 * The generic boundary snapshot remains context-free. This narrower path
 * redacts and detaches the context before returning it, so callers can never
 * retain or serialize the project-owned source object.
 */
export function snapshotErrorForLoggingBoundary(
  error: unknown,
): ErrorLoggingBoundarySnapshot {
  const boundary = snapshotThrowableBoundary(error);
  return {
    error: sanitizeBoundaryErrorSnapshot(boundary.error),
    context: boundary.context === undefined ? undefined : redactForSerialization(boundary.context),
  };
}

export interface SafeProblemDetails extends RFC9457Response {
  stack?: string;
}

/** Build a credential-scrubbed RFC 9457 snapshot without calling error methods. */
export function createSafeProblemDetails(
  error: unknown,
  instance?: string,
): SafeProblemDetails {
  const candidate = snapshotErrorForBoundary(error);
  const snapshot = isProblemDetailsResponseStatus(candidate.status) ? candidate : {
    ...UNKNOWN_ERROR_SNAPSHOT,
    detail: candidate.detail ?? candidate.message,
    stack: candidate.stack,
  };

  return {
    type: buildErrorDocsUrl(snapshot.slug),
    title: sanitizeDiagnosticText(snapshot.title),
    status: snapshot.status,
    detail: sanitizeOptionalDiagnosticText(snapshot.detail),
    instance: sanitizeOptionalDiagnosticText(snapshot.instance ?? instance),
    category: snapshot.category,
    suggestion: sanitizeOptionalDiagnosticText(snapshot.suggestion),
    cause: typeof snapshot.cause === "string" ? sanitizeDiagnosticText(snapshot.cause) : undefined,
    stack: snapshot.stack === undefined ? undefined : sanitizeStackDiagnosticText(snapshot.stack),
  };
}

/**
 * Serialize a problem-details object without allowing optional diagnostics to
 * amplify one response beyond the shared output budget.
 */
export function stringifySafeProblemDetails(
  body: SafeProblemDetails,
  pretty = false,
): string {
  const bounded = { ...body };
  const serialize = (): string => jsonStringify(bounded, null, pretty ? 2 : undefined);
  let serialized = serialize();
  if (serialized.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS) return serialized;

  for (const key of ["stack", "cause", "detail", "instance", "suggestion"] as const) {
    delete bounded[key];
    serialized = serialize();
    if (serialized.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS) return serialized;
  }

  return jsonStringify(
    {
      type: buildErrorDocsUrl(UNKNOWN_ERROR_SNAPSHOT.slug),
      title: UNKNOWN_ERROR_SNAPSHOT.title,
      status: UNKNOWN_ERROR_SNAPSHOT.status,
      category: UNKNOWN_ERROR_SNAPSHOT.category,
    },
    null,
    pretty ? 2 : undefined,
  );
}
