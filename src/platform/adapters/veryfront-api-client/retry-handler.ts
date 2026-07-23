import { logger } from "#veryfront/utils/logger/logger.ts";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import {
  recordApiRequest,
  recordApiRetry,
} from "#veryfront/observability/simple-metrics/metrics-recorder.ts";
import { API_CLIENT_ERROR, type VeryfrontAPIRequestPolicy, VeryfrontError } from "./types.ts";

const apiLog = logger.component("api");
const veryfrontApiClientLog = logger.component("veryfront-api-client");

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
}

export interface RequestTelemetry {
  /** Stable code-owned operation name. Never include request or customer data. */
  operation: string;
  /** Stable route template. Never include concrete URL segments. */
  route: string;
}

export interface RequestOptions extends VeryfrontAPIRequestPolicy {
  returnText?: boolean;
  method?: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
  /** Allow retries for a request whose method is not inherently idempotent. */
  retryable?: boolean;
  /** Demote an expected 404 miss to debug while preserving thrown error semantics. */
  expected404?: boolean;
  /** Code-owned metadata used by logs, traces, and structured errors. */
  telemetry?: RequestTelemetry;
}

/** Resolved immutable request policy used when no caller override is present. */
export interface ResolvedVeryfrontAPIRequestPolicy {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxResponseBytes: number;
}

/** Default lifecycle and response limits for Veryfront API operations. */
export const DEFAULT_VERYFRONT_API_REQUEST_POLICY: Readonly<
  ResolvedVeryfrontAPIRequestPolicy
> = Object.freeze({
  timeoutMs: 30_000,
  totalTimeoutMs: 120_000,
  maxResponseBytes: 64 * 1024 * 1024,
});

const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_VERYFRONT_API_REQUEST_POLICY.timeoutMs;
const DEFAULT_TOTAL_REQUEST_TIMEOUT_MS = DEFAULT_VERYFRONT_API_REQUEST_POLICY.totalTimeoutMs;
const DEFAULT_MAX_RESPONSE_BYTES = DEFAULT_VERYFRONT_API_REQUEST_POLICY.maxResponseBytes;
const MAX_CONFIGURABLE_RESPONSE_BYTES = 256 * 1024 * 1024;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_RETRIES = 20;
const HTTP_METHOD_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const TELEMETRY_OPERATION_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/;
const TELEMETRY_ROUTE_PATTERN =
  /^(?:unclassified|\/(?:[a-z0-9-]+|\{[a-z][a-z0-9_]*\})(?:\/(?:[a-z0-9-]+|\{[a-z][a-z0-9_]*\}))*)$/;
const DEFAULT_REQUEST_TELEMETRY: Readonly<RequestTelemetry> = Object.freeze({
  operation: "apiRequest",
  route: "unclassified",
});
const retryAfterByError = new WeakMap<Error, number>();
const nonRetryableErrors = new WeakSet<Error>();

function invalidRequest(detail: string, status = 400): VeryfrontError {
  return API_CLIENT_ERROR.create({ detail, status });
}

const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;

function isUsableAbortSignal(value: unknown): value is AbortSignal {
  try {
    if (!(value instanceof AbortSignal) || abortSignalAbortedGetter === undefined) return false;
    const aborted = abortSignalAbortedGetter.call(value);
    return typeof aborted === "boolean" && Reflect.get(value, "aborted") === aborted &&
      typeof Reflect.get(value, "addEventListener") === "function" &&
      typeof Reflect.get(value, "removeEventListener") === "function";
  } catch (_) {
    return false;
  }
}

function isSignalAborted(signal: AbortSignal): boolean {
  try {
    return abortSignalAbortedGetter?.call(signal) === true;
  } catch (_) {
    throw invalidRequest("API request signal is invalid");
  }
}

function addAbortListener(signal: AbortSignal, listener: EventListener): void {
  try {
    EventTarget.prototype.addEventListener.call(signal, "abort", listener, { once: true });
  } catch (_) {
    throw invalidRequest("API request signal is invalid");
  }
}

function removeAbortListener(signal: AbortSignal, listener: EventListener): void {
  try {
    EventTarget.prototype.removeEventListener.call(signal, "abort", listener);
  } catch (_) {
    throw invalidRequest("API request signal is invalid");
  }
}

function isValidTimerValue(value: unknown, allowZero: boolean): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value <= MAX_TIMER_DELAY_MS &&
    (allowZero ? value >= 0 : value > 0);
}

/**
 * Read, validate, and freeze a high-level request policy before an operation
 * performs any asynchronous or network work.
 *
 * This is an internal composition helper. Public callers configure the policy
 * through `VeryfrontAPIConfig` or a high-level method argument.
 */
export function snapshotAPIRequestPolicy(
  policy: unknown,
  fallback: Readonly<ResolvedVeryfrontAPIRequestPolicy> = DEFAULT_VERYFRONT_API_REQUEST_POLICY,
): Readonly<ResolvedVeryfrontAPIRequestPolicy> {
  if (policy === undefined) return fallback;
  if (typeof policy !== "object" || policy === null) {
    throw invalidRequest("Veryfront API request policy must be an object");
  }
  let isArray: boolean;
  try {
    isArray = Array.isArray(policy);
  } catch (_) {
    throw invalidRequest("Veryfront API request policy could not be read");
  }
  if (isArray) throw invalidRequest("Veryfront API request policy must be an object");

  let signal: unknown;
  let timeoutMs: unknown;
  let totalTimeoutMs: unknown;
  let maxResponseBytes: unknown;
  try {
    signal = Reflect.get(policy, "signal");
    timeoutMs = Reflect.get(policy, "timeoutMs");
    totalTimeoutMs = Reflect.get(policy, "totalTimeoutMs");
    maxResponseBytes = Reflect.get(policy, "maxResponseBytes");
  } catch (_) {
    throw invalidRequest("Veryfront API request policy could not be read");
  }

  const resolvedSignal = signal === undefined ? fallback.signal : signal;
  const resolvedTimeoutMs = timeoutMs === undefined ? fallback.timeoutMs : timeoutMs;
  const resolvedTotalTimeoutMs = totalTimeoutMs === undefined
    ? fallback.totalTimeoutMs
    : totalTimeoutMs;
  const resolvedMaxResponseBytes = maxResponseBytes === undefined
    ? fallback.maxResponseBytes
    : maxResponseBytes;
  if (resolvedSignal !== undefined && !isUsableAbortSignal(resolvedSignal)) {
    throw invalidRequest("Veryfront API request policy signal is invalid");
  }
  if (!isValidTimerValue(resolvedTimeoutMs, false)) {
    throw invalidRequest(
      "Veryfront API request timeout must be a positive integer in milliseconds",
    );
  }
  if (!isValidTimerValue(resolvedTotalTimeoutMs, false)) {
    throw invalidRequest(
      "Veryfront API total request timeout must be a positive integer in milliseconds",
    );
  }
  if (
    !Number.isSafeInteger(resolvedMaxResponseBytes) ||
    (resolvedMaxResponseBytes as number) <= 0 ||
    (resolvedMaxResponseBytes as number) > MAX_CONFIGURABLE_RESPONSE_BYTES
  ) {
    throw invalidRequest(
      `Veryfront API maximum response size must be an integer between 1 and ${MAX_CONFIGURABLE_RESPONSE_BYTES} bytes`,
    );
  }

  return Object.freeze({
    signal: resolvedSignal as AbortSignal | undefined,
    timeoutMs: resolvedTimeoutMs,
    totalTimeoutMs: resolvedTotalTimeoutMs,
    maxResponseBytes: resolvedMaxResponseBytes as number,
  });
}

function normalizeRetryConfig(config: unknown): RetryConfig {
  if ((typeof config !== "object" && typeof config !== "function") || config === null) {
    throw invalidRequest("Retry configuration must be an object");
  }

  let maxRetries: unknown;
  let initialDelay: unknown;
  let maxDelay: unknown;
  try {
    maxRetries = Reflect.get(config, "maxRetries");
    initialDelay = Reflect.get(config, "initialDelay");
    maxDelay = Reflect.get(config, "maxDelay");
  } catch (_) {
    throw invalidRequest("Retry configuration could not be read");
  }

  if (
    !Number.isSafeInteger(maxRetries) || (maxRetries as number) < 0 ||
    (maxRetries as number) > MAX_RETRIES
  ) {
    throw invalidRequest(`Retry maxRetries must be an integer between 0 and ${MAX_RETRIES}`);
  }
  if (!isValidTimerValue(initialDelay, true)) {
    throw invalidRequest("Retry initialDelay must be a non-negative integer in milliseconds");
  }
  if (!isValidTimerValue(maxDelay, true)) {
    throw invalidRequest("Retry maxDelay must be a non-negative integer in milliseconds");
  }

  return { maxRetries: maxRetries as number, initialDelay, maxDelay };
}

/** Validate retry settings before any network side effect occurs. */
export function validateRetryConfig(config: RetryConfig): void {
  normalizeRetryConfig(config);
}

function parseRequestUrl(url: string): URL {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw invalidRequest("API request URL must use HTTP or HTTPS");
    }
    if (parsed.username || parsed.password) {
      throw invalidRequest("API request URL must not contain credentials");
    }
    return parsed;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    throw invalidRequest("API request URL is invalid");
  }
}

function normalizeRequestTelemetry(telemetry: unknown): Readonly<RequestTelemetry> {
  if (telemetry === undefined) return DEFAULT_REQUEST_TELEMETRY;
  if ((typeof telemetry !== "object" && typeof telemetry !== "function") || telemetry === null) {
    throw invalidRequest("API request telemetry metadata is invalid");
  }

  let operation: unknown;
  let route: unknown;
  try {
    operation = Reflect.get(telemetry, "operation");
    route = Reflect.get(telemetry, "route");
  } catch (_) {
    throw invalidRequest("API request telemetry metadata is invalid");
  }
  if (
    typeof operation !== "string" || typeof route !== "string" ||
    !TELEMETRY_OPERATION_PATTERN.test(operation) ||
    !TELEMETRY_ROUTE_PATTERN.test(route)
  ) {
    throw invalidRequest("API request telemetry metadata is invalid");
  }
  return Object.freeze({ operation, route });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const normalized = value.trim();

  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    const milliseconds = seconds * 1_000;
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function hasOneShotBody(body: BodyInit | null | undefined): boolean {
  return typeof ReadableStream !== "undefined" && body instanceof ReadableStream;
}

function snapshotBody(body: unknown): BodyInit | null | undefined {
  try {
    if (body === null || body === undefined || typeof body === "string") return body;
    if (body instanceof URLSearchParams) return new URLSearchParams(body);
    if (body instanceof FormData) {
      const snapshot = new FormData();
      for (const [name, value] of body.entries()) {
        if (typeof value === "string") snapshot.append(name, value);
        else snapshot.append(name, value, value.name);
      }
      return snapshot;
    }
    if (body instanceof ArrayBuffer) return body.slice(0);
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice();
    }
    if (typeof Blob !== "undefined" && body instanceof Blob) return body;
    if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return body;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    throw invalidRequest("API request body could not be read");
  }
  throw invalidRequest("API request body is invalid");
}

function snapshotHeaders(headers: unknown): Headers {
  try {
    return new Headers(headers as HeadersInit | undefined);
  } catch (_) {
    throw invalidRequest("API request headers are invalid");
  }
}

function validateApiToken(apiToken: unknown): asserts apiToken is string {
  if (typeof apiToken !== "string" || apiToken.trim().length === 0) {
    throw invalidRequest("No API token available", 401);
  }
  try {
    new Headers({ Authorization: `Bearer ${apiToken}` });
  } catch (_) {
    throw invalidRequest("API token is invalid", 401);
  }
}

function canRetryMethod(
  method: string,
  retryable: boolean | undefined,
  headers: Headers,
): boolean {
  if (retryable !== undefined) return retryable;
  if (["GET", "HEAD", "OPTIONS", "PUT", "DELETE"].includes(method)) return true;
  return (headers.get("Idempotency-Key")?.trim().length ?? 0) > 0;
}

function attemptAbortedError(): DOMException {
  return new DOMException("Request attempt was aborted", "AbortError");
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (isSignalAborted(signal)) return Promise.reject(attemptAbortedError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(attemptAbortedError());
    };
    const cleanup = () => removeAbortListener(signal, onAbort);
    addAbortListener(signal, onAbort);
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function cancelResponseBody(response: Response, signal: AbortSignal): Promise<void> {
  if (!response.body) return;
  try {
    await raceWithAbort(response.body.cancel(), signal);
  } catch (_) {
    // The primary HTTP status error is authoritative. A body may already be
    // closed by a runtime before cancellation reaches this cleanup path.
  }
}

function cancellationError(): VeryfrontError {
  return API_CLIENT_ERROR.create({ detail: "API request was cancelled", status: 499 });
}

async function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  if (signal !== undefined && isSignalAborted(signal)) throw cancellationError();
  if (delay === 0) return;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, delay);
    const onAbort = () => {
      cleanup();
      reject(cancellationError());
    };
    const cleanup = () => {
      clearTimeout(timeoutId);
      if (signal !== undefined) removeAbortListener(signal, onAbort);
    };

    if (signal !== undefined) addAbortListener(signal, onAbort);
  });
}

interface PreparedRequest {
  url: string;
  apiToken: string;
  method: string;
  headers: Headers;
  body: BodyInit | null | undefined;
  returnText: boolean;
  expected404: boolean;
  callerSignal?: AbortSignal;
  timeoutMs: number;
  totalTimeoutMs: number;
  maxResponseBytes: number;
  retryable: boolean;
  oneShotBody: boolean;
  retryConfig: RetryConfig;
  telemetry: Readonly<RequestTelemetry>;
}

interface RequestOptionsSnapshot {
  returnText: unknown;
  timeoutMs: unknown;
  totalTimeoutMs: unknown;
  maxResponseBytes: unknown;
  method: unknown;
  body: unknown;
  headers: unknown;
  signal: unknown;
  retryable: unknown;
  expected404: unknown;
  telemetry: unknown;
}

function snapshotRequestOptions(options: unknown): RequestOptionsSnapshot {
  if (options === undefined) {
    return {
      returnText: undefined,
      timeoutMs: undefined,
      totalTimeoutMs: undefined,
      maxResponseBytes: undefined,
      method: undefined,
      body: undefined,
      headers: undefined,
      signal: undefined,
      retryable: undefined,
      expected404: undefined,
      telemetry: undefined,
    };
  }
  if ((typeof options !== "object" && typeof options !== "function") || options === null) {
    throw invalidRequest("API request options must be an object");
  }
  let isArray: boolean;
  try {
    isArray = Array.isArray(options);
  } catch (_) {
    throw invalidRequest("API request options could not be read");
  }
  if (isArray) throw invalidRequest("API request options must be an object");

  try {
    return {
      returnText: Reflect.get(options, "returnText"),
      timeoutMs: Reflect.get(options, "timeoutMs"),
      totalTimeoutMs: Reflect.get(options, "totalTimeoutMs"),
      maxResponseBytes: Reflect.get(options, "maxResponseBytes"),
      method: Reflect.get(options, "method"),
      body: Reflect.get(options, "body"),
      headers: Reflect.get(options, "headers"),
      signal: Reflect.get(options, "signal"),
      retryable: Reflect.get(options, "retryable"),
      expected404: Reflect.get(options, "expected404"),
      telemetry: Reflect.get(options, "telemetry"),
    };
  } catch (_) {
    throw invalidRequest("API request options could not be read");
  }
}

function validateOptionalBoolean(value: unknown, name: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw invalidRequest(`${name} must be a boolean`);
  return value;
}

interface AttemptControl {
  signal: AbortSignal;
  didTimeout(): boolean;
  cleanup(): void;
}

function prepareRequest(
  url: string,
  apiToken: string,
  retryConfig: RetryConfig,
  options: RequestOptions,
): PreparedRequest {
  const requestRetryConfig = normalizeRetryConfig(retryConfig);
  validateApiToken(apiToken);
  const snapshot = snapshotRequestOptions(options);

  const timeoutMs = snapshot.timeoutMs === undefined
    ? DEFAULT_REQUEST_TIMEOUT_MS
    : snapshot.timeoutMs;
  if (!isValidTimerValue(timeoutMs, false)) {
    throw invalidRequest("Request timeout must be a positive integer in milliseconds");
  }
  const totalTimeoutMs = snapshot.totalTimeoutMs === undefined
    ? DEFAULT_TOTAL_REQUEST_TIMEOUT_MS
    : snapshot.totalTimeoutMs;
  if (!isValidTimerValue(totalTimeoutMs, false)) {
    throw invalidRequest("Total request timeout must be a positive integer in milliseconds");
  }
  const maxResponseBytes = snapshot.maxResponseBytes === undefined
    ? DEFAULT_MAX_RESPONSE_BYTES
    : snapshot.maxResponseBytes;
  if (
    !Number.isSafeInteger(maxResponseBytes) || (maxResponseBytes as number) <= 0 ||
    (maxResponseBytes as number) > MAX_CONFIGURABLE_RESPONSE_BYTES
  ) {
    throw invalidRequest(
      `Maximum response size must be an integer between 1 and ${MAX_CONFIGURABLE_RESPONSE_BYTES} bytes`,
    );
  }
  if (snapshot.signal !== undefined && !isUsableAbortSignal(snapshot.signal)) {
    throw invalidRequest("API request signal is invalid");
  }
  const callerSignal = snapshot.signal as AbortSignal | undefined;
  if (callerSignal !== undefined && isSignalAborted(callerSignal)) throw cancellationError();

  parseRequestUrl(url);
  const rawMethod = snapshot.method ?? "GET";
  if (typeof rawMethod !== "string") throw invalidRequest("API request method is invalid");
  const method = rawMethod.toUpperCase();
  if (!HTTP_METHOD_PATTERN.test(method)) throw invalidRequest("API request method is invalid");
  const headers = snapshotHeaders(snapshot.headers);
  const body = snapshotBody(snapshot.body);
  const retryableOverride = snapshot.retryable === undefined
    ? undefined
    : validateOptionalBoolean(snapshot.retryable, "API request retryable");
  return {
    url,
    apiToken,
    method,
    headers,
    body,
    returnText: validateOptionalBoolean(snapshot.returnText, "API request returnText"),
    expected404: validateOptionalBoolean(snapshot.expected404, "API request expected404"),
    callerSignal,
    timeoutMs,
    totalTimeoutMs,
    maxResponseBytes: maxResponseBytes as number,
    retryable: canRetryMethod(method, retryableOverride, headers),
    oneShotBody: hasOneShotBody(body),
    retryConfig: requestRetryConfig,
    telemetry: normalizeRequestTelemetry(snapshot.telemetry),
  };
}

function createAttemptControl(timeoutMs: number, callerSignal?: AbortSignal): AttemptControl {
  const controller = new AbortController();
  let timedOut = false;
  let cleanedUp = false;
  const onCallerAbort = () => controller.abort();
  if (callerSignal !== undefined) addAbortListener(callerSignal, onCallerAbort);
  if (callerSignal !== undefined && isSignalAborted(callerSignal)) controller.abort();

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeoutId);
      if (callerSignal !== undefined) removeAbortListener(callerSignal, onCallerAbort);
    },
  };
}

async function readResponse(
  request: PreparedRequest,
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  if (response.ok) {
    if (response.status === 204 || response.status === 205 || request.method === "HEAD") {
      return undefined;
    }
    if (request.returnText) {
      try {
        return await readSuccessfulResponseText(response, request.maxResponseBytes, signal);
      } catch (error) {
        if (error instanceof VeryfrontError) throw error;
        throw API_CLIENT_ERROR.create({
          detail: "Veryfront API response body could not be read",
          status: 502,
        });
      }
    }
    try {
      const text = await readSuccessfulResponseText(response, request.maxResponseBytes, signal);
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof VeryfrontError) throw error;
      throw API_CLIENT_ERROR.create({
        detail: "Veryfront API returned invalid JSON",
        status: 502,
      });
    }
  }

  const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
  await cancelResponseBody(response, signal);
  const logLevel = request.expected404 && response.status === 404
    ? "debug"
    : response.status >= 500
    ? "error"
    : "warn";
  veryfrontApiClientLog[logLevel]("Request failed", {
    operation: request.telemetry.operation,
    route: request.telemetry.route,
    status: response.status,
  });

  const requestError = API_CLIENT_ERROR.create({
    detail: `API request failed with status ${response.status}`,
    status: response.status,
    context: {
      details: {
        method: request.method,
        operation: request.telemetry.operation,
        route: request.telemetry.route,
        status: response.status,
      },
    },
  });
  if (retryAfterMs !== undefined) retryAfterByError.set(requestError, retryAfterMs);
  throw requestError;
}

function responseTooLargeError(): VeryfrontError {
  const error = API_CLIENT_ERROR.create({
    detail: "Veryfront API response exceeded the configured size limit",
    status: 502,
  });
  nonRetryableErrors.add(error);
  return error;
}

async function readSuccessfulResponseText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const contentLengthValue = response.headers.get("Content-Length");
  if (contentLengthValue !== null && /^\d+$/.test(contentLengthValue.trim())) {
    const contentLength = Number(contentLengthValue);
    if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
      await cancelResponseBody(response, signal);
      throw responseTooLargeError();
    }
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await raceWithAbort(reader.read(), signal);
      if (done) break;
      if (value.byteLength > maxBytes - totalBytes) {
        void reader.cancel().catch(() => undefined);
        throw responseTooLargeError();
      }
      totalBytes += value.byteLength;
      chunks.push(value);
    }
  } catch (error) {
    if (isSignalAborted(signal)) void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch (_) {
      // A runtime may retain a pending read briefly after cancellation. The
      // stream has already received cancel, so releasing here is best-effort.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function executeAttempt(
  request: PreparedRequest,
  attempt: number,
  signal: AbortSignal,
): Promise<unknown> {
  return await withSpan(
    SpanNames.HTTP_CLIENT_FETCH,
    async () => {
      const startTime = performance.now();
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer ${request.apiToken}`);
      if (!headers.has("Content-Type") && typeof request.body === "string") {
        headers.set("Content-Type", "application/json");
      }
      injectContext(headers);

      let response: Response;
      try {
        response = await raceWithAbort(
          fetch(request.url, {
            method: request.method,
            headers,
            body: request.body,
            signal,
          }),
          signal,
        );
      } catch (_) {
        throw API_CLIENT_ERROR.create({
          detail: "Veryfront API transport request failed",
          status: 503,
        });
      }
      const duration = performance.now() - startTime;
      recordApiRequest(response.status);
      apiLog.debug("Request completed", {
        operation: request.telemetry.operation,
        route: request.telemetry.route,
        status: response.status,
        durationMs: Math.round(duration),
      });
      return await readResponse(request, response, signal);
    },
    {
      "http.method": request.method,
      "http.route": request.telemetry.route,
      "api.operation": request.telemetry.operation,
      "http.retry_attempt": attempt,
    },
  );
}

function shouldRetry(request: PreparedRequest, error: Error, attempt: number): boolean {
  if (nonRetryableErrors.has(error)) return false;
  if (error instanceof VeryfrontError && !isRetryableStatus(error.status)) return false;
  return attempt < request.retryConfig.maxRetries && !request.oneShotBody && request.retryable;
}

function calculateRetryDelay(
  request: PreparedRequest,
  error: Error,
  attempt: number,
): { delay: number; source: "exponential" | "retry-after" } {
  const retryAfterMs = retryAfterByError.get(error);
  if (retryAfterMs !== undefined) {
    return { delay: retryAfterMs, source: "retry-after" };
  }
  const exponentialDelay = Math.min(
    request.retryConfig.initialDelay * 2 ** attempt,
    request.retryConfig.maxDelay,
  );
  const minimumDelay = Math.floor(exponentialDelay / 2);
  const jitteredDelay = minimumDelay +
    Math.floor(Math.random() * (exponentialDelay - minimumDelay + 1));
  return {
    delay: jitteredDelay,
    source: "exponential",
  };
}

function exhaustedRequestError(
  request: PreparedRequest,
  attemptsMade: number,
  lastError: Error | null,
  timedOut: boolean,
  totalTimedOut = false,
): VeryfrontError {
  const attemptLabel = attemptsMade === 1 ? "attempt" : "attempts";
  return API_CLIENT_ERROR.create({
    detail: totalTimedOut
      ? `API request exceeded its total timeout after ${attemptsMade} ${attemptLabel}`
      : timedOut
      ? `API request timed out after ${attemptsMade} ${attemptLabel}`
      : `API request failed after ${attemptsMade} ${attemptLabel}`,
    status: timedOut || totalTimedOut
      ? 504
      : lastError instanceof VeryfrontError
      ? lastError.status
      : undefined,
    context: {
      details: {
        attempts: attemptsMade,
        method: request.method,
        operation: request.telemetry.operation,
        route: request.telemetry.route,
      },
    },
  });
}

export async function requestWithRetry(
  url: string,
  apiToken: string,
  retryConfig: RetryConfig,
  options: RequestOptions = {},
): Promise<unknown> {
  const request = prepareRequest(url, apiToken, retryConfig, options);
  let lastError: Error | null = null;
  let attemptsMade = 0;
  let lastAttemptTimedOut = false;
  let totalTimedOut = false;
  const deadline = performance.now() + request.totalTimeoutMs;

  for (let attempt = 0; attempt <= request.retryConfig.maxRetries; attempt++) {
    if (request.callerSignal !== undefined && isSignalAborted(request.callerSignal)) {
      throw cancellationError();
    }
    const remainingBeforeAttempt = Math.ceil(deadline - performance.now());
    if (remainingBeforeAttempt <= 0) {
      totalTimedOut = true;
      break;
    }
    attemptsMade++;
    const attemptTimeoutMs = Math.min(request.timeoutMs, remainingBeforeAttempt);
    const attemptControl = createAttemptControl(attemptTimeoutMs, request.callerSignal);

    try {
      return await executeAttempt(request, attempt, attemptControl.signal);
    } catch (error) {
      const timedOut = attemptControl.didTimeout();
      if (
        request.callerSignal !== undefined && isSignalAborted(request.callerSignal) && !timedOut
      ) {
        throw cancellationError();
      }

      lastError = error instanceof Error ? error : new Error("Non-error request failure");
      lastAttemptTimedOut = timedOut;
      if (timedOut && attemptTimeoutMs < request.timeoutMs) totalTimedOut = true;
      if (timedOut) {
        veryfrontApiClientLog.warn("Request timed out", {
          operation: request.telemetry.operation,
          route: request.telemetry.route,
          timeoutMs: attemptTimeoutMs,
          attempt: attempt + 1,
        });
      }
      if (lastError instanceof VeryfrontError && !isRetryableStatus(lastError.status)) {
        throw lastError;
      }
      if (totalTimedOut) break;
      if (!shouldRetry(request, lastError, attempt)) break;

      const { delay, source } = calculateRetryDelay(request, lastError, attempt);
      const remainingBeforeRetry = Math.floor(deadline - performance.now());
      if (delay >= remainingBeforeRetry) {
        if (source === "retry-after" && lastError instanceof VeryfrontError) throw lastError;
        totalTimedOut = true;
        break;
      }

      recordApiRetry();
      veryfrontApiClientLog.warn("Request failed, retrying", {
        operation: request.telemetry.operation,
        route: request.telemetry.route,
        attempt: attempt + 1,
        maxRetries: request.retryConfig.maxRetries,
        delay,
        delaySource: source,
        status: lastError instanceof VeryfrontError ? lastError.status : undefined,
        timeout: timedOut,
      });

      attemptControl.cleanup();
      await waitForRetry(delay, request.callerSignal);
    } finally {
      attemptControl.cleanup();
    }
  }

  throw exhaustedRequestError(
    request,
    attemptsMade,
    lastError,
    lastAttemptTimedOut,
    totalTimedOut,
  );
}
