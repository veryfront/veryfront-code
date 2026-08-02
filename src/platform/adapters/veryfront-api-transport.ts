import { retryWithBackoff } from "#veryfront/errors/error-handlers.ts";
import { API_CLIENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import {
  recordApiRequest,
  recordApiRetry,
} from "#veryfront/observability/simple-metrics/metrics-recorder.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import {
  InvalidResponseBodyError,
  InvalidResponseBodyJsonError,
  InvalidResponseBodyJsonNestingError,
  JsonNonValueBytesTooLargeError,
  JsonStringValueTooLargeError,
  maximumJsonStringDocumentBytes,
  readResponseJsonStringBytesWithinLimit,
  readResponseTextPrefix,
  ResponseBodyTooLargeError,
} from "#veryfront/utils/response-body.ts";

const log = serverLogger.component("veryfront-api-transport");
const apiClientLog = serverLogger.component("veryfront-api-client");
const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_VERYFRONT_API_SUCCESS_BODY_BYTES = 64 * 1024 * 1024;
export const MAX_VERYFRONT_API_SUCCESS_BODY_BYTES = 128 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 8 * 1024;

export interface TransportRetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
}

export interface TransportRequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  returnText?: boolean;
  /**
   * Maximum encoded bytes for an ordinary response. For a bounded JSON-string
   * read, this is the independent policy budget for the rest of the document;
   * the transport derives a larger hard ceiling for worst-case string escapes.
   */
  maxResponseBytes?: number;
  /** Decode one top-level JSON string directly from the bounded response stream. */
  jsonStringFieldWithinLimit?: {
    fieldName: string;
    maximumBytes: number;
  };
  expected404?: boolean;
  timeoutMs?: number;
  /** Caller-owned cancellation propagated to the underlying fetch. */
  signal?: AbortSignal;
}

export interface VeryfrontApiTransportConfig<T> {
  baseUrl: string;
  getToken: () => string;
  retry: TransportRetryConfig;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
  onResponse?: (
    response: Response,
    init: TransportRequestInit,
    url: string,
    abortSignal?: AbortSignal,
  ) => Promise<T>;
  afterFetch?: (status: number, durationMs: number) => void;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (info: {
    error: Error;
    attempt: number;
    delay: number;
    isTimeout: boolean;
    url: string;
    timeoutMs: number;
  }) => void;
  wrapFinalError?: (lastError: Error, lastAttempt: number) => Error;
  wrapFetch?: (fn: () => Promise<T>, url: string, method: string, attempt: number) => Promise<T>;
}

export interface VeryfrontApiTransport<T> {
  request(pathOrUrl: string, init?: TransportRequestInit): Promise<T>;
}

function validateMaximumResponseBytes(value: unknown): number {
  if (
    !Number.isSafeInteger(value) || (value as number) <= 0 ||
    (value as number) > MAX_VERYFRONT_API_SUCCESS_BODY_BYTES
  ) {
    throw new RangeError(
      `Veryfront API maxResponseBytes must be a positive integer at most ${MAX_VERYFRONT_API_SUCCESS_BODY_BYTES}`,
    );
  }
  return value as number;
}

function snapshotRequestInit(init: TransportRequestInit): TransportRequestInit {
  const maxResponseBytes = validateMaximumResponseBytes(
    init.maxResponseBytes ?? DEFAULT_VERYFRONT_API_SUCCESS_BODY_BYTES,
  );
  const boundedField = init.jsonStringFieldWithinLimit;
  let jsonStringFieldWithinLimit: TransportRequestInit["jsonStringFieldWithinLimit"];
  if (boundedField !== undefined) {
    if (typeof boundedField !== "object" || boundedField === null || Array.isArray(boundedField)) {
      throw new TypeError("Veryfront API bounded JSON field options must be an object");
    }
    const { fieldName, maximumBytes } = boundedField;
    if (typeof fieldName !== "string" || fieldName.length === 0) {
      throw new TypeError("Veryfront API bounded JSON field name must be a non-empty string");
    }
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
      throw new RangeError(
        "Veryfront API bounded JSON field maximumBytes must be a non-negative safe integer",
      );
    }
    // Validate the combined ceiling before a request can perform I/O.
    maximumJsonStringDocumentBytes(maximumBytes, maxResponseBytes);
    jsonStringFieldWithinLimit = { fieldName, maximumBytes };
  }

  return {
    method: init.method,
    headers: init.headers,
    body: init.body,
    returnText: init.returnText,
    maxResponseBytes,
    jsonStringFieldWithinLimit,
    expected404: init.expected404,
    timeoutMs: init.timeoutMs,
    signal: init.signal,
  };
}

export function createVeryfrontApiTransport<T>(
  config: VeryfrontApiTransportConfig<T>,
): VeryfrontApiTransport<T> {
  const {
    baseUrl,
    getToken,
    retry: { maxRetries, initialDelay, maxDelay },
    timeoutMs: cfgTimeout = DEFAULT_TIMEOUT_MS,
    defaultHeaders = {},
    afterFetch,
    wrapFetch,
  } = config;
  const onResponse = config.onResponse ??
    (defaultOnResponse as (
      r: Response,
      i: TransportRequestInit,
      u: string,
      signal?: AbortSignal,
    ) => Promise<T>);
  const shouldRetry = config.shouldRetry ?? defaultShouldRetry;
  const wrapFinalError = config.wrapFinalError ??
    ((err: Error) =>
      API_CLIENT_ERROR.create({
        detail: `API request failed after ${maxRetries} retries: ${err.message}`,
        cause: err,
        context: { details: { originalError: err } },
      }));
  return {
    async request(pathOrUrl: string, init: TransportRequestInit = {}): Promise<T> {
      const requestInit = snapshotRequestInit(init);
      const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
      const method = requestInit.method ?? "GET";
      const timeoutMs = requestInit.timeoutMs ?? cfgTimeout;
      // Capture the token once per request: retries of this request must not
      // pick up mid-flight token mutations (setRequestToken/clearRequestToken),
      // matching the pre-transport requestWithRetry semantics.
      const token = getToken();
      return await retryWithBackoff(
        (attemptSignal, attempt) => {
          const doFetch = async (): Promise<T> => {
            const headers = new Headers(requestInit.headers);
            for (const [k, v] of Object.entries(defaultHeaders)) {
              if (!headers.has(k)) headers.set(k, v);
            }
            headers.set("Authorization", `Bearer ${token}`);
            injectContext(headers);
            const start = performance.now();
            const signal = combineRequestSignals(attemptSignal, requestInit.signal);
            const res = await fetch(url, { method, headers, body: requestInit.body, signal });
            afterFetch?.(res.status, performance.now() - start);
            return onResponse(res, requestInit, url, signal);
          };
          return wrapFetch ? wrapFetch(doFetch, url, method, attempt) : doFetch();
        },
        {
          maxAttempts: maxRetries + 1,
          initialDelay,
          maxDelay,
          timeoutMs,
          shouldRetry: (error, attempt) =>
            requestInit.signal?.aborted !== true && shouldRetry(error, attempt),
          onRetry: config.onRetry
            ? ({ error, attempt, delay, isTimeout }) =>
              config.onRetry!({ error, attempt, delay, isTimeout, url, timeoutMs })
            : ({ error, attempt, delay, isTimeout }) => {
              if (isTimeout) logTimeout(url, timeoutMs, attempt);
              log.warn("Request failed, retrying...", {
                attempt: attempt + 1,
                maxRetries,
                delay,
                error: error.message,
                timeout: isTimeout,
              });
            },
          wrapFinalError(lastError, lastAttempt) {
            if (requestInit.signal?.aborted) {
              const reason = requestInit.signal.reason;
              return reason instanceof Error ? reason : new Error("API request aborted");
            }
            if (lastError.name === "AbortError") logTimeout(url, timeoutMs, lastAttempt);
            return wrapFinalError(lastError, lastAttempt);
          },
        },
      );
    },
  };
}

function combineRequestSignals(
  attemptSignal: AbortSignal | undefined,
  callerSignal: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!attemptSignal) return callerSignal;
  if (!callerSignal) return attemptSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([attemptSignal, callerSignal]);
  }

  const controller = new AbortController();
  const abortFromAttempt = () => {
    detach();
    controller.abort(attemptSignal.reason);
  };
  const abortFromCaller = () => {
    detach();
    controller.abort(callerSignal.reason);
  };
  const detach = () => {
    attemptSignal.removeEventListener("abort", abortFromAttempt);
    callerSignal.removeEventListener("abort", abortFromCaller);
  };

  if (attemptSignal.aborted) {
    abortFromAttempt();
  } else if (callerSignal.aborted) {
    abortFromCaller();
  } else {
    attemptSignal.addEventListener("abort", abortFromAttempt, { once: true });
    callerSignal.addEventListener("abort", abortFromCaller, { once: true });
  }
  return controller.signal;
}

/** Canonical transport: span tracing, request metrics, API_CLIENT_ERROR mapping. */
export function createCanonicalVeryfrontApiTransport(
  baseUrl: string,
  getToken: () => string,
  retry: TransportRetryConfig,
): VeryfrontApiTransport<unknown> {
  return createVeryfrontApiTransport<unknown>({
    baseUrl,
    getToken,
    retry,
    defaultHeaders: { "Content-Type": "application/json" },
    afterFetch(status) {
      recordApiRequest(status);
    },
    onRetry({ error, attempt, delay, isTimeout, url, timeoutMs }) {
      if (isTimeout) logTimeout(url, timeoutMs, attempt);
      recordApiRetry();
      apiClientLog.warn("Request failed, retrying...", {
        attempt: attempt + 1,
        maxRetries: retry.maxRetries,
        delay,
        error: error.message,
        timeout: isTimeout,
      });
    },
    wrapFetch(fn, url, method, attempt) {
      const { pathname, host, protocol } = new URL(url);
      return withSpan(SpanNames.HTTP_CLIENT_FETCH, fn, {
        "http.method": method,
        "http.url": url,
        "http.target": pathname,
        "http.host": host,
        "http.scheme": protocol.replace(":", ""),
        "http.retry_attempt": attempt,
      });
    },
  });
}

function logTimeout(url: string, timeoutMs: number, attempt: number): void {
  log.warn("Request timed out", {
    url: url.replace(/token=[^&]+/, "token=***"),
    timeoutMs,
    attempt: attempt + 1,
  });
}

async function defaultOnResponse(
  response: Response,
  init: TransportRequestInit,
  url: string,
  abortSignal?: AbortSignal,
): Promise<unknown> {
  if (!response.ok) {
    let text = "";
    let truncated = false;
    let diagnosticFailure: unknown;
    try {
      const diagnostic = await readResponseTextPrefix(
        response,
        MAX_ERROR_BODY_BYTES + 1,
        abortSignal,
        { fatalUtf8: true },
      );
      text = diagnostic.text;
      truncated = diagnostic.truncated;
    } catch (cause) {
      diagnosticFailure = cause;
    }
    const isExpected404 = init.expected404 === true && response.status === 404;
    const level = isExpected404 ? "debug" : response.status >= 500 ? "error" : "warn";
    const redactedUrl = url.replace(/token=[^&]+/g, "token=***");
    apiClientLog[level]("Request failed", {
      url: redactedUrl,
      status: response.status,
      statusText: response.statusText,
      responseText: text.slice(0, MAX_ERROR_BODY_BYTES),
      responseTruncated: truncated,
      responseBodyReadFailed: diagnosticFailure !== undefined,
    });
    throw API_CLIENT_ERROR.create({
      detail: `API request failed: ${response.status} ${response.statusText}`,
      status: response.status,
      // Redacted so error telemetry cannot leak token query params.
      context: {
        details: {
          url: redactedUrl,
          responseText: text.slice(0, MAX_ERROR_BODY_BYTES),
          responseTruncated: truncated,
          responseBodyReadFailed: diagnosticFailure !== undefined,
        },
      },
    });
  }

  let maxResponseBytes: number;
  try {
    maxResponseBytes = validateMaximumResponseBytes(init.maxResponseBytes);
  } catch (error) {
    try {
      void response.body?.cancel(error).catch(() => {});
    } catch {
      // Best-effort cleanup for a violated internal request snapshot invariant.
    }
    throw error;
  }

  if (init.jsonStringFieldWithinLimit !== undefined) {
    try {
      const maximumDocumentBytes = maximumJsonStringDocumentBytes(
        init.jsonStringFieldWithinLimit.maximumBytes,
        maxResponseBytes,
      );
      return await readResponseJsonStringBytesWithinLimit(
        response,
        init.jsonStringFieldWithinLimit.fieldName,
        init.jsonStringFieldWithinLimit.maximumBytes,
        maximumDocumentBytes,
        abortSignal,
        maxResponseBytes,
      );
    } catch (cause) {
      if (cause instanceof JsonStringValueTooLargeError) {
        throw cause;
      }
      if (!isDeterministicResponseProtocolError(cause)) throw cause;
      const error = API_CLIENT_ERROR.create({
        detail: "Veryfront API returned invalid bounded JSON content",
        cause,
        context: { details: { url: url.replace(/token=[^&]+/g, "token=***") } },
      });
      throw error;
    }
  }

  let text: string;
  let truncated: boolean;
  try {
    const result = await readResponseTextPrefix(
      response,
      maxResponseBytes + 1,
      abortSignal,
      { fatalUtf8: true },
    );
    text = result.text;
    truncated = result.truncated;
  } catch (cause) {
    if (!isDeterministicResponseProtocolError(cause)) throw cause;
    throw API_CLIENT_ERROR.create({
      detail: "Veryfront API returned invalid response content",
      cause,
      context: { details: { url: url.replace(/token=[^&]+/g, "token=***") } },
    });
  }
  if (truncated) {
    throw new ResponseBodyTooLargeError(maxResponseBytes);
  }
  if (init.returnText) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    const protocolCause = new InvalidResponseBodyJsonError(
      "Response body is not valid JSON",
      { cause },
    );
    const error = API_CLIENT_ERROR.create({
      detail: "Veryfront API returned invalid JSON",
      cause: protocolCause,
      context: { details: { url: url.replace(/token=[^&]+/g, "token=***") } },
    });
    throw error;
  }
}

function isDeterministicResponseProtocolError(error: unknown): boolean {
  return error instanceof InvalidResponseBodyError ||
    error instanceof InvalidResponseBodyJsonNestingError ||
    error instanceof JsonNonValueBytesTooLargeError ||
    error instanceof JsonStringValueTooLargeError ||
    error instanceof ResponseBodyTooLargeError;
}

function defaultShouldRetry(error: unknown): boolean {
  if (isDeterministicResponseProtocolError(error)) {
    return false;
  }
  if (error instanceof VeryfrontError && isDeterministicResponseProtocolError(error.cause)) {
    return false;
  }
  if (!(error instanceof VeryfrontError) || error.slug !== "api-client-error") return true;
  const { status } = error as VeryfrontError;
  return !status || status < 400 || status >= 500 || status === 429;
}
