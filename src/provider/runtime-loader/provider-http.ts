import { readRecord } from "./provider-records.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { MAX_TIMER_DELAY_MS, normalizeTimerDurationMs } from "#veryfront/utils/timer.ts";

/**
 * Which provider runtime a request is being sent to.
 * `mistral` and `moonshotai` use the OpenAI-compatible wire format and are
 * therefore treated as "openai" for error classification purposes; they are
 * listed here so call sites can pass accurate labels without a cast.
 */
export type ProviderKind = "anthropic" | "openai" | "google" | "mistral" | "moonshotai";

/** Bytes inspected for structured provider error classification. */
const MAX_ERROR_BODY_BYTES = 8_000;
const DEFAULT_PROVIDER_JSON_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_PROVIDER_STREAM_HEADERS_TIMEOUT_MS = 30_000;
const MAX_PROVIDER_STREAM_RATE_LIMIT_RETRIES = 2;
const DEFAULT_PROVIDER_STREAM_RATE_LIMIT_RETRY_DELAY_MS = 1_000;
const DEFAULT_PROVIDER_JSON_MAX_BYTES = 32 * 1024 * 1024;
const MAX_PROVIDER_JSON_MAX_BYTES = 256 * 1024 * 1024;
const MAX_PROVIDER_JSON_BODY_READS = 65_536;
const TRANSIENT_PROVIDER_STATUSES = new Set([
  500,
  502,
  503,
  504,
  520,
  521,
  522,
  523,
  524,
  // 525-527 and 530 are Cloudflare origin/TLS failures — transient from the
  // caller's perspective, like the rest of the 52x family.
  525,
  526,
  527,
  529,
  530,
  598,
  599,
]);

/**
 * Base class for typed provider errors. The `retryable` flag is the
 * primary signal for callers (or a retry wrapper) to decide whether to
 * re-issue the request. `retryAfterMs` is set when the provider gave an
 * explicit delay hint (Retry-After header, Retry-Info trailer).
 */
export class ProviderError extends Error {
  readonly provider: ProviderKind;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  /**
   * Bounded structured provider response used by the internal error classifier.
   * Kept non-enumerable so logs and JSON serialization retain the generic error.
   */
  declare readonly responseBody?: string;

  constructor(options: {
    provider: ProviderKind;
    status: number;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
  }) {
    super(options.message);
    // `this.constructor`, not `new.target`: DNT rewrites every meta-property
    // into its `import.meta` ponyfill when it emits the npm package, which
    // turned this line into `ponyfill(import.meta).name` — always `undefined`.
    // See scripts/build/dnt-meta-property-safety.ts.
    this.name = this.constructor.name;
    this.provider = options.provider;
    this.status = options.status;
    this.retryable = options.retryable;
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
  }
}

/** Provider reports it is overloaded (Anthropic 529, OpenAI/Google 503). */
export class ProviderOverloadedError extends ProviderError {}

/** Provider is rate limiting this API key (OpenAI/Google 429 with Retry-After). */
export class ProviderRateLimitError extends ProviderError {}

/** Provider account quota is exhausted — non-retryable. */
export class ProviderQuotaError extends ProviderError {}

/** Non-retryable 4xx/5xx that doesn't fit another bucket. */
export class ProviderRequestError extends ProviderError {}

function preserveStructuredResponseBody<T extends ProviderError>(
  error: T,
  responseBody: string,
): T {
  Object.defineProperty(error, "responseBody", {
    value: responseBody,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return error;
}

/**
 * Google's canonical `google.rpc.Code` for a request the API rejected as
 * malformed. It arrives in `error.status`, where Anthropic and the
 * OpenAI-compatible providers put `invalid_request_error` in `error.type` --
 * the same meaning under a different key, and the reason a Google 400 used to
 * reach classification carrying neither its body nor its own wording.
 *
 * The classifier in `src/chat/provider-errors.ts` has to recognise the same
 * envelope for a preserved body to be worth anything. Preserving without
 * classifying, or classifying without preserving, leaves the provider exactly
 * as opaque as before, so the end-to-end tests in
 * `src/chat/provider-errors.test.ts` drive both halves through the real
 * `buildProviderError` and fail if they drift apart.
 */
const GOOGLE_INVALID_ARGUMENT_STATUS = "INVALID_ARGUMENT";

/**
 * Whether a 400 envelope identifies itself as a rejected *request* -- the
 * class whose body names a reason the caller can act on (a schema that must be
 * closed, a prompt that is too long, an account that cannot be charged).
 *
 * Keyed on a recognised marker rather than the status alone: a 400 whose
 * envelope we do not recognise is still dropped, so widening this stays a
 * deliberate act per envelope shape rather than a blanket retention of every
 * 400 body.
 */
function isInvalidRequestEnvelope(
  errorType: string | undefined,
  errorRecord: Record<string, unknown> | undefined,
): boolean {
  return errorType === "invalid_request_error" ||
    errorRecord?.status === GOOGLE_INVALID_ARGUMENT_STATUS;
}

/** Parses retry after ms. */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const normalized = header.trim();
  if (!normalized) return undefined;

  if (/^\d+$/.test(normalized)) {
    const milliseconds = Number(normalized) * 1000;
    return Number.isSafeInteger(milliseconds) && milliseconds <= MAX_TIMER_DELAY_MS
      ? milliseconds
      : undefined;
  }
  // Retry-After dates always begin with a weekday. Do not let Date.parse()
  // reinterpret malformed numeric delay forms such as "-1", "1e3", or "0x10".
  if (/^[+-]?\d/.test(normalized)) {
    return undefined;
  }
  // HTTP-date form (rare in practice for LLM providers).
  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    const delay = Math.max(0, parsed - Date.now());
    return Number.isSafeInteger(delay) && delay <= MAX_TIMER_DELAY_MS ? delay : undefined;
  }
  return undefined;
}

const GOOGLE_RETRY_INFO_TYPE = "type.googleapis.com/google.rpc.RetryInfo";
const PROTOBUF_SECONDS_DURATION = /^(\d+(?:\.\d+)?)s$/;

/**
 * Read the retry delay Google attaches to an error body as a
 * `google.rpc.RetryInfo` detail. Durations arrive in protobuf JSON form
 * ("23s", "1.5s"); anything else is ignored so a malformed body cannot make a
 * hard quota failure look retryable.
 */
function parseGoogleRetryInfoMs(
  errorRecord: Record<string, unknown> | undefined,
): number | undefined {
  const details = errorRecord?.details;
  if (!Array.isArray(details)) return undefined;

  for (const detail of details) {
    const record = readRecord(detail);
    if (record?.["@type"] !== GOOGLE_RETRY_INFO_TYPE) continue;
    if (typeof record.retryDelay !== "string") continue;
    const seconds = PROTOBUF_SECONDS_DURATION.exec(record.retryDelay);
    if (!seconds) continue;
    const milliseconds = Math.round(Number(seconds[1]) * 1000);
    if (Number.isSafeInteger(milliseconds) && milliseconds <= MAX_TIMER_DELAY_MS) {
      return milliseconds;
    }
  }
  return undefined;
}

/**
 * Inspect a non-2xx response and build the most specific ProviderError
 * subclass we can. Reads the response body as text (it's already dead
 * on the wire by this point). Body classification handles the cases
 * where HTTP status alone is ambiguous — notably OpenAI
 * `insufficient_quota` vs `rate_limit_exceeded` both arriving as 429.
 */
export async function buildProviderError(
  provider: ProviderKind,
  response: Response,
  abortSignal?: AbortSignal,
): Promise<ProviderError> {
  const status = response.status;
  const { text: rawBody, truncated } = await readResponseTextPrefix(
    response,
    MAX_ERROR_BODY_BYTES,
    abortSignal,
  );
  const message = `Provider request failed with status ${status}`;
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));

  const parsedBody = (() => {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  })();
  const errorRecord = readRecord(parsedBody?.error);
  const errorType = typeof errorRecord?.type === "string" ? errorRecord.type : undefined;
  const errorCode = typeof errorRecord?.code === "string"
    ? errorRecord.code
    : errorType !== undefined
    ? errorType
    : typeof errorRecord?.status === "string"
    ? errorRecord.status
    : undefined;

  // Anthropic 529 = overloaded. Anthropic surfaces this with
  // { error: { type: "overloaded_error" } } in the body.
  if (provider === "anthropic" && status === 529) {
    return new ProviderOverloadedError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  // Anthropic 429 = rate limiting. Retryable; honor Retry-After if present.
  if (provider === "anthropic" && status === 429) {
    return new ProviderRateLimitError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  // OpenAI / Mistral / Moonshotai / Google 503 = overloaded.
  // Mistral and Moonshotai use the OpenAI-compatible wire format so their
  // error shapes are structurally identical to OpenAI's.
  if (
    (provider === "openai" || provider === "mistral" || provider === "moonshotai" ||
      provider === "google") &&
    status === 503
  ) {
    return new ProviderOverloadedError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  // OpenAI / Mistral / Moonshotai 429 splits based on the error code in the body:
  //  - insufficient_quota → hard quota, non-retryable
  //  - rate_limit_exceeded / tokens_per_min_exceeded → retry with Retry-After
  // Mistral and Moonshotai use the same OpenAI-compatible error envelope.
  if (
    (provider === "openai" || provider === "mistral" || provider === "moonshotai") && status === 429
  ) {
    if (errorCode === "insufficient_quota") {
      return new ProviderQuotaError({
        provider,
        status,
        message,
        retryable: false,
      });
    }
    if (truncated || parsedBody === undefined) {
      return new ProviderRequestError({ provider, status, message, retryable: false });
    }
    return new ProviderRateLimitError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  // Google returns RESOURCE_EXHAUSTED for both the daily free-tier quota and
  // short-window per-minute/per-token limits, so the status alone cannot
  // separate them. A retry delay can: Google attaches Retry-After or a
  // `google.rpc.RetryInfo` detail to the limits that clear on their own and
  // returns neither for a quota that cannot succeed again until the daily
  // window resets. The QuotaFailure detail names the violated metric but its
  // wording is not a stable contract, so the delay is the signal we key on.
  // Without one the error stays a hard quota error and callers don't hot-loop
  // on retries that can't possibly succeed until midnight UTC.
  if (provider === "google" && status === 429) {
    if (truncated || parsedBody === undefined) {
      return new ProviderRequestError({ provider, status, message, retryable: false });
    }
    const retryDelayMs = retryAfterMs ?? parseGoogleRetryInfoMs(errorRecord);
    if (errorCode === "RESOURCE_EXHAUSTED" && retryDelayMs === undefined) {
      return new ProviderQuotaError({
        provider,
        status,
        message,
        retryable: false,
      });
    }
    return new ProviderRateLimitError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryDelayMs !== undefined ? { retryAfterMs: retryDelayMs } : {}),
    });
  }

  // Retry only statuses that conventionally represent transient upstream
  // failures. Other 5xx responses can describe permanent protocol or
  // configuration errors that an unchanged retry cannot fix.
  if (TRANSIENT_PROVIDER_STATUSES.has(status)) {
    return new ProviderOverloadedError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  const requestError = new ProviderRequestError({
    provider,
    status,
    message,
    retryable: false,
  });

  const isStructuredInvalidRequest = status === 400 &&
    isInvalidRequestEnvelope(errorType, errorRecord) &&
    parsedBody !== undefined &&
    !truncated;
  const problemSlug = typeof parsedBody?.slug === "string" ? parsedBody.slug : undefined;
  const isStructuredVeryfrontCreditProblem = status === 402 &&
    (problemSlug === "insufficient-credits" || problemSlug === "resource-limit-exceeded") &&
    !truncated;

  return isStructuredInvalidRequest || isStructuredVeryfrontCreditProblem
    ? preserveStructuredResponseBody(requestError, rawBody)
    : requestError;
}

interface RequestDeadline {
  readonly deadlineSignal: AbortSignal;
  readonly init: RequestInit;
  readonly timedOut: boolean;
  abort(reason?: unknown): void;
  cancelTimeout(): void;
  dispose(): void;
}

function createRequestDeadline(
  init: RequestInit,
  timeoutMs: number,
  optionName: string,
): RequestDeadline {
  const normalizedTimeout = normalizeTimerDurationMs(timeoutMs, optionName);
  if (normalizedTimeout === 0) {
    throw new RangeError(`${optionName} must be greater than zero`);
  }

  const deadlineController = new AbortController();
  const callerSignal = init.signal ?? undefined;
  let abortOrigin: "caller" | "timeout" | "consumer" | undefined;
  let disposed = false;

  const abortFromCaller = () => {
    if (deadlineController.signal.aborted) return;
    abortOrigin = "caller";
    deadlineController.abort(callerSignal?.reason);
  };
  if (callerSignal) {
    callerSignal.addEventListener("abort", abortFromCaller, { once: true });
    if (callerSignal.aborted) abortFromCaller();
  }

  const timeoutId = deadlineController.signal.aborted ? undefined : setTimeout(() => {
    if (deadlineController.signal.aborted) return;
    abortOrigin = "timeout";
    deadlineController.abort(
      new DOMException(`Provider request timed out after ${normalizedTimeout}ms`, "TimeoutError"),
    );
  }, normalizedTimeout);

  const cancelTimeout = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  };

  return {
    deadlineSignal: deadlineController.signal,
    init: { ...init, signal: deadlineController.signal },
    get timedOut() {
      return abortOrigin === "timeout";
    },
    abort(reason?: unknown) {
      if (deadlineController.signal.aborted) return;
      abortOrigin = "consumer";
      deadlineController.abort(reason);
    },
    cancelTimeout,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelTimeout();
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

async function waitForAbortable<T>(
  operation: () => Promise<T>,
  abortSignal: AbortSignal,
  onLateValue?: (value: T) => void,
): Promise<T> {
  abortSignal.throwIfAborted();
  const operationPromise = operation();

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const removeAbortListener = () => abortSignal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      reject(abortSignal.reason);
    };

    abortSignal.addEventListener("abort", onAbort, { once: true });
    if (abortSignal.aborted) onAbort();

    operationPromise.then(
      (value) => {
        if (settled) {
          try {
            onLateValue?.(value);
          } catch {
            // Best-effort cleanup must not create an unhandled rejection.
          }
          return;
        }
        settled = true;
        removeAbortListener();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        removeAbortListener();
        reject(error);
      },
    );
  });
}

async function waitForProviderRateLimitRetry(
  delayMs: number,
  abortSignal: AbortSignal,
): Promise<void> {
  abortSignal.throwIfAborted();
  if (delayMs === 0) return;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeoutId);
      abortSignal.removeEventListener("abort", onAbort);
      reject(abortSignal.reason);
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
    if (abortSignal.aborted) onAbort();
  });
}

function cancelLateResponse(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    void cancellation?.catch(() => {});
  } catch {
    // A custom fetch implementation controls the response body. Cancellation
    // is best-effort after it ignored the request's abort signal.
  }
}

function createReaderReleaser(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): () => void {
  let released = false;
  return () => {
    if (released) return;
    try {
      reader.releaseLock();
      released = true;
    } catch {
      // A detached cancellation continuation can retry after pending reads
      // settle for a non-standard stream implementation.
    }
  };
}

function cancelReaderWithoutWaiting(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
  releaseReader: () => void,
): void {
  let cancellation: Promise<void>;
  try {
    cancellation = reader.cancel(reason);
  } catch {
    releaseReader();
    return;
  }

  // ReadableStream cancellation closes the stream and settles pending reads
  // before the underlying source's cleanup promise resolves. Release the lock
  // immediately, then retry after settlement for non-standard readers that
  // retain a pending read a little longer. Never let provider-controlled
  // cleanup hold caller cancellation or error delivery open.
  releaseReader();
  void cancellation.then(releaseReader, releaseReader);
}

function streamWithCleanup(
  stream: ReadableStream<Uint8Array>,
  abortSignal: AbortSignal,
  abortRequest: (reason?: unknown) => void,
  cleanup: () => void,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let finished = false;
  let cancellationStarted = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const releaseReader = createReaderReleaser(reader);
  const cancelReader = (reason: unknown): void => {
    if (cancellationStarted) return;
    cancellationStarted = true;
    cancelReaderWithoutWaiting(reader, reason, releaseReader);
  };
  const finish = (): boolean => {
    if (finished) return false;
    finished = true;
    abortSignal.removeEventListener("abort", abortStream);
    cleanup();
    return true;
  };
  const abortStream = () => {
    if (!finish()) return;
    streamController?.error(abortSignal.reason);
    cancelReader(abortSignal.reason);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      abortSignal.addEventListener("abort", abortStream, { once: true });
      if (abortSignal.aborted) abortStream();
    },
    async pull(controller) {
      if (finished) return;
      try {
        const result = await reader.read();
        if (finished) return;
        if (result.done) {
          finish();
          releaseReader();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        if (finish()) {
          abortRequest(error);
          controller.error(error);
          cancelReader(error);
        }
      }
    },
    cancel(reason) {
      if (!finish()) return;
      abortRequest(reason);
      cancelReader(reason);
    },
  });
}

function providerTimeoutError(
  options: { providerKind: ProviderKind; providerLabel: string },
): ProviderRequestError {
  return new ProviderRequestError({
    provider: options.providerKind,
    status: 0,
    message: `${options.providerLabel} request failed: request timed out`,
    retryable: true,
  });
}

function providerProtocolError(
  options: { providerKind: ProviderKind; providerLabel: string },
  message: string,
  status = 200,
): ProviderRequestError {
  return new ProviderRequestError({
    provider: options.providerKind,
    status,
    message: `${options.providerLabel} request failed: ${message}`,
    retryable: false,
  });
}

async function readSuccessfulJsonText(
  response: Response,
  maxResponseBytes: number,
  abortSignal: AbortSignal,
  options: { providerKind: ProviderKind; providerLabel: string },
): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let completed = false;
  let cleanupReason: unknown;
  const releaseReader = createReaderReleaser(reader);

  try {
    let byteLength = 0;
    let bytes = new Uint8Array(0);
    let readCount = 0;

    while (true) {
      readCount++;
      if (readCount > MAX_PROVIDER_JSON_BODY_READS) {
        throw providerProtocolError(
          options,
          `JSON response exceeded ${MAX_PROVIDER_JSON_BODY_READS} body reads`,
          response.status,
        );
      }
      const { done, value } = await waitForAbortable(
        () => reader.read(),
        abortSignal,
      );
      if (done) {
        completed = true;
        try {
          return decoder.decode(bytes.subarray(0, byteLength));
        } catch {
          throw providerProtocolError(
            options,
            "response body was not valid UTF-8",
            response.status,
          );
        }
      }

      if (value.byteLength > maxResponseBytes - byteLength) {
        throw providerProtocolError(
          options,
          `JSON response exceeded ${maxResponseBytes} bytes`,
          response.status,
        );
      }
      byteLength += value.byteLength;

      if (bytes.byteLength < byteLength) {
        let capacity = Math.min(
          maxResponseBytes,
          Math.max(1_024, bytes.byteLength * 2),
        );
        while (capacity < byteLength) {
          capacity = Math.min(maxResponseBytes, capacity * 2);
        }
        const grown = new Uint8Array(capacity);
        grown.set(bytes);
        bytes = grown;
      }
      bytes.set(value, byteLength - value.byteLength);
    }
  } catch (error) {
    cleanupReason = error;
    throw error;
  } finally {
    if (completed) {
      releaseReader();
    } else {
      cancelReaderWithoutWaiting(reader, cleanupReason, releaseReader);
    }
  }
}

/**
 * Request and parse a bounded JSON response.
 *
 * The request has a five-minute default deadline and a 32 MiB default body
 * limit. Provider HTTP errors, timeouts, malformed JSON, and oversized bodies
 * reject with a contextual `ProviderError` without exposing response payloads.
 */
export async function requestJson(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerLabel: string;
  providerKind: ProviderKind;
  timeoutMs?: number;
  maxResponseBytes?: number;
}): Promise<unknown> {
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_PROVIDER_JSON_MAX_BYTES;
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes <= 0 ||
    maxResponseBytes > MAX_PROVIDER_JSON_MAX_BYTES
  ) {
    throw new RangeError(
      `maxResponseBytes must be a positive safe integer no greater than ${MAX_PROVIDER_JSON_MAX_BYTES}`,
    );
  }
  const deadline = createRequestDeadline(
    options.init,
    options.timeoutMs ?? DEFAULT_PROVIDER_JSON_TIMEOUT_MS,
    "timeoutMs",
  );

  try {
    const response = await waitForAbortable(
      () => options.fetchImpl(options.url, deadline.init),
      deadline.deadlineSignal,
      cancelLateResponse,
    );
    if (!response.ok) {
      const err = await buildProviderError(
        options.providerKind,
        response,
        deadline.deadlineSignal,
      );
      err.message = `${options.providerLabel} request failed: ${err.message}`;
      throw err;
    }

    const text = await readSuccessfulJsonText(
      response,
      maxResponseBytes,
      deadline.deadlineSignal,
      options,
    );

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw providerProtocolError(options, "response body was not valid JSON", response.status);
    }
  } catch (error) {
    if (deadline.timedOut) {
      throw providerTimeoutError(options);
    }
    throw error;
  } finally {
    deadline.dispose();
  }
}

/**
 * Request a streaming response. When the request body is replayable,
 * classified rate-limit responses are retried up to two times before provider
 * output is exposed, with all retry waits and attempts bounded by the stream
 * header deadline. ReadableStream request bodies are not retried because fetch
 * can consume them on the first attempt.
 *
 * Response headers and error bodies have a 30-second default deadline. After
 * headers arrive, caller cancellation remains connected to the returned body;
 * consumer cancellation aborts the request and cancels the upstream body.
 */
export async function requestStream(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerLabel: string;
  providerKind: ProviderKind;
  headersTimeoutMs?: number;
}): Promise<ReadableStream<Uint8Array>> {
  const deadline = createRequestDeadline(
    options.init,
    options.headersTimeoutMs ?? DEFAULT_PROVIDER_STREAM_HEADERS_TIMEOUT_MS,
    "headersTimeoutMs",
  );
  let streamOwnsDeadline = false;
  let rateLimitRetryCount = 0;
  const requestBodyIsReplayable = !(deadline.init.body instanceof ReadableStream);

  try {
    while (true) {
      const response = await waitForAbortable(
        () => options.fetchImpl(options.url, deadline.init),
        deadline.deadlineSignal,
        cancelLateResponse,
      );
      if (!response.ok) {
        const err = await buildProviderError(
          options.providerKind,
          response,
          deadline.deadlineSignal,
        );
        err.message = `${options.providerLabel} request failed: ${err.message}`;
        if (
          err instanceof ProviderRateLimitError &&
          requestBodyIsReplayable &&
          rateLimitRetryCount < MAX_PROVIDER_STREAM_RATE_LIMIT_RETRIES
        ) {
          const retryDelayMs = err.retryAfterMs ??
            DEFAULT_PROVIDER_STREAM_RATE_LIMIT_RETRY_DELAY_MS * 2 ** rateLimitRetryCount;
          rateLimitRetryCount++;
          await waitForProviderRateLimitRetry(retryDelayMs, deadline.deadlineSignal);
          continue;
        }
        throw err;
      }

      if (!response.body) {
        throw new ProviderRequestError({
          provider: options.providerKind,
          status: response.status,
          message: `${options.providerLabel} request failed: stream body missing`,
          retryable: false,
        });
      }

      deadline.cancelTimeout();
      streamOwnsDeadline = true;
      return streamWithCleanup(
        response.body,
        deadline.deadlineSignal,
        deadline.abort,
        deadline.dispose,
      );
    }
  } catch (error) {
    if (deadline.timedOut) {
      throw providerTimeoutError(options);
    }
    throw error;
  } finally {
    deadline.cancelTimeout();
    if (!streamOwnsDeadline) deadline.dispose();
  }
}
