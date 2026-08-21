import {
  isSensitiveKey,
  REDACTED,
  sanitizeUrlCredentials,
} from "#veryfront/utils/logger/redact.ts";
import {
  LOG_PREVIEW_MAX_LENGTH_CHARS,
  MAX_STRING_DISPLAY_LENGTH,
  MAX_TRACE_ATTRIBUTE_VALUE_SIZE,
} from "#veryfront/utils/constants/index.ts";
import {
  MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH,
  MAX_STRUCTURED_TELEMETRY_CONTAINER_ENTRIES,
  MAX_STRUCTURED_TELEMETRY_DEPTH,
  MAX_STRUCTURED_TELEMETRY_NODES,
  MAX_TELEMETRY_ATTRIBUTE_ARRAY_LENGTH,
  MAX_TELEMETRY_ATTRIBUTE_COUNT,
  MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH,
} from "./limits.ts";
import { isVeryfrontError } from "#veryfront/errors/http-error.ts";
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  readNativeErrorNameWithoutHooks,
  readNativeErrorStackWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

const apply = Reflect.apply;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectKeys = Object.keys;
const deleteProperty = Reflect.deleteProperty;
const mathMax = Math.max;
const NativeDate = Date;
const NativeError = Error;
const NativeString = String;
const NativeURL = URL;
const dateGetTime = Date.prototype.getTime;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const stringSlice = String.prototype.slice;
const ERROR_PROTOTYPE = NativeError.prototype;
const URL_HREF_GETTER = readOwnDescriptorGetter(NativeURL.prototype, "href");

const INVALID_ERROR_FIELD = Symbol("invalid-error-field");

function hasOwn(descriptor: PropertyDescriptor, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, descriptor, [key]) as boolean;
}

function readOwnDescriptorGetter(
  object: URL,
  key: PropertyKey,
): ((this: unknown) => unknown) | undefined {
  try {
    const descriptor = getOwnPropertyDescriptor(object, key);
    if (!descriptor || !hasOwn(descriptor, "get")) return undefined;
    const getter = descriptor.get;
    return typeof getter === "function" ? getter : undefined;
  } catch (_) {
    return undefined;
  }
}

function readOwnErrorString(
  error: Error,
  key: PropertyKey,
): string | undefined | typeof INVALID_ERROR_FIELD {
  try {
    const descriptor = getOwnPropertyDescriptor(error, key);
    if (!descriptor) return undefined;
    if (!hasOwn(descriptor, "value")) return INVALID_ERROR_FIELD;
    const value = descriptor.value;
    return typeof value === "string" ? value : INVALID_ERROR_FIELD;
  } catch (_) {
    return INVALID_ERROR_FIELD;
  }
}

function readNativeErrorMessage(error: Error): string {
  const ownMessage = readOwnErrorString(error, "message");
  if (typeof ownMessage === "string") return ownMessage;
  if (ownMessage === INVALID_ERROR_FIELD) return "Unknown error";
  return "";
}

function readNativeErrorStack(error: Error): string | undefined {
  if (
    readOwnErrorString(error, "message") === INVALID_ERROR_FIELD ||
    readOwnErrorString(error, "name") === INVALID_ERROR_FIELD
  ) {
    return undefined;
  }
  try {
    const descriptor = getOwnPropertyDescriptor(error, "stack");
    if (descriptor && hasOwn(descriptor, "value")) {
      return typeof descriptor.value === "string" ? descriptor.value : undefined;
    }
  } catch (_) {
    return undefined;
  }
  // Accessor-valued runtime stacks are delegated to the compat reader, which
  // shadows the formatter and fails closed on foreign accessors.
  return readNativeErrorStackWithoutHooks(error);
}

function primitiveErrorMessage(error: unknown): string {
  if (
    (typeof error === "object" && error !== null) ||
    typeof error === "function"
  ) {
    return "Unknown error";
  }
  try {
    return NativeString(error);
  } catch (_) {
    return "Unknown error";
  }
}

function createDataDescriptor(value: unknown): PropertyDescriptor {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = false;
  descriptor.value = value;
  descriptor.writable = true;
  return descriptor;
}

function createErrorShapedRecord(
  message: string,
  name: string,
  stack?: string,
): Error {
  const sanitized = createObject(ERROR_PROTOTYPE) as Error;
  defineProperty(sanitized, "message", createDataDescriptor(message));
  defineProperty(sanitized, "name", createDataDescriptor(name));
  defineProperty(sanitized, "stack", createDataDescriptor(stack));
  return sanitized;
}

function createDetachedTelemetryError(
  message: string,
  name: string,
  stack?: string,
): Error {
  const sanitized = new NativeError();
  // Deleting V8's configurable lazy stack does not materialize it. Redefining
  // the property directly does on older V8 releases and can therefore execute
  // Error.prepareStackTrace.
  if (!deleteProperty(sanitized, "stack")) {
    return createErrorShapedRecord(message, name, stack);
  }
  defineProperty(sanitized, "message", createDataDescriptor(message));
  defineProperty(sanitized, "name", createDataDescriptor(name));
  defineProperty(sanitized, "stack", createDataDescriptor(stack));
  return sanitized;
}

export type TelemetryAttributeValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[]
  | undefined;

const SEMANTIC_TOKEN_COUNT_ATTRIBUTE =
  /(?:^|[._-])(?:input|output|total|prompt|completion)[._-]?tokens?$/i;

function isNumericSemanticTokenCount(key: string, value: TelemetryAttributeValue): boolean {
  return typeof value === "number" && Number.isFinite(value) &&
    SEMANTIC_TOKEN_COUNT_ATTRIBUTE.test(key);
}

/** Redact and bound text before retaining it or handing it to a provider. */
export function sanitizeTelemetryText(value: string, maxLength: number): string {
  const sanitized = sanitizeUrlCredentials(value);
  if (sanitized.length <= maxLength) return sanitized;
  const end = apply(mathMax, Math, [0, maxLength - 1]) as number;
  return `${apply(stringSlice, sanitized, [0, end]) as string}…`;
}

/** Redact a single flattened telemetry attribute. */
export function sanitizeTelemetryAttributeValue(
  key: string,
  value: TelemetryAttributeValue,
): TelemetryAttributeValue {
  if (isSensitiveKey(key) && !isNumericSemanticTokenCount(key, value)) return REDACTED;
  if (typeof value === "string") {
    return sanitizeTelemetryText(value, MAX_TRACE_ATTRIBUTE_VALUE_SIZE);
  }
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  if (Array.isArray(value)) {
    try {
      if (value.length > MAX_TELEMETRY_ATTRIBUTE_ARRAY_LENGTH) return REDACTED;
      const sanitized: (string | number | boolean)[] = [];
      for (let index = 0; index < value.length; index++) {
        const item = value[index];
        if (typeof item === "number" && !Number.isFinite(item)) return REDACTED;
        sanitized.push(
          typeof item === "string"
            ? sanitizeTelemetryText(item, MAX_TRACE_ATTRIBUTE_VALUE_SIZE)
            : item,
        );
      }
      return sanitized;
    } catch (_) {
      return REDACTED;
    }
  }
  return value;
}

/** Return a redacted copy of a flattened telemetry attribute record. */
export function sanitizeTelemetryAttributes<
  T extends Record<string, TelemetryAttributeValue> | undefined,
>(attributes: T): T {
  if (!attributes) return attributes;

  let keys: string[];
  try {
    keys = objectKeys(attributes);
  } catch (_) {
    return {} as T;
  }

  const sanitized: Record<string, TelemetryAttributeValue> = {};
  const retainedKeys = new Set<string>();
  const keyCount = keys.length < MAX_TELEMETRY_ATTRIBUTE_COUNT
    ? keys.length
    : MAX_TELEMETRY_ATTRIBUTE_COUNT;
  for (let index = 0; index < keyCount; index++) {
    const key = keys[index];
    if (key === undefined) continue;
    const boundedKey = key.length <= MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH
      ? key
      : apply(stringSlice, key, [0, MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH]) as string;
    if (!boundedKey || retainedKeys.has(boundedKey)) continue;

    let value: TelemetryAttributeValue = REDACTED;
    if (!isSensitiveKey(key) || SEMANTIC_TOKEN_COUNT_ATTRIBUTE.test(key)) {
      try {
        value = sanitizeTelemetryAttributeValue(key, attributes[key]);
      } catch (_) {
        value = REDACTED;
      }
    }
    if (value === undefined) continue;
    defineProperty(sanitized, boundedKey, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    retainedKeys.add(boundedKey);
  }
  return sanitized as T;
}

interface StructuredTelemetryBudget {
  exhausted: boolean;
  remainingNodes: number;
}

function cloneNativeDate(value: object): Date | undefined {
  try {
    const timestamp = apply(dateGetTime, value, []) as number;
    return new NativeDate(timestamp);
  } catch (_) {
    return undefined;
  }
}

const NOT_NATIVE_URL = Symbol("not-native-url");

function cloneNativeUrl(value: object): URL | string | typeof NOT_NATIVE_URL {
  if (!URL_HREF_GETTER) return NOT_NATIVE_URL;
  let href: unknown;
  try {
    href = apply(URL_HREF_GETTER, value, []);
  } catch (_) {
    return NOT_NATIVE_URL;
  }
  if (typeof href !== "string") return REDACTED;
  try {
    const sanitizedHref = sanitizeUrlCredentials(href);
    if (sanitizedHref.length > MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH) return REDACTED;
    return new NativeURL(sanitizedHref);
  } catch (_) {
    return REDACTED;
  }
}

function snapshotStructuredError(value: Error): Record<string, unknown> {
  const snapshot = sanitizeErrorForTelemetry(value);
  return {
    message: snapshot.message,
    name: snapshot.name,
    stack: snapshot.stack,
  };
}

function sanitizeStructuredValue(
  value: unknown,
  depth: number,
  seen: Set<object>,
  budget: StructuredTelemetryBudget,
): unknown {
  if (budget.remainingNodes <= 0) {
    budget.exhausted = true;
    return REDACTED;
  }
  budget.remainingNodes--;

  if (typeof value === "string") {
    return sanitizeTelemetryText(value, MAX_STRING_DISPLAY_LENGTH);
  }
  if (
    value === null || value === undefined || typeof value === "number" ||
    typeof value === "boolean" || typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value === "symbol" || typeof value === "function") return REDACTED;
  if (depth >= MAX_STRUCTURED_TELEMETRY_DEPTH || seen.has(value)) return REDACTED;
  if (isProxyWithoutHooks(value)) return REDACTED;

  if (isNativeErrorWithoutHooks(value)) return snapshotStructuredError(value);
  const clonedDate = cloneNativeDate(value);
  if (clonedDate) return clonedDate;
  const clonedUrl = cloneNativeUrl(value);
  if (clonedUrl !== NOT_NATIVE_URL) return clonedUrl;

  seen.add(value);
  try {
    let toJSON: unknown;
    try {
      toJSON = (value as { toJSON?: unknown }).toJSON;
    } catch (_) {
      return REDACTED;
    }
    if (typeof toJSON === "function") {
      try {
        return sanitizeStructuredValue(
          toJSON.call(value),
          depth + 1,
          seen,
          budget,
        );
      } catch (_) {
        return REDACTED;
      }
    }

    if (Array.isArray(value)) {
      if (value.length > MAX_STRUCTURED_TELEMETRY_CONTAINER_ENTRIES) {
        return REDACTED;
      }
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        try {
          copy.push(sanitizeStructuredValue(value[index], depth + 1, seen, budget));
        } catch (_) {
          copy.push(REDACTED);
        }
        if (budget.exhausted) return REDACTED;
      }
      return copy;
    }

    let keys: string[];
    try {
      keys = objectKeys(value);
    } catch (_) {
      return REDACTED;
    }
    if (keys.length > MAX_STRUCTURED_TELEMETRY_CONTAINER_ENTRIES) {
      return REDACTED;
    }

    const copy: Record<string, unknown> = {};
    const retainedKeys = new Set<string>();
    for (const key of keys) {
      const boundedKey = sanitizeTelemetryText(key, LOG_PREVIEW_MAX_LENGTH_CHARS);
      if (retainedKeys.has(boundedKey)) return REDACTED;
      let child: unknown = REDACTED;
      if (!isSensitiveKey(key)) {
        try {
          child = sanitizeStructuredValue(
            (value as Record<string, unknown>)[key],
            depth + 1,
            seen,
            budget,
          );
        } catch (_) {
          child = REDACTED;
        }
      }
      if (budget.exhausted) return REDACTED;
      defineProperty(copy, boundedKey, {
        configurable: true,
        enumerable: true,
        value: child,
        writable: true,
      });
      retainedKeys.add(boundedKey);
    }
    return copy;
  } finally {
    seen.delete(value);
  }
}

/**
 * Return a detached, fail-closed snapshot suitable for retained logs and
 * errors. Credential-like keys and URL credentials are redacted recursively.
 */
export function sanitizeStructuredTelemetryData<T>(value: T): T {
  try {
    return sanitizeStructuredValue(
      value,
      0,
      new Set<object>(),
      {
        exhausted: false,
        remainingNodes: MAX_STRUCTURED_TELEMETRY_NODES,
      },
    ) as T;
  } catch (_) {
    return REDACTED as T;
  }
}

/**
 * Create an error safe to send to telemetry backends without mutating or
 * replacing the application error that will be returned to the caller.
 *
 * Native errors are classified through a hook-free runtime brand check. Older
 * supported runtimes use the platform compatibility implementation instead of
 * the unsafe `instanceof` fallback that executes Proxy traps.
 */
export function sanitizeErrorForTelemetry(error: unknown): Error {
  try {
    const isError = isNativeErrorWithoutHooks(error);
    const source = isError ? error : undefined;
    const message = sanitizeTelemetryText(
      source ? readNativeErrorMessage(source) : primitiveErrorMessage(error),
      MAX_STRING_DISPLAY_LENGTH,
    );
    const name = source
      ? sanitizeTelemetryText(
        readNativeErrorNameWithoutHooks(source),
        LOG_PREVIEW_MAX_LENGTH_CHARS,
      )
      : "Unknown";
    const sourceStack = source ? readNativeErrorStack(source) : undefined;
    const stack = sourceStack === undefined
      ? undefined
      : sanitizeTelemetryText(sourceStack, MAX_STRING_DISPLAY_LENGTH);

    return createDetachedTelemetryError(message, name, stack);
  } catch (_) {
    // Telemetry is best effort and must never replace the application outcome.
    return createErrorShapedRecord("Unknown error", "Unknown");
  }
}

const SAFE_TELEMETRY_ERROR_NAMES = new Set([
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

/**
 * Node/Deno transient network error codes. Matched as whole tokens against
 * error.code (or, when a plain Error carries no code, its message). Unlike
 * "429"/"503"/"timeout", these tokens are specific enough not to appear
 * incidentally in unrelated error text.
 */
const TELEMETRY_ERROR_CODE_RE = /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND)\b/;

/** Whether text names one of the transient network codes above. */
export function hasTransientErrorCode(text: string): boolean {
  return TELEMETRY_ERROR_CODE_RE.test(text);
}

/**
 * Bounded classification safe to put on a span. Never returns the error's own
 * message: telemetry leaves the process, and a message carries whatever the
 * thrower interpolated into it. The detail stays in the logs.
 *
 * Accepts `unknown` because a throw is not guaranteed to be an `Error`, and a
 * bare string reaches `sanitizeErrorForTelemetry` as raw text.
 */
export function telemetryErrorType(error: unknown): string {
  try {
    if (isVeryfrontError(error)) return `VeryfrontError:${error.status}`;
    if (!isNativeErrorWithoutHooks(error)) return "Unknown";

    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      const match = TELEMETRY_ERROR_CODE_RE.exec(code);
      if (match?.[1]) return match[1];
    }

    const name = readNativeErrorNameWithoutHooks(error);
    return SAFE_TELEMETRY_ERROR_NAMES.has(name) ? name : "Error";
  } catch (_) {
    // Classification is best effort and must never change the outcome it reports on.
    return "Error";
  }
}
