import {
  type ErrorCategory,
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
import { types as nodeUtilTypes } from "node:util";

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

const UNKNOWN_ERROR_SNAPSHOT: VeryfrontErrorSnapshot = Object.freeze({
  slug: "unknown-error",
  category: "GENERAL",
  status: 500,
  title: "Unknown/unclassified error",
  message: "Unknown/unclassified error",
  suggestion: "Check logs for more details",
});
const nativeErrorBrandCheck = nodeUtilTypes.isNativeError;
const nativeProxyBrandCheck = nodeUtilTypes.isProxy;
const apply = Reflect.apply;
const defineProperties = Object.defineProperties;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const setPrototypeOf = Object.setPrototypeOf;
const NativeError = Error;
const NativeString = String;
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
const MAX_ERROR_PROTOTYPE_DEPTH = 16;
const MISSING_DATA_FIELD = Symbol("missing-data-field");
const DOM_EXCEPTION_MESSAGE_GETTER = typeof DOMException === "function"
  ? getOwnPropertyDescriptor(DOMException.prototype, "message")?.get
  : undefined;

function isProblemDetailsResponseStatus(status: number): boolean {
  return Number.isInteger(status) &&
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

/**
 * Identify native Error values without evaluating project-owned proxy hooks.
 *
 * Unlike `instanceof Error`, Node's native brand check returns false for Error
 * proxies without invoking their `getPrototypeOf` trap. Use this before any
 * boundary logic that would otherwise inspect or detach an untrusted Error.
 */
export function isNativeErrorWithoutHooks(error: unknown): error is Error {
  return nativeErrorBrandCheck(error);
}

/** Identify a Proxy without evaluating any trap on the proxied value. */
export function isProxyWithoutHooks(value: unknown): boolean {
  return nativeProxyBrandCheck(value);
}

function ownDataField(
  value: object,
  key: PropertyKey,
): unknown | typeof MISSING_DATA_FIELD {
  const descriptor = getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : MISSING_DATA_FIELD;
}

function hasVeryfrontErrorPrototype(error: Error): boolean {
  let current: object | null = getPrototypeOf(error);

  for (
    let depth = 0;
    current !== null && depth < MAX_ERROR_PROTOTYPE_DEPTH;
    depth++
  ) {
    if (current === VeryfrontError.prototype) return true;
    if (isProxyWithoutHooks(current)) return false;
    current = getPrototypeOf(current);
  }

  return false;
}

function optionalOwnString(
  error: Error,
  key: PropertyKey,
): string | undefined | typeof MISSING_DATA_FIELD {
  const value = ownDataField(error, key);
  if (value === MISSING_DATA_FIELD || value === undefined) return value;
  return typeof value === "string" ? value : MISSING_DATA_FIELD;
}

interface ThrowableBoundarySnapshot {
  readonly error: VeryfrontErrorSnapshot;
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
    const rawStack = ownDataField(error, "stack");
    const stack = typeof rawStack === "string" ? sanitizeStackDiagnosticText(rawStack) : undefined;
    const rawName = ownDataField(error, "name");
    const name = typeof rawName === "string" && rawName ? sanitizeDiagnosticText(rawName) : "Error";

    if (hasVeryfrontErrorPrototype(error)) {
      const slug = ownDataField(error, "slug");
      const category = ownDataField(error, "category");
      const status = ownDataField(error, "status");
      const title = ownDataField(error, "title");
      const suggestion = optionalOwnString(error, "suggestion");
      const detail = optionalOwnString(error, "detail");
      const instance = optionalOwnString(error, "instance");
      const cause = ownDataField(error, "cause");

      if (
        typeof slug === "string" &&
        typeof category === "string" &&
        ERROR_CATEGORIES.has(category as ErrorCategory) &&
        typeof status === "number" &&
        Number.isFinite(status) &&
        typeof title === "string" &&
        suggestion !== MISSING_DATA_FIELD &&
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
            detail: detail === undefined ? undefined : sanitizeDiagnosticText(detail),
            cause: typeof cause === "string" ? sanitizeDiagnosticText(cause) : undefined,
            instance: instance === undefined ? undefined : sanitizeDiagnosticText(instance),
            stack,
          },
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
  const detached = new NativeError(
    boundary.registered ? snapshot.message : snapshot.detail ?? snapshot.message,
  );

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

  if (!boundary.registered) return detached;

  defineProperties(detached, {
    slug: { configurable: true, enumerable: true, value: snapshot.slug, writable: true },
    category: {
      configurable: true,
      enumerable: true,
      value: snapshot.category,
      writable: true,
    },
    status: { configurable: true, enumerable: true, value: snapshot.status, writable: true },
    title: { configurable: true, enumerable: true, value: snapshot.title, writable: true },
    suggestion: {
      configurable: true,
      enumerable: true,
      value: snapshot.suggestion,
      writable: true,
    },
    detail: {
      configurable: true,
      enumerable: true,
      value: snapshot.detail,
      writable: true,
    },
    cause: {
      configurable: true,
      enumerable: true,
      value: snapshot.cause,
      writable: true,
    },
    instance: {
      configurable: true,
      enumerable: true,
      value: snapshot.instance,
      writable: true,
    },
    context: {
      configurable: true,
      enumerable: true,
      value: undefined,
      writable: true,
    },
  });
  setPrototypeOf(detached, VeryfrontError.prototype);
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
 * unknown-error identity. Plain errors contribute only a safely-read message
 * and stack.
 */
export function snapshotErrorForBoundary(error: unknown): VeryfrontErrorSnapshot {
  const candidate = snapshotThrowableBoundary(error).error;

  return {
    ...candidate,
    slug: sanitizeBoundedErrorSlug(candidate.slug),
    title: sanitizeDiagnosticText(candidate.title),
    message: sanitizeDiagnosticText(candidate.message),
    suggestion: sanitizeOptionalDiagnosticText(candidate.suggestion),
    detail: sanitizeOptionalDiagnosticText(candidate.detail),
    cause: typeof candidate.cause === "string"
      ? sanitizeDiagnosticText(candidate.cause)
      : candidate.cause,
    instance: sanitizeOptionalDiagnosticText(candidate.instance),
    stack: candidate.stack === undefined ? undefined : sanitizeStackDiagnosticText(candidate.stack),
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
  const serialize = (): string => JSON.stringify(bounded, null, pretty ? 2 : undefined);
  let serialized = serialize();
  if (serialized.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS) return serialized;

  for (const key of ["stack", "cause", "detail", "instance", "suggestion"] as const) {
    delete bounded[key];
    serialized = serialize();
    if (serialized.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS) return serialized;
  }

  return JSON.stringify(
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
