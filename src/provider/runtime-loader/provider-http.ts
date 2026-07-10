import { readRecord } from "./provider-records.ts";

/**
 * Which provider runtime a request is being sent to.
 * `mistral` and `moonshotai` use the OpenAI-compatible wire format and are
 * therefore treated as "openai" for error classification purposes; they are
 * listed here so call sites can pass accurate labels without a cast.
 */
export type ProviderKind = "anthropic" | "openai" | "google" | "mistral" | "moonshotai";

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

/** Provider account quota is exhausted — non-retryable. */
export class ProviderQuotaError extends ProviderError {}

/** Non-retryable 4xx/5xx that doesn't fit another bucket. */
export class ProviderRequestError extends ProviderError {}

/** Parses retry after ms. */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.round(asNumber * 1000);
  }
  // HTTP-date form (rare in practice for LLM providers).
  const parsed = Date.parse(header);
  if (!Number.isNaN(parsed)) {
    return Math.max(0, parsed - Date.now());
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
): Promise<ProviderError> {
  const rawBody = await response.text();
  const message = rawBody.trim() || `${response.status} ${response.statusText}`.trim();
  const status = response.status;
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
    return new ProviderRateLimitError({
      provider,
      status,
      message,
      retryable: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }

  // Google 429 RESOURCE_EXHAUSTED is almost always the daily free-tier
  // quota — surface as a hard quota error so callers don't hot-loop on
  // retries that can't possibly succeed until midnight UTC.
  if (provider === "google" && status === 429) {
    if (errorCode === "RESOURCE_EXHAUSTED") {
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

/** Request and parse a JSON response. */
export async function requestJson(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerLabel: string;
  providerKind: ProviderKind;
}): Promise<unknown> {
  const response = await options.fetchImpl(options.url, options.init);
  if (!response.ok) {
    const err = await buildProviderError(options.providerKind, response);
    err.message = `${options.providerLabel} request failed: ${err.message}`;
    throw err;
  }

  return response.json();
}

/** Request a streaming response. */
export async function requestStream(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerLabel: string;
  providerKind: ProviderKind;
}): Promise<ReadableStream<Uint8Array>> {
  const response = await options.fetchImpl(options.url, options.init);
  if (!response.ok) {
    const err = await buildProviderError(options.providerKind, response);
    err.message = `${options.providerLabel} request failed: ${err.message}`;
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

  return response.body;
}
