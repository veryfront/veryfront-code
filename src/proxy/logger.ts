import { getBaseLogger, type Logger, redactForSerialization } from "#veryfront/utils";
import { REDACTED } from "#veryfront/utils/logger/redact.ts";
import { MAX_STRING_DISPLAY_LENGTH } from "#veryfront/utils/constants/limits.ts";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request fields attached to every proxy log emitted inside one request.
 *
 * The context is snapshotted before entering AsyncLocalStorage, so caller
 * mutation and accessors cannot change later log records.
 */
export interface ProxyRequestContext {
  readonly requestId: string;
  readonly projectSlug?: string;
  readonly projectId?: string;
  readonly releaseId?: string;
  readonly branchId?: string;
  readonly branchName?: string;
  readonly domain?: string;
  readonly environment?: string;
}

interface ProxyTraceContext {
  readonly traceId?: string;
  readonly spanId?: string;
}

const REQUEST_CONTEXT_KEYS = new Set([
  "requestId",
  "projectSlug",
  "projectId",
  "releaseId",
  "branchId",
  "branchName",
  "domain",
  "environment",
]);
const OPTIONAL_REQUEST_CONTEXT_KEYS = [
  "projectSlug",
  "projectId",
  "releaseId",
  "branchId",
  "branchName",
  "domain",
  "environment",
] as const;
const EMPTY_CONTEXT = Object.freeze({}) as Readonly<Record<string, unknown>>;

const requestContextStore = new AsyncLocalStorage<ProxyRequestContext>();
let traceContextGetter: (() => ProxyTraceContext) | null = null;

function readOwnDataValue(
  descriptors: PropertyDescriptorMap,
  key: string,
): unknown {
  const descriptor = descriptors[key];
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Proxy request context ${key} must be a data property`);
  }
  return descriptor.value;
}

function snapshotProxyRequestContext(
  context: ProxyRequestContext,
): ProxyRequestContext {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError("Proxy request context must be a plain object");
  }

  let prototype: object | null;
  let keys: PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(context);
    keys = Reflect.ownKeys(context);
    descriptors = Object.getOwnPropertyDescriptors(context);
  } catch (error) {
    throw new TypeError("Proxy request context is unreadable", { cause: error });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Proxy request context must be a plain object");
  }
  if (
    keys.some((key) => typeof key !== "string" || !REQUEST_CONTEXT_KEYS.has(key))
  ) {
    throw new TypeError("Proxy request context contains an unknown field");
  }

  const requestId = readOwnDataValue(descriptors, "requestId");
  if (typeof requestId !== "string" || requestId.length === 0) {
    throw new TypeError("Proxy request context requestId must be a non-empty string");
  }

  const snapshot: Record<string, string> = { requestId };
  for (const key of OPTIONAL_REQUEST_CONTEXT_KEYS) {
    const value = readOwnDataValue(descriptors, key);
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new TypeError(`Proxy request context ${key} must be a string`);
    }
    if (value !== "") snapshot[key] = value;
  }
  return Object.freeze(snapshot) as unknown as ProxyRequestContext;
}

/**
 * Run a function with an immutable proxy request context.
 *
 * All proxy logs within the async call tree receive these fields.
 */
export function runWithProxyRequestContext<T>(
  context: ProxyRequestContext,
  fn: () => T,
): T {
  return requestContextStore.run(snapshotProxyRequestContext(context), fn);
}

/**
 * Register the active trace accessor without introducing a logger ↔ tracing
 * module cycle. The disposer restores the previous accessor for isolated tests.
 *
 * @internal
 */
export function __registerProxyTraceContextGetter(
  getter: (() => ProxyTraceContext) | null,
): () => void {
  const previous = traceContextGetter;
  traceContextGetter = getter;
  return () => {
    if (traceContextGetter === getter) traceContextGetter = previous;
  };
}

function snapshotTraceContext(): ProxyTraceContext {
  if (!traceContextGetter) return EMPTY_CONTEXT;
  try {
    const value = traceContextGetter();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return EMPTY_CONTEXT;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const traceId = readOwnDataValue(descriptors, "traceId");
    const spanId = readOwnDataValue(descriptors, "spanId");
    return Object.freeze({
      ...(typeof traceId === "string" && traceId !== "" ? { traceId } : {}),
      ...(typeof spanId === "string" && spanId !== "" ? { spanId } : {}),
    });
  } catch {
    return EMPTY_CONTEXT;
  }
}

function snapshotAmbientContext(): Record<string, unknown> {
  return {
    ...snapshotTraceContext(),
    ...(requestContextStore.getStore() ?? EMPTY_CONTEXT),
  };
}

/**
 * The shared logger invokes `toJSON` only after its log-level gate. This keeps
 * AsyncLocalStorage and tracing work off suppressed debug paths while still
 * making the ambient fields available to both text and JSON formatters.
 */
const ambientContext = Object.freeze({
  toJSON: snapshotAmbientContext,
});

function snapshotBoundContext(
  context: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  try {
    const value = redactForSerialization(context);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return Object.freeze({ unreadable_context: REDACTED });
    }
    return Object.freeze(value);
  } catch {
    return Object.freeze({ unreadable_context: REDACTED });
  }
}

function isPlainContext(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  try {
    if (Array.isArray(value) || value instanceof Error) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function normalizeUnknownError(value: unknown): Error | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    if (value instanceof Error) return value;
  } catch {
    // An unreadable proxy is represented by a bounded generic error below.
  }

  let message = REDACTED;
  try {
    const redacted = redactForSerialization(value);
    const serialized = typeof redacted === "string" ? redacted : JSON.stringify(redacted);
    if (serialized) message = serialized.slice(0, MAX_STRING_DISPLAY_LENGTH);
  } catch {
    // Never inspect the original value again after serialization fails.
  }
  const error = new Error(message);
  error.name = "UnknownError";
  return error;
}

type ProxyLogMethod = "debug" | "info" | "warn" | "error";

class ProxyLogger {
  constructor(
    private readonly delegate: Logger,
    private readonly boundContext: Readonly<Record<string, unknown>> = EMPTY_CONTEXT,
  ) {}

  private emit(
    method: ProxyLogMethod,
    message: string,
    args: readonly unknown[],
  ): void {
    try {
      this.delegate[method](message, ...args, ambientContext);
    } catch {
      // A diagnostic sink must not become a request or shutdown failure.
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.emit("debug", message, [this.boundContext, context]);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit("info", message, [this.boundContext, context]);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit("warn", message, [this.boundContext, context]);
  }

  error(message: string, error?: unknown): void;
  error(message: string, context: Record<string, unknown>, error?: unknown): void;
  error(
    message: string,
    contextOrError?: Record<string, unknown> | unknown,
    error?: unknown,
  ): void {
    if (error !== undefined) {
      this.emit("error", message, [
        this.boundContext,
        contextOrError,
        normalizeUnknownError(error),
      ]);
      return;
    }

    if (isPlainContext(contextOrError)) {
      this.emit("error", message, [this.boundContext, contextOrError]);
      return;
    }

    this.emit("error", message, [
      this.boundContext,
      normalizeUnknownError(contextOrError),
    ]);
  }

  child(context: Record<string, unknown>): ProxyLogger {
    const childContext = snapshotBoundContext(context);
    return new ProxyLogger(
      this.delegate,
      Object.freeze({ ...this.boundContext, ...childContext }),
    );
  }
}

export const proxyLogger = new ProxyLogger(getBaseLogger("PROXY"));
