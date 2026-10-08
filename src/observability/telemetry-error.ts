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
import { snapshotVeryfrontError } from "#veryfront/errors/types.ts";
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  readNativeErrorNameWithoutHooks,
  readNativeErrorStackWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { readRuntimeProviderStreamFailureCause } from "#veryfront/runtime/provider-stream-error-provenance.ts";

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
const numberIsInteger = Number.isInteger;
const regExpExec = RegExp.prototype.exec;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const arrayPush = Array.prototype.push;
const NativeSet = Set;
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

function readOwnErrorDataField(error: Error, key: PropertyKey): unknown {
  try {
    const descriptor = getOwnPropertyDescriptor(error, key);
    if (!descriptor || !hasOwn(descriptor, "value")) return undefined;
    return descriptor.value;
  } catch (_) {
    return undefined;
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
 * Whether a telemetry snapshot keeps the source error's stack.
 *
 * `withStack` is for an error that actually unwound through the region being
 * reported on: its frames describe the failure. `withoutStack` is for an error
 * built at the reporting site to classify a failure it did not itself raise.
 * Those frames describe the reporting code, they carry the absolute paths of
 * whichever machine ran it, and they say nothing about what went wrong, so they
 * must not leave the process.
 */
export type TelemetryErrorDetail = "withStack" | "withoutStack";

/**
 * Create an error safe to send to telemetry backends without mutating or
 * replacing the application error that will be returned to the caller.
 *
 * Native errors are classified through a hook-free runtime brand check. Older
 * supported runtimes use the platform compatibility implementation instead of
 * the unsafe `instanceof` fallback that executes Proxy traps.
 *
 * Pass `"withoutStack"` when `error` stands in for the failure rather than
 * being it. The snapshot then has no `stack` at all, which is what keeps
 * `recordException` from exporting an `exception.stacktrace`.
 */
export function sanitizeErrorForTelemetry(
  error: unknown,
  detail: TelemetryErrorDetail = "withStack",
  safeName?: string,
): Error {
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
      : safeName === undefined
      ? "Unknown"
      : sanitizeTelemetryText(safeName, LOG_PREVIEW_MAX_LENGTH_CHARS);
    const sourceStack = source && detail === "withStack" ? readNativeErrorStack(source) : undefined;
    const stack = sourceStack === undefined
      ? undefined
      : sanitizeTelemetryText(sourceStack, MAX_STRING_DISPLAY_LENGTH);

    return createDetachedTelemetryError(message, name, stack);
  } catch (_) {
    // Telemetry is best effort and must never replace the application outcome.
    return createErrorShapedRecord("Unknown error", "Unknown");
  }
}

const RUNTIME_PROVIDER_STREAM_FAILURE = "RuntimeProviderStreamFailure";

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

function matchTransientErrorCode(text: string): string | undefined {
  try {
    const match = apply(regExpExec, TELEMETRY_ERROR_CODE_RE, [text]) as RegExpExecArray | null;
    return typeof match?.[1] === "string" ? match[1] : undefined;
  } catch (_) {
    return undefined;
  }
}

/** Whether text names one of the transient network codes above. */
export function hasTransientErrorCode(text: string): boolean {
  return matchTransientErrorCode(text) !== undefined;
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
    const veryfrontError = snapshotVeryfrontError(error);
    if (veryfrontError) return `VeryfrontError:${veryfrontError.status}`;
    // Brand-checked rather than name-matched: the wrapper's cause is private,
    // so its type is the only span-safe signal that the provider stream broke.
    if (readRuntimeProviderStreamFailureCause(error).found) return RUNTIME_PROVIDER_STREAM_FAILURE;
    if (!isNativeErrorWithoutHooks(error)) return "Unknown";

    const code = readOwnErrorDataField(error, "code");
    if (typeof code === "string") {
      const match = matchTransientErrorCode(code);
      if (match) return match;
    }

    const name = readNativeErrorNameWithoutHooks(error);
    return apply(setHas, SAFE_TELEMETRY_ERROR_NAMES, [name]) === true ? name : "Error";
  } catch (_) {
    // Classification is best effort and must never change the outcome it reports on.
    return "Error";
  }
}

const NO_CAUSE = Symbol("no-cause");
const MAX_LOGGED_ERROR_CAUSES = 4;

/**
 * The failure an error wraps: the private cause of a provider stream failure,
 * else a native error's own `cause` data property. Accessors are never run.
 */
function readErrorCause(error: unknown): unknown {
  try {
    const providerFailure = readRuntimeProviderStreamFailureCause(error);
    if (providerFailure.found) return providerFailure.cause;
    if (!isNativeErrorWithoutHooks(error)) return NO_CAUSE;
    const descriptor = getOwnPropertyDescriptor(error, "cause");
    if (!descriptor || !hasOwn(descriptor, "value")) return NO_CAUSE;
    return descriptor.value;
  } catch (_) {
    return NO_CAUSE;
  }
}

/**
 * Bounded classification of the failure an error wraps, for a span attribute
 * such as `error.cause.type`. Same safety posture as `telemetryErrorType`: the
 * cause's message never leaves the process.
 */
export function telemetryErrorCauseType(error: unknown): string | undefined {
  try {
    const cause = readErrorCause(error);
    return cause === NO_CAUSE ? undefined : telemetryErrorType(cause);
  } catch (_) {
    return undefined;
  }
}

/** One link of a wrapped error's cause chain, safe to put in a server log. */
export interface LoggedErrorCause {
  name: string;
  /** Present only for exact allowlisted diagnostics; see {@link LOGGABLE_CAUSE_MESSAGES}. */
  message?: string;
  /** True when the cause had a message that was withheld because it may carry untrusted content. */
  messageRedacted?: true;
  code?: string;
  provider?: string;
  status?: number;
  retryable?: boolean;
  /** An exact fixed protocol issue from the successful HTTP stream parser. */
  streamIssue?: string;
}

/**
 * The complete set of cause messages safe to log verbatim: the exact texts the
 * Anthropic stream parser emits with its fixed limits, and one fixed transport
 * message. Matching is by equality, so no variable text (counts, identifiers,
 * customer data) can pass, whichever component throws the error. Every other
 * cause message may embed untrusted data and is withheld.
 */
const LOGGABLE_CAUSE_MESSAGES = new NativeSet<string>([
  "Anthropic partial_json exceeded 4096 deltas",
  "Anthropic partial_json exceeded 4096 empty fragments",
  "Anthropic partial_json exceeded 1048576 UTF-8 bytes",
  "Anthropic retained content exceeded 8192 items (content block)",
  "Anthropic retained content exceeded 8192 items (citation delta)",
  "Anthropic retained content exceeded 8192 items (text delta)",
  "Anthropic retained content exceeded 8192 items (thinking delta)",
  "Anthropic retained content exceeded 8192 empty fragments (text delta)",
  "Anthropic retained content exceeded 8192 empty fragments (thinking delta)",
  "Anthropic retained content exceeded 16777216 UTF-8 bytes (content block)",
  "Anthropic retained content exceeded 16777216 UTF-8 bytes (citation delta)",
  "Anthropic retained content exceeded 16777216 UTF-8 bytes (text delta)",
  "Anthropic retained content exceeded 16777216 UTF-8 bytes (thinking delta)",
  "error reading a body from connection",
]);

function isLoggableCauseMessage(message: string): boolean {
  return apply(setHas, LOGGABLE_CAUSE_MESSAGES, [message]) === true;
}

const LOGGABLE_PROVIDER_ERROR_NAMES = new NativeSet<string>([
  "ProviderError",
  "ProviderOverloadedError",
  "ProviderRateLimitError",
  "ProviderQuotaError",
  "ProviderRequestError",
  "ProviderOutputTruncatedError",
]);

const LOGGABLE_PROVIDER_NAMES = new NativeSet<string>([
  "anthropic",
  "google",
  "mistral",
  "moonshotai",
  "openai",
]);

function readHttpStatusForLog(error: Error): number | undefined {
  const status = readOwnErrorDataField(error, "status");
  if (typeof status === "number" && numberIsInteger(status) && status >= 100 && status <= 599) {
    return status;
  }
  const statusCode = readOwnErrorDataField(error, "statusCode");
  if (
    typeof statusCode === "number" && numberIsInteger(statusCode) && statusCode >= 100 &&
    statusCode <= 599
  ) {
    return statusCode;
  }
  return undefined;
}

/** Fixed direct/delegated parser classifications only; never retain provider text. */
const LOGGABLE_OPENAI_STREAM_ISSUES = new NativeSet<string>([
  "SSE buffer exceeded 8388608 code units",
  "SSE event framing was malformed",
  "URL citation annotation was malformed",
  "added function call id or name was missing",
  "added function call was not in its initial state",
  "added message content part annotations were not empty",
  "added message content part was not empty",
  "added message content was not an array",
  "added message role was not assistant",
  "added message was not in its initial state",
  "added output item output index was malformed",
  "added output item type or id was missing",
  "added output item was not an object",
  "added reasoning content part was not empty",
  "added reasoning item was not in its initial state",
  "added reasoning summary part was not empty",
  "added web-search call was not in its initial state",
  "choice delta content exceeded 4096 parts",
  "choice delta content had an invalid type",
  "choice delta content part type was unsupported",
  "choice delta content part was not an object",
  "choice delta refusal part was malformed",
  "choice delta role was not assistant",
  "choice delta text part was malformed",
  "choice delta was not an object",
  "choice finish reason was malformed",
  "choice had neither a delta nor a finish reason",
  "choices was not an array",
  "completed function call arguments disagreed with streamed deltas",
  "completed function call arguments or status were malformed",
  "completed function call id changed",
  "completed function call name changed",
  "completed function call referenced an unknown item",
  "completed function-call arguments disagreed with streamed deltas",
  "completed function-call arguments malformed",
  "completed function-call arguments name changed",
  "completed function-call arguments output index changed",
  "completed function-call arguments output index was malformed",
  "completed function-call arguments output index was owned by another item",
  "completed function-call arguments referenced an unknown item",
  "completed function-call arguments referenced an unknown output item",
  "completed message content part annotation range exceeded its text",
  "completed message content part annotations changed",
  "completed message content part annotations disagreed with streamed annotations",
  "completed message content part annotations were malformed",
  "completed message content part attached annotations to a refusal",
  "completed message content part changed content-part type",
  "completed message content part changed its final value",
  "completed message content part disagreed with streamed deltas",
  "completed message content part type was unsupported",
  "completed message content part value was malformed",
  "completed message content part was not an object",
  "completed message had an unfinished content part",
  "completed message omitted a streamed content part",
  "completed message referenced an unknown item",
  "completed message role, content, or status were malformed",
  "completed message value changed content-part type",
  "completed message value changed its final value",
  "completed message value disagreed with streamed deltas",
  "completed message value item id was missing",
  "completed message value output index changed",
  "completed message value output index was malformed",
  "completed message value output index was owned by another item",
  "completed message value referenced an unknown message item",
  "completed message value referenced an unknown output item",
  "completed message value was malformed",
  "completed output item output index changed",
  "completed output item output index was malformed",
  "completed output item output index was owned by another item",
  "completed output item referenced an unknown output item",
  "completed output item status was malformed",
  "completed output item type changed",
  "completed output item type or id was missing",
  "completed output item type was unsupported",
  "completed output item was not an object",
  "completed output referenced an unknown item",
  "completed reasoning content part changed its final value",
  "completed reasoning content part disagreed with streamed deltas",
  "completed reasoning content part was malformed",
  "completed reasoning content was not an array",
  "completed reasoning had an unfinished content part",
  "completed reasoning had an unfinished summary part",
  "completed reasoning omitted a streamed content part",
  "completed reasoning omitted a streamed summary part",
  "completed reasoning omitted its content parts",
  "completed reasoning omitted its summary parts",
  "completed reasoning referenced an unknown item",
  "completed reasoning summary part changed its final value",
  "completed reasoning summary part disagreed with streamed deltas",
  "completed reasoning summary part was malformed",
  "completed reasoning summary was not an array",
  "completed reasoning text changed its final value",
  "completed reasoning text disagreed with streamed deltas",
  "completed web-search call referenced an unknown item",
  "content-part event referenced an unknown output item",
  "content-part event referenced an unsupported output item",
  "done marker arrived before a finish reason",
  "done marker arrived before a terminal response event",
  "event had neither choices nor usage",
  "event type was missing",
  "event was not an object",
  "first choice was not an object",
  "function call arguments exceeded 1048576 UTF-8 bytes",
  "function call arguments exceeded 4096 fragments",
  "function call arguments were not valid JSON object text",
  "function call id was reused",
  "function call was incomplete",
  "function-call arguments completed twice",
  "function-call delta followed completed arguments",
  "function-call delta output index changed",
  "function-call delta output index was malformed",
  "function-call delta output index was owned by another item",
  "function-call delta referenced an unknown item",
  "function-call delta referenced an unknown output item",
  "function-call delta was malformed",
  "message content index was malformed",
  "message content part changed content-part type",
  "message content part completed before it was added",
  "message content part completed twice",
  "message content part type was unsupported",
  "message content part value was malformed",
  "message content part was added twice",
  "message content part was not an object",
  "message content-part event item id was missing",
  "message content-part event output index changed",
  "message content-part event output index was malformed",
  "message content-part event output index was owned by another item",
  "message content-part event referenced an unknown message item",
  "message content-part event referenced an unknown output item",
  "message delta changed content-part type",
  "message delta followed a completed part",
  "message delta item id was missing",
  "message delta output index changed",
  "message delta output index was malformed",
  "message delta output index was owned by another item",
  "message delta referenced an unknown message item",
  "message delta referenced an unknown output item",
  "message snapshot exceeded 8388608 UTF-8 bytes",
  "message value completed twice",
  "output index was reused by another item",
  "output item was added twice",
  "output-text annotation event changed content-part type",
  "output-text annotation event item id was missing",
  "output-text annotation event output index changed",
  "output-text annotation event output index was malformed",
  "output-text annotation event output index was owned by another item",
  "output-text annotation event referenced an unknown message item",
  "output-text annotation event referenced an unknown output item",
  "output-text annotation followed a completed part",
  "output-text annotation index was malformed",
  "output-text annotation index was reused",
  "output-text delta was malformed",
  "provider emitted an error event",
  "provider emitted web search without a configured web-search tool",
  "raw response metadata exceeded 8388608 UTF-8 bytes",
  "raw response metadata omitted a completed output item",
  "raw response output indexes were not contiguous",
  "raw response output items were unsafe to replay",
  "raw response output order was only partially indexed",
  "reasoning content part completed before it was added",
  "reasoning content part completed twice",
  "reasoning content part referenced an unknown reasoning item",
  "reasoning content part was added twice",
  "reasoning content part was malformed",
  "reasoning delta followed a completed part",
  "reasoning delta was malformed",
  "reasoning summary index was malformed",
  "reasoning summary part completed before it was added",
  "reasoning summary part completed twice",
  "reasoning summary part was added twice",
  "reasoning summary part was malformed",
  "reasoning summary-part event item id was missing",
  "reasoning summary-part event output index changed",
  "reasoning summary-part event output index was malformed",
  "reasoning summary-part event output index was owned by another item",
  "reasoning summary-part event referenced an unknown output item",
  "reasoning text completed twice",
  "reasoning text event item id was missing",
  "reasoning text event output index changed",
  "reasoning text event output index was malformed",
  "reasoning text event output index was owned by another item",
  "reasoning text event referenced an unknown item",
  "reasoning text event referenced an unknown output item",
  "reasoning text event was malformed",
  "refusal delta was malformed",
  "response lifecycle status did not match its event type",
  "stream chunk was not binary data",
  "stream contained choice data after its finish reason",
  "stream contained data after its done marker",
  "stream contained data after its terminal event",
  "stream contained invalid UTF-8",
  "stream contained multiple done markers",
  "stream contained multiple terminal events",
  "stream contained no choice envelope",
  "stream ended before a finish reason",
  "stream ended before a terminal response event",
  "stream ended with unfinished output items",
  "stream ended with unfinished tool calls",
  "stream exceeded 1024 tool calls",
  "stream exceeded 4096 content parts",
  "stream exceeded 4096 output items",
  "terminal response arrived with unfinished output items",
  "terminal response status did not match its event type",
  "terminal response status was missing",
  "tool call arguments arrived before its id and name",
  "tool call arguments delta was malformed",
  "tool call arguments exceeded 1048576 UTF-8 bytes",
  "tool call arguments exceeded 4096 fragments",
  "tool call arguments were not valid JSON object text",
  "tool call delta was not an object",
  "tool call function name changed while streaming",
  "tool call function name was malformed",
  "tool call function was not an object",
  "tool call id changed while streaming",
  "tool call id was malformed",
  "tool call id was reused",
  "tool call id was reused at another index",
  "tool call index was malformed",
  "tool call type was not function",
  "tool call was incomplete",
  "tool-call finish contained no tool calls",
  "tool_calls delta was not an array",
  "trailing SSE event was malformed",
  "web-search action exceeded the tool-input limit",
  "web-search action type was unsupported",
  "web-search action was malformed",
  "web-search find-in-page action was malformed",
  "web-search lifecycle event item id was missing",
  "web-search lifecycle event output index changed",
  "web-search lifecycle event output index was malformed",
  "web-search lifecycle event output index was owned by another item",
  "web-search lifecycle event referenced an unknown item",
  "web-search lifecycle event referenced an unknown output item",
  "web-search lifecycle moved backward or repeated a phase",
  "web-search open-page action was malformed",
  "web-search output item identity or status was malformed",
  "web-search search action was malformed",
  "web-search source was malformed",
  "web-search sources were malformed",
]);
const SUCCESSFUL_OPENAI_STREAM_MESSAGE =
  /^(?:OpenAI|openai) request failed: invalid successful stream \(([^)]+)\)$/;

function addSuccessfulStreamIssueForLog(error: Error, entry: LoggedErrorCause): void {
  if (
    entry.name !== "ProviderRequestError" || entry.provider !== "openai" || entry.status !== 200
  ) return;
  const message = readOwnErrorDataField(error, "message");
  if (typeof message !== "string" || message.length > MAX_STRING_DISPLAY_LENGTH) return;
  const match = apply(regExpExec, SUCCESSFUL_OPENAI_STREAM_MESSAGE, [message]) as
    | RegExpExecArray
    | null;
  const issue = match?.[1];
  if (typeof issue === "string" && apply(setHas, LOGGABLE_OPENAI_STREAM_ISSUES, [issue]) === true) {
    entry.streamIssue = issue;
  }
}

function addBoundedProviderDiagnostics(error: Error, entry: LoggedErrorCause): void {
  const rawName = readNativeErrorNameWithoutHooks(error);
  if (apply(setHas, LOGGABLE_PROVIDER_ERROR_NAMES, [rawName]) === true) {
    entry.name = rawName;
  }

  const provider = readOwnErrorDataField(error, "provider");
  if (
    typeof provider === "string" &&
    apply(setHas, LOGGABLE_PROVIDER_NAMES, [provider]) === true
  ) {
    entry.provider = provider;
  }

  const status = readHttpStatusForLog(error);
  if (status !== undefined) entry.status = status;

  const retryable = readOwnErrorDataField(error, "retryable");
  if (typeof retryable === "boolean") entry.retryable = retryable;
}

/**
 * Summarize the failures an error wraps for a server log: name, a
 * exact allowlisted diagnostics when present. Stacks and arbitrary messages
 * are omitted, the chain is capped, and accessors are never run. Returns
 * undefined when the error wraps nothing.
 */
export function summarizeErrorCausesForLog(error: unknown): LoggedErrorCause[] | undefined {
  const causes: LoggedErrorCause[] = [];
  try {
    const seen = new NativeSet<unknown>();
    apply(setAdd, seen, [error]);
    let cause = readErrorCause(error);
    while (cause !== NO_CAUSE && causes.length < MAX_LOGGED_ERROR_CAUSES) {
      if (apply(setHas, seen, [cause]) === true) break;
      apply(setAdd, seen, [cause]);
      const snapshot = sanitizeErrorForTelemetry(cause, "withoutStack");
      // Name and code are logged only as fixed classifications: an allowlisted
      // error name (else "Error"/"Unknown") and a known transient code token.
      const entry: LoggedErrorCause = { name: "Unknown" };
      if (isNativeErrorWithoutHooks(cause)) {
        const rawName = readNativeErrorNameWithoutHooks(cause);
        entry.name = apply(setHas, SAFE_TELEMETRY_ERROR_NAMES, [rawName]) === true
          ? rawName
          : "Error";
        const code = readOwnErrorDataField(cause, "code");
        const knownCode = typeof code === "string" ? matchTransientErrorCode(code) : undefined;
        if (knownCode !== undefined) entry.code = knownCode;
        addBoundedProviderDiagnostics(cause, entry);
        addSuccessfulStreamIssueForLog(cause, entry);
      }
      if (isLoggableCauseMessage(snapshot.message)) {
        entry.message = snapshot.message;
      } else if (snapshot.message.length > 0) {
        entry.messageRedacted = true;
      }
      apply(arrayPush, causes, [entry]);
      cause = readErrorCause(cause);
    }
  } catch (_) {
    // Diagnostics are best effort and must never replace the logged failure.
  }
  return causes.length > 0 ? causes : undefined;
}
