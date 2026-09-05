import { retryWithBackoff } from "#veryfront/errors/error-handlers.ts";
import { API_CLIENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { injectContext, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import {
  recordApiRequest,
  recordApiRetry,
} from "#veryfront/observability/simple-metrics/metrics-recorder.ts";
import {
  type BoundedRetryConfig,
  requireVeryfrontApiRetryConfig,
} from "#veryfront/utils/config-resource-limits.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { sanitizeUrlCredentials, sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
import { guardedOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import {
  JsonStringValueTooLargeError,
  maximumJsonStringDocumentBytes,
  readResponseJsonStringBytesWithinLimit,
  readResponseTextPrefix,
} from "#veryfront/utils/response-body.ts";
import {
  createVeryfrontApiRequestUrlResolver,
  type VeryfrontApiRequestUrlResolver,
} from "./veryfront-api-url.ts";

const log = serverLogger.component("veryfront-api-transport");
const apiClientLog = serverLogger.component("veryfront-api-client");
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_VERYFRONT_API_ERROR_BODY_BYTES = 8 * 1024;
export const DEFAULT_VERYFRONT_API_SUCCESS_BODY_BYTES = 64 * 1024 * 1024;
export const MAX_VERYFRONT_API_SUCCESS_BODY_BYTES = 128 * 1024 * 1024;
const NON_RETRYABLE_RESPONSE_PROTOCOL_ERRORS = new WeakSet<object>();
// Requests may originate after project modules have run in the host process.
// Keep credential-bearing header construction on intrinsics captured at module
// initialization so replacing `Headers` or its accessors cannot observe a
// host-private token.
const NativeHeaders = Headers;
const IntrinsicReflectApply = Reflect.apply;
const HeadersPrototypeHas = NativeHeaders.prototype.has;
const HeadersPrototypeSet = NativeHeaders.prototype.set;

function hasHeader(headers: Headers, name: string): boolean {
  return IntrinsicReflectApply(HeadersPrototypeHas, headers, [name]) as boolean;
}

function setHeader(headers: Headers, name: string, value: string): void {
  IntrinsicReflectApply(HeadersPrototypeSet, headers, [name, value]);
}

export type TransportRetryConfig = BoundedRetryConfig;

export interface TransportRequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  returnText?: boolean;
  /** Maximum decoded success-body bytes accepted before JSON/text parsing. */
  maxResponseBytes?: number;
  /** Stream one top-level JSON string without materializing the response envelope. */
  jsonStringFieldWithinLimit?: {
    fieldName: string;
    maximumBytes: number;
  };
  expected404?: boolean;
  timeoutMs?: number;
  /** Caller-owned cancellation signal, composed with the per-attempt timeout. */
  signal?: AbortSignal;
  /** Redirect policy for requests carrying platform credentials. Defaults to `"error"`. */
  redirect?: RequestRedirect;
  /** Allow bounded upstream error bodies in logs/error context. Defaults to true. */
  includeErrorBodyInDiagnostics?: boolean;
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
    signal?: AbortSignal,
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
  /** Optional host egress policy applied to every redirect hop. */
  outboundPolicy?: {
    authorizeUrl?: (url: URL) => void | Promise<void>;
  };
}

export interface VeryfrontApiTransport<T> {
  request(pathOrUrl: string, init?: TransportRequestInit): Promise<T>;
}

export function createVeryfrontApiTransport<T>(
  config: VeryfrontApiTransportConfig<T>,
): VeryfrontApiTransport<T> {
  const retry = requireVeryfrontApiRetryConfig(config.retry);
  return createValidatedVeryfrontApiTransport(
    config,
    retry,
    createVeryfrontApiRequestUrlResolver(config.baseUrl),
  );
}

function createValidatedVeryfrontApiTransport<T>(
  config: VeryfrontApiTransportConfig<T>,
  retry: TransportRetryConfig,
  resolveRequestUrl: VeryfrontApiRequestUrlResolver,
): VeryfrontApiTransport<T> {
  const {
    getToken,
    timeoutMs: cfgTimeout = DEFAULT_TIMEOUT_MS,
    defaultHeaders = {},
    afterFetch,
    wrapFetch,
  } = config;
  const defaultHeaderSnapshot = new NativeHeaders(defaultHeaders);
  const onRetry = config.onRetry;
  const { maxRetries, initialDelay, maxDelay } = retry;
  const onResponse = config.onResponse ??
    (defaultOnResponse as (r: Response, i: TransportRequestInit, u: string) => Promise<T>);
  const shouldRetry = config.shouldRetry ?? defaultShouldRetry;
  const wrapFinalError = config.wrapFinalError ??
    ((err: Error) =>
      API_CLIENT_ERROR.create({
        detail: `API request failed after ${maxRetries} retries: ${err.message}`,
        cause: err,
        context: { details: { originalError: err } },
      }));
  return {
    async request(
      pathOrUrl: string,
      init: TransportRequestInit = {},
    ): Promise<T> {
      // Snapshot every caller-owned option before credentials are read or I/O
      // begins. Retries and response parsing must not observe later mutation
      // of the request object, its headers, or its nested byte-limit options.
      const callerSignal = init.signal;
      callerSignal?.throwIfAborted();
      const maxResponseBytes = requireSuccessResponseByteLimit(init.maxResponseBytes);
      const jsonStringFieldWithinLimit = snapshotBoundedJsonFieldOptions(
        init.jsonStringFieldWithinLimit,
        maxResponseBytes,
      );
      const url = resolveRequestUrl(pathOrUrl);
      const method = init.method ?? "GET";
      const timeoutMs = init.timeoutMs ?? cfgTimeout;
      const requestHeaders = new NativeHeaders(init.headers);
      const body = init.body;
      const redirect = requireRedirectPolicy(init.redirect);
      const responseInit: TransportRequestInit = Object.freeze({
        method,
        headers: new NativeHeaders(requestHeaders),
        body,
        returnText: init.returnText === true,
        maxResponseBytes,
        jsonStringFieldWithinLimit,
        expected404: init.expected404 === true,
        timeoutMs,
        signal: callerSignal,
        redirect,
        includeErrorBodyInDiagnostics: init.includeErrorBodyInDiagnostics !== false,
      });
      // Capture the token once per request: retries of this request must not
      // pick up mid-flight token mutations (setRequestToken/clearRequestToken),
      // matching the pre-transport requestWithRetry semantics.
      const token = getToken();
      return await retryWithBackoff(
        async (signal, attempt) => {
          const doFetch = async (): Promise<T> => {
            const headers = new NativeHeaders(requestHeaders);
            for (const [k, v] of defaultHeaderSnapshot) {
              if (!hasHeader(headers, k)) setHeader(headers, k, v);
            }
            injectContext(headers);
            // Attach the credential last: tracing may use the public Headers
            // prototype, and a replaced method must never receive a container
            // that already holds the host-private token.
            setHeader(headers, "Authorization", `Bearer ${token}`);
            const start = performance.now();
            const requestInit: RequestInit = {
              method,
              headers,
              body,
              signal,
              redirect,
            };
            const res = config.outboundPolicy
              ? await guardedOutboundFetch(url, { ...requestInit, redirect: "error" }, {
                authorizeUrl: config.outboundPolicy.authorizeUrl,
              })
              : await fetch(url, requestInit);
            afterFetch?.(res.status, performance.now() - start);
            return await onResponse(res, responseInit, url, signal);
          };
          try {
            return await (wrapFetch ? wrapFetch(doFetch, url, method, attempt) : doFetch());
          } catch (error) {
            callerSignal?.throwIfAborted();
            throw error;
          }
        },
        {
          abortSignal: callerSignal,
          maxAttempts: maxRetries + 1,
          initialDelay,
          maxDelay,
          timeoutMs,
          shouldRetry(error, attempt) {
            return callerSignal?.aborted !== true && shouldRetry(error, attempt);
          },
          onRetry: onRetry
            ? ({ error, attempt, delay, isTimeout }) =>
              onRetry({ error, attempt, delay, isTimeout, url, timeoutMs })
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
            if (lastError.name === "AbortError") logTimeout(url, timeoutMs, lastAttempt);
            return wrapFinalError(lastError, lastAttempt);
          },
        },
      );
    },
  };
}

/** Canonical transport: span tracing, request metrics, API_CLIENT_ERROR mapping. */
export function createCanonicalVeryfrontApiTransport(
  baseUrl: string,
  getToken: () => string,
  retry: TransportRetryConfig,
  outboundPolicy?: VeryfrontApiTransportConfig<unknown>["outboundPolicy"],
): VeryfrontApiTransport<unknown> {
  const normalizedRetry = requireVeryfrontApiRetryConfig(retry);
  return createValidatedVeryfrontApiTransport(
    {
      baseUrl,
      getToken,
      retry: normalizedRetry,
      outboundPolicy,
      defaultHeaders: { "Content-Type": "application/json" },
      afterFetch(status) {
        recordApiRequest(status);
      },
      onRetry({ error, attempt, delay, isTimeout, url, timeoutMs }) {
        if (isTimeout) logTimeout(url, timeoutMs, attempt);
        recordApiRetry();
        apiClientLog.warn("Request failed, retrying...", {
          attempt: attempt + 1,
          maxRetries: normalizedRetry.maxRetries,
          delay,
          error: error.message,
          timeout: isTimeout,
        });
      },
      wrapFetch(fn, url, method, attempt) {
        const { pathname, host, protocol } = new URL(url);
        return withSpan(SpanNames.HTTP_CLIENT_FETCH, fn, {
          "http.method": method,
          "http.url": sanitizeUrlForSpan(url),
          "http.target": pathname,
          "http.host": host,
          "http.scheme": protocol.replace(":", ""),
          "http.retry_attempt": attempt,
        });
      },
    },
    normalizedRetry,
    createVeryfrontApiRequestUrlResolver(baseUrl),
  );
}

function logTimeout(url: string, timeoutMs: number, attempt: number): void {
  log.warn("Request timed out", {
    url: sanitizeUrlCredentials(url),
    timeoutMs,
    attempt: attempt + 1,
  });
}

async function defaultOnResponse(
  response: Response,
  init: TransportRequestInit,
  url: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!response.ok) {
    const { text, truncated } = await readResponseTextPrefix(
      response,
      MAX_VERYFRONT_API_ERROR_BODY_BYTES,
      signal,
    );
    const isExpected404 = init.expected404 === true && response.status === 404;
    const level = isExpected404 ? "debug" : response.status >= 500 ? "error" : "warn";
    const redactedUrl = sanitizeUrlCredentials(url);
    const includeErrorBody = init.includeErrorBodyInDiagnostics !== false;
    apiClientLog[level]("Request failed", {
      url: redactedUrl,
      status: response.status,
      statusText: response.statusText,
      responseText: includeErrorBody ? text.slice(0, 500) : undefined,
      responseTruncated: truncated,
    });
    const details: Record<string, unknown> = {
      url: redactedUrl,
      responseTruncated: truncated,
    };
    if (includeErrorBody) details.responseText = text;
    throw API_CLIENT_ERROR.create({
      detail: `API request failed: ${response.status} ${response.statusText}`,
      status: response.status,
      // Redacted so error telemetry cannot leak token query params.
      context: {
        details,
      },
    });
  }

  const maxResponseBytes = requireSuccessResponseByteLimit(init.maxResponseBytes);
  if (init.jsonStringFieldWithinLimit !== undefined) {
    try {
      // `maxResponseBytes` budgets only the bytes outside the selected string,
      // so the hard document ceiling has to reserve the worst-case escape
      // expansion of a value that is itself within its logical UTF-8 limit.
      const maximumDocumentBytes = maximumJsonStringDocumentBytes(
        init.jsonStringFieldWithinLimit.maximumBytes,
        maxResponseBytes,
      );
      return await readResponseJsonStringBytesWithinLimit(
        response,
        init.jsonStringFieldWithinLimit.fieldName,
        init.jsonStringFieldWithinLimit.maximumBytes,
        maximumDocumentBytes,
        signal,
        maxResponseBytes,
      );
    } catch (cause) {
      if (cause instanceof JsonStringValueTooLargeError) {
        const overflow = new RangeError(cause.message, { cause });
        NON_RETRYABLE_RESPONSE_PROTOCOL_ERRORS.add(overflow);
        throw overflow;
      }
      signal?.throwIfAborted();
      throw successfulResponseProtocolError(
        "Veryfront API returned invalid bounded JSON content",
        url,
        cause,
      );
    }
  }
  const text = await readSuccessfulResponseText(
    response,
    maxResponseBytes,
    url,
    signal,
  );
  if (init.returnText) return text;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw successfulResponseProtocolError(
      "Veryfront API successful response body is not valid JSON",
      url,
      cause,
    );
  }
}

function requireSuccessResponseByteLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_VERYFRONT_API_SUCCESS_BODY_BYTES;
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > MAX_VERYFRONT_API_SUCCESS_BODY_BYTES
  ) {
    throw new RangeError(
      `maxResponseBytes must be a positive safe integer no greater than ${MAX_VERYFRONT_API_SUCCESS_BODY_BYTES}`,
    );
  }
  return limit;
}

function requireRedirectPolicy(value: RequestRedirect | undefined): RequestRedirect {
  const redirect = value ?? "error";
  if (redirect !== "error" && redirect !== "follow" && redirect !== "manual") {
    throw new TypeError("redirect must be 'error', 'follow', or 'manual'");
  }
  return redirect;
}

/**
 * Validate bounded JSON-field options before a request performs any I/O, so a
 * malformed selector can never reach the network or be retried.
 */
function snapshotBoundedJsonFieldOptions(
  field: TransportRequestInit["jsonStringFieldWithinLimit"],
  maxResponseBytes: number,
): TransportRequestInit["jsonStringFieldWithinLimit"] {
  if (field === undefined) return undefined;
  if (typeof field !== "object" || field === null || Array.isArray(field)) {
    throw new TypeError("Veryfront API bounded JSON field options must be an object");
  }
  const { fieldName, maximumBytes } = field;
  if (typeof fieldName !== "string" || fieldName.length === 0) {
    throw new TypeError("Veryfront API bounded JSON field name must be a non-empty string");
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError(
      "Veryfront API bounded JSON field maximumBytes must be a non-negative safe integer",
    );
  }
  maximumJsonStringDocumentBytes(maximumBytes, maxResponseBytes);
  return Object.freeze({ fieldName, maximumBytes });
}

function successfulResponseProtocolError(
  detail: string,
  url: string,
  cause?: unknown,
): VeryfrontError {
  const error = API_CLIENT_ERROR.create({
    detail,
    status: 502,
    cause,
    context: { details: { url: sanitizeUrlCredentials(url) } },
  });
  NON_RETRYABLE_RESPONSE_PROTOCOL_ERRORS.add(error);
  return error;
}

function cancelResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): void {
  try {
    void reader.cancel(reason).catch(() => {});
  } catch {
    // Cancellation is best-effort; the body limit has already failed closed.
  }
}

async function readResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return await reader.read();
  signal.throwIfAborted();

  return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();

    reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

async function readSuccessfulResponseText(
  response: Response,
  maxResponseBytes: number,
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  const rawContentLength = response.headers.get("content-length");
  if (rawContentLength !== null) {
    if (!/^\d+$/.test(rawContentLength)) {
      cancelResponseReaderIfPresent(response, "invalid content-length");
      throw successfulResponseProtocolError(
        "Veryfront API returned an invalid successful response Content-Length",
        url,
      );
    }
    const contentLength = Number(rawContentLength);
    if (!Number.isSafeInteger(contentLength)) {
      cancelResponseReaderIfPresent(response, "invalid content-length");
      throw successfulResponseProtocolError(
        "Veryfront API returned an invalid successful response Content-Length",
        url,
      );
    }
    if (contentLength > maxResponseBytes) {
      cancelResponseReaderIfPresent(response, "response body exceeds limit");
      throw successfulResponseProtocolError(
        `Veryfront API successful response exceeded ${maxResponseBytes} bytes`,
        url,
      );
    }
  }

  signal?.throwIfAborted();
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  let bytes = new Uint8Array(Math.min(8 * 1024, maxResponseBytes));
  let byteLength = 0;
  let completed = false;
  let failure: unknown;

  try {
    while (true) {
      const { done, value } = await readResponseChunk(reader, signal);
      if (done) {
        completed = true;
        break;
      }

      if (value.byteLength > maxResponseBytes - byteLength) {
        throw successfulResponseProtocolError(
          `Veryfront API successful response exceeded ${maxResponseBytes} bytes`,
          url,
        );
      }

      const requiredLength = byteLength + value.byteLength;
      if (requiredLength > bytes.byteLength) {
        let capacity = bytes.byteLength;
        while (capacity < requiredLength) {
          capacity = Math.min(maxResponseBytes, Math.max(requiredLength, capacity * 2));
        }
        const grown = new Uint8Array(capacity);
        grown.set(bytes.subarray(0, byteLength));
        bytes = grown;
      }
      bytes.set(value, byteLength);
      byteLength = requiredLength;
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (!completed) cancelResponseReader(reader, failure);
    reader.releaseLock();
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, byteLength));
  } catch (cause) {
    throw successfulResponseProtocolError(
      "Veryfront API successful response body is not valid UTF-8",
      url,
      cause,
    );
  }
}

function cancelResponseReaderIfPresent(response: Response, reason: unknown): void {
  const body = response.body;
  if (!body) return;
  try {
    const reader = body.getReader();
    cancelResponseReader(reader, reason);
    reader.releaseLock();
  } catch {
    // Cancellation is best-effort; the Content-Length limit has already failed closed.
  }
}

function defaultShouldRetry(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    NON_RETRYABLE_RESPONSE_PROTOCOL_ERRORS.has(error)
  ) {
    return false;
  }
  if (!(error instanceof VeryfrontError) || error.slug !== "api-client-error") return true;
  const { status } = error as VeryfrontError;
  return !status || status < 400 || status >= 500 || status === 429;
}
