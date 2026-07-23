import { readRecord } from "./provider-records.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";

/**
 * Which provider runtime a request is being sent to.
 * `mistral` and `moonshotai` use the OpenAI-compatible wire format and are
 * therefore treated as "openai" for error classification purposes; they are
 * listed here so call sites can pass accurate labels without a cast.
 */
export type ProviderKind = "anthropic" | "openai" | "google" | "mistral" | "moonshotai";

/** Bytes inspected for structured provider error classification. */
const MAX_ERROR_BODY_BYTES = 8_000;
const MAX_JSON_RESPONSE_BYTES = 8 * 1_024 * 1_024;
const MAX_RETRY_AFTER_MS = 2_147_483_647;

/**
 * Base class for typed provider errors. The `retryable` flag is the
 * primary signal for callers (or a retry wrapper) to decide whether to
 * re-issue the request. `retryAfterMs` is set when the provider gave an
 * explicit delay hint (Retry-After header, Retry-Info trailer).
 */
export class ProviderError extends Error {
  /** Provider runtime that produced the error. */
  readonly provider: ProviderKind;
  /** HTTP status, or zero when no response was received. */
  readonly status: number;
  /** Whether retrying the unchanged request can succeed. */
  readonly retryable: boolean;
  /** Provider-supplied minimum retry delay. */
  readonly retryAfterMs?: number;

  /** Creates a typed provider transport error. */
  constructor(options: {
    provider: ProviderKind;
    status: number;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
  }) {
    super(options.message);
    this.name = new.target.name;
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

/** Provider account quota is exhausted - non-retryable. */
export class ProviderQuotaError extends ProviderError {}

/** Non-retryable 4xx/5xx that doesn't fit another bucket. */
export class ProviderRequestError extends ProviderError {}

/** Parses retry after ms. */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const normalized = header.trim();
  if (!normalized) return undefined;
  if (/^\d+$/u.test(normalized)) {
    const milliseconds = Number(normalized) * 1000;
    return Number.isSafeInteger(milliseconds) && milliseconds <= MAX_RETRY_AFTER_MS
      ? milliseconds
      : undefined;
  }
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(normalized)) {
    return undefined;
  }
  // IMF-fixdate form defined by HTTP semantics.
  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    const milliseconds = Math.max(0, parsed - Date.now());
    return Number.isSafeInteger(milliseconds) && milliseconds <= MAX_RETRY_AFTER_MS
      ? milliseconds
      : undefined;
  }
  return undefined;
}

/**
 * Inspect a non-2xx response and build the most specific ProviderError
 * subclass we can. Reads the response body as text (it's already dead
 * on the wire by this point). Body classification handles the cases
 * where HTTP status alone is ambiguous - notably OpenAI
 * `insufficient_quota` vs `rate_limit_exceeded` both arriving as 429.
 */
export async function buildProviderError(
  provider: ProviderKind,
  response: Response,
): Promise<ProviderError> {
  const status = response.status;
  let rawBody = "";
  let truncated = true;
  try {
    ({ text: rawBody, truncated } = await readResponseTextPrefix(
      response,
      MAX_ERROR_BODY_BYTES,
    ));
  } catch {
    // Treat an unreadable error body as untrusted and ambiguous.
  }
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
  const errorCode = typeof errorRecord?.code === "string"
    ? errorRecord.code
    : typeof errorRecord?.type === "string"
    ? errorRecord.type
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
    const knownRateLimitCodes = new Set([
      "rate_limit_exceeded",
      "rate_limit_error",
      "requests_per_minute_exceeded",
      "tokens_per_minute_exceeded",
    ]);
    if (
      truncated || parsedBody === undefined || !errorCode || !knownRateLimitCodes.has(errorCode)
    ) {
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

  // Google uses RESOURCE_EXHAUSTED for RPM, TPM, capacity, and rolling
  // spend limits. Its API guidance treats 429 as transient and recommends
  // bounded exponential backoff, so a parsed 429 is retryable here.
  if (provider === "google" && status === 429) {
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

  if (status === 408 || status === 409 || status === 425) {
    return new ProviderOverloadedError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  // Most 5xx responses are transient, including non-standard reverse-proxy
  // statuses such as 520-524. 501 and 505 describe unsupported capabilities
  // that an unchanged retry cannot fix.
  if (status >= 500 && status <= 599 && status !== 501 && status !== 505) {
    return new ProviderOverloadedError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  return new ProviderRequestError({
    provider,
    status,
    message,
    retryable: false,
  });
}

function createRequestBoundaryError(
  provider: ProviderKind,
  status: number,
  message: string,
): ProviderRequestError {
  return new ProviderRequestError({
    provider,
    status,
    message,
    retryable: false,
  });
}

function normalizeProviderLabel(value: string, fallback: ProviderKind): string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 &&
      /^[A-Za-z0-9][A-Za-z0-9._ -]*$/u.test(value)
    ? value
    : fallback;
}

function assertSafeProviderUrl(url: string, provider: ProviderKind): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw createRequestBoundaryError(provider, 0, "Provider request URL is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username ||
    parsed.password
  ) {
    throw createRequestBoundaryError(provider, 0, "Provider request URL is invalid");
  }
}

async function fetchProviderResponse(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerKind: ProviderKind;
}): Promise<Response> {
  assertSafeProviderUrl(options.url, options.providerKind);
  let response: unknown;
  try {
    response = await options.fetchImpl(options.url, { ...options.init, redirect: "error" });
  } catch (error) {
    if (
      options.init.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new DOMException("The provider request was aborted", "AbortError");
    }
    throw new ProviderOverloadedError({
      provider: options.providerKind,
      status: 0,
      message: "Provider request failed before receiving a response",
      retryable: true,
    });
  }
  if (!(response instanceof Response)) {
    throw createRequestBoundaryError(
      options.providerKind,
      0,
      "Provider transport returned an invalid response",
    );
  }
  return response;
}

/** Request and parse a JSON response. */
export async function requestJson(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerLabel: string;
  providerKind: ProviderKind;
}): Promise<unknown> {
  const response = await fetchProviderResponse(options);
  if (!response.ok) {
    const err = await buildProviderError(options.providerKind, response);
    err.message = `${
      normalizeProviderLabel(options.providerLabel, options.providerKind)
    }: ${err.message}`;
    throw err;
  }

  let body: string;
  let truncated: boolean;
  try {
    ({ text: body, truncated } = await readResponseTextPrefix(response, MAX_JSON_RESPONSE_BYTES));
  } catch {
    throw createRequestBoundaryError(
      options.providerKind,
      response.status,
      "Provider response body could not be read",
    );
  }
  if (truncated) {
    throw createRequestBoundaryError(
      options.providerKind,
      response.status,
      "Provider response exceeded the supported size",
    );
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw createRequestBoundaryError(
      options.providerKind,
      response.status,
      "Provider response was not valid JSON",
    );
  }
}

/** Request a streaming response. */
export async function requestStream(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerLabel: string;
  providerKind: ProviderKind;
}): Promise<ReadableStream<Uint8Array>> {
  const response = await fetchProviderResponse(options);
  if (!response.ok) {
    const err = await buildProviderError(options.providerKind, response);
    err.message = `${
      normalizeProviderLabel(options.providerLabel, options.providerKind)
    }: ${err.message}`;
    throw err;
  }

  if (!response.body) {
    throw new ProviderRequestError({
      provider: options.providerKind,
      status: response.status,
      message: `${
        normalizeProviderLabel(options.providerLabel, options.providerKind)
      }: stream body missing`,
      retryable: false,
    });
  }

  return response.body;
}
