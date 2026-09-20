import { readRecord } from "./provider-records.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { MAX_TIMER_DELAY_MS, normalizeTimerDurationMs } from "#veryfront/utils/timer.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";
// Import from process/env.ts, not the process.ts barrel: the barrel also
// re-exports runCommand, which pulls platform/compat/dynamic-import.ts and its
// `new Function` into any bundle that reaches this module.
import { getHostEnvExcludingEnvFile } from "#veryfront/platform/compat/process/env.ts";
import { notifyProviderRequestRetry } from "./provider-request-observer.ts";
import { resolveVeryfrontCloudSurface } from "../veryfront-cloud/model-catalog.ts";

/**
 * Which provider runtime a request is being sent to.
 *
 * The listed providers autocomplete. Any other provider name is accepted, so a
 * call site can pass an accurate label for a provider this package does not
 * list without a cast. Error classification reads the wire surface the provider
 * speaks, not its name.
 */
export type ProviderKind =
  | "anthropic"
  | "openai"
  | "google"
  | "mistral"
  | "moonshotai"
  | (string & Record<never, never>);

/** Bytes inspected for structured provider error classification. */
const MAX_ERROR_BODY_BYTES = 8_000;
const DEFAULT_PROVIDER_JSON_TIMEOUT_MS = 5 * 60_000;
/** Default deadline for one stream attempt to return response headers. */
export const DEFAULT_PROVIDER_STREAM_HEADERS_TIMEOUT_MS = 30_000;
const MAX_PROVIDER_STREAM_RETRIES = 2;
// Not JSDoc: this paragraph names hosted-infrastructure internals and must
// stay out of the generated public API reference. The default below is
// deliberately under the 45s `generic_idle` deadline the hosted child-fork
// watchdog applies to the first stream part
// (`DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS`): that watchdog arms its
// timer around the first pull of `fullStream`, which is what drives the
// provider call, so replays outliving this budget would be cut off mid-attempt
// and reported as a fork stall instead of the provider timeout they are.
/**
 * Ceiling on the wall time replays may spend waiting for stream response
 * headers.
 *
 * The budget bounds the total only when it is at least as large as the
 * per-attempt deadline, which the defaults guarantee (40s against 30s). The
 * first attempt always keeps its configured deadline, so a caller that raises
 * `headersTimeoutMs` above the budget gets that longer first attempt and the
 * effective ceiling becomes `max(headersTimeoutMs, totalHeadersBudgetMs)`.
 * Shortening the first attempt instead would sacrifice a provider that was
 * going to answer, for a replay that may never fire.
 */
export const DEFAULT_PROVIDER_STREAM_TOTAL_HEADERS_BUDGET_MS = 40_000;

// Not JSDoc: this paragraph names hosted-infrastructure internals and must
// stay out of the generated public API reference. Where the default below
// sits relative to the consumer watchdogs (all three relations are pinned by
// "pins the default against the consumer watchdog windows" in
// provider-http.test.ts, so moving either side breaks a test rather than this
// comment):
//   * above the hosted child-fork `generic_idle` deadline, 45s
//     (`DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS`);
//   * exactly equal to the chat stream watchdog's idle window, 120s
//     (`DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS`);
//   * below that watchdog's tool-running window, 300s
//     (`DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS`).
// The equal and below cases do not make this deadline pre-empt a consumer
// stall, because the two count different things: the consumer watchdogs count
// *semantic chunks*, this one counts *bytes on the wire*. A provider that is
// still working keeps bytes flowing -- Anthropic sends SSE `ping` frames
// (handled in anthropic-stream.ts) and the Veryfront Cloud gateway sends a
// keepalive every 15s -- and those bytes re-arm this deadline without
// advancing any consumer window. That includes the case the phase difference
// would otherwise break: a provider-executed tool (web_search, web_fetch,
// code_execution, the MCP connector) holds the HTTP response open and emits
// no chunk while it runs, which is what the 300s tool-running window is for,
// but the connection is not silent. So this deadline fires only on a socket
// that has gone genuinely quiet, which is the one stall no consumer watchdog
// can diagnose better, and it is the only bound at all for callers that have
// no watchdog (`agent.generate`, library embedders).
// The 60s/15s figures in src/agent/streaming/lifecycle/policy.ts belong to the
// strict lifecycle policy and apply only under VF_STREAM_LIFECYCLE_MODE of
// `shadow` or `active`, not to the legacy default this comment compares to.
/**
 * Default deadline for the next chunk of a stream response body.
 *
 * Armed around each pending read once response headers have arrived, and
 * disarmed as soon as bytes land, so it measures how long the provider has
 * been silent rather than how long the whole response takes. Keep it well
 * above the provider's SSE keepalive interval (the Veryfront Cloud gateway
 * sends one every 15 seconds) so a healthy but slow response is never cut off.
 *
 * Override it per request with `requestStream`'s `idleTimeoutMs`, or for a
 * whole process with `VERYFRONT_PROVIDER_STREAM_IDLE_TIMEOUT_MS`.
 */
export const DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS = 120_000;

/**
 * Environment key overriding the stream body idle deadline, in milliseconds.
 *
 * This is the knob for callers that never touch `requestStream` themselves --
 * `veryfront dev` chat, hosted agent runs, and library use of
 * `agent.generate` / `agent.stream` -- because no shipped provider extension
 * exposes `idleTimeoutMs` as a model option. `0` disables the deadline.
 */
export const VERYFRONT_PROVIDER_STREAM_IDLE_TIMEOUT_ENV =
  "VERYFRONT_PROVIDER_STREAM_IDLE_TIMEOUT_MS";

/**
 * Resolve the body idle deadline for one stream request.
 *
 * Precedence is explicit option, then environment, then default. Read through
 * `getHostEnvExcludingEnvFile` rather than `getEnv` or `getHostEnv`: a project
 * `.env` file is untrusted input to the runtime, and this deadline is a safety
 * bound the host operator sets, not something a loaded project should be able
 * to widen or switch off. `getHostEnv` is not enough on its own -- `loadEnv`
 * copies project `.env` entries into the real process environment, so the
 * plain host read hands back the project's value; only the excluding reader
 * consults the provenance that `loadEnv` recorded and skips it.
 *
 * A malformed override is ignored with a warning instead of thrown. A typo in
 * a deployment's environment should not fail every provider request, and the
 * fallback still leaves the body bounded; an explicit `idleTimeoutMs` argument
 * is a programming error by comparison and keeps throwing.
 *
 * The warning names the key and the accepted range but never the rejected
 * value: `.env` expansion can substitute a host process secret into this
 * entry, so echoing it back would write that credential to the log.
 *
 * `readEnv` is a seam, not a feature: reading the real environment is the
 * default, and tests pass a lookup rather than mutating the host process. The
 * one test that does mutate it is the `.env`-provenance case, which has no
 * other way to exercise the reader this function defaults to.
 */
export function resolveProviderStreamIdleTimeoutMs(
  idleTimeoutMs: number | undefined,
  readEnv: (key: string) => string | undefined = getHostEnvExcludingEnvFile,
): number {
  if (idleTimeoutMs !== undefined) {
    return normalizeTimerDurationMs(idleTimeoutMs, "idleTimeoutMs");
  }

  const configured = readEnv(VERYFRONT_PROVIDER_STREAM_IDLE_TIMEOUT_ENV)?.trim();
  if (configured === undefined || configured === "") {
    return DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS;
  }

  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_TIMER_DELAY_MS) {
    logger.warn(
      `${VERYFRONT_PROVIDER_STREAM_IDLE_TIMEOUT_ENV} must be an integer between 0 and ` +
        `${MAX_TIMER_DELAY_MS}; ignoring the configured value and using the ` +
        `${DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS}ms default`,
    );
    return DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS;
  }

  return parsed;
}

/**
 * Elapsed-time source for the header budget. `Date.now` can step backwards
 * under an NTP or VM clock correction, which would inflate the remaining
 * budget and let replays run past the ceiling the budget exists to hold. Read
 * the seam once so a correction mid-request cannot move it.
 */
function monotonicMilliseconds(): number {
  return Math.floor(performance.now());
}
const DEFAULT_PROVIDER_STREAM_RETRY_DELAY_MS = 1_000;
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
  /**
   * Origin and path of the request that returned the HTTP error, without
   * credentials, query, or fragment. Callers compare it with a trusted route to
   * tell a Veryfront Cloud gateway rejection from a direct provider rejection
   * without parsing the message. Kept non-enumerable like `responseBody`.
   */
  declare readonly requestUrl?: string;
  /**
   * True when the Veryfront Cloud gateway fetch issued the failed request, so
   * the rejection came from the gateway whatever base URL it was built with.
   * Set only from a response that fetch marked. Kept non-enumerable.
   */
  declare readonly viaVeryfrontGateway?: boolean;

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

/**
 * Provider stopped generating at the output token limit, leaving the response
 * incomplete (for example a `tool_use` block whose input JSON never closed).
 *
 * Non-retryable: the same request and the same output token budget truncate
 * again. Raise the budget or shorten the requested output instead.
 */
export class ProviderOutputTruncatedError extends ProviderError {}

function readRequestRoute(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

// Captured at module load: project code sharing this runtime can replace
// WeakSet methods later, and a poisoned add or has must not break gateway calls.
const IntrinsicReflectApply = Reflect.apply;
const ObjectDefineProperty = Object.defineProperty;
const WeakSetPrototypeAdd = WeakSet.prototype.add;
const WeakSetPrototypeHas = WeakSet.prototype.has;
const veryfrontGatewayResponses = new WeakSet<Response>();

/**
 * @internal Record that the Veryfront Cloud gateway fetch produced this
 * response. Provider errors built from it carry `viaVeryfrontGateway`.
 */
export function markVeryfrontGatewayResponse(response: Response): Response {
  IntrinsicReflectApply(WeakSetPrototypeAdd, veryfrontGatewayResponses, [response]);
  return response;
}

/** @internal Return true when the Veryfront Cloud gateway fetch produced this response. */
export function isVeryfrontGatewayResponse(response: Response): boolean {
  return IntrinsicReflectApply(WeakSetPrototypeHas, veryfrontGatewayResponses, [
    response,
  ]) as boolean;
}

const veryfrontGatewayTransportFailures = new WeakSet<object>();

/**
 * @internal Record that the Veryfront Cloud gateway fetch threw this error
 * before any response arrived, the no-response counterpart of
 * {@link markVeryfrontGatewayResponse}. It keeps gateway provenance for a
 * transport that a run-scoped or per-model base URL configured, which no
 * globally configured route matches.
 */
export function markVeryfrontGatewayTransportFailure(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    IntrinsicReflectApply(WeakSetPrototypeAdd, veryfrontGatewayTransportFailures, [error]);
  }
  return error;
}

/** @internal Return true when the Veryfront Cloud gateway fetch threw this error. */
export function isVeryfrontGatewayTransportFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    IntrinsicReflectApply(WeakSetPrototypeHas, veryfrontGatewayTransportFailures, [
      error,
    ]) as boolean;
}

const NativeWeakMap = WeakMap;
const WeakMapPrototypeGet = NativeWeakMap.prototype.get;
const WeakMapPrototypeSet = NativeWeakMap.prototype.set;
const modelRequestTransportFailureRoutes = new NativeWeakMap<object, string>();

/**
 * Route (origin and path) of the model request whose provider transport threw
 * `error` inside `requestJson` or `requestStream`, before any response
 * arrived. The counterpart of `ProviderError.requestUrl` for failures that
 * never produced a response.
 *
 * @internal Not re-exported from `veryfront/provider/shared`.
 */
export function getModelRequestTransportFailureUrl(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  return IntrinsicReflectApply(WeakMapPrototypeGet, modelRequestTransportFailureRoutes, [
    error,
  ]) as string | undefined;
}

async function fetchModelRequest(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    const requestRoute = readRequestRoute(url);
    if (typeof error === "object" && error !== null && requestRoute !== undefined) {
      IntrinsicReflectApply(WeakMapPrototypeSet, modelRequestTransportFailureRoutes, [
        error,
        requestRoute,
      ]);
    }
    throw error;
  }
}

function labelProviderResponseError(
  error: ProviderError,
  providerLabel: string,
  requestUrl: string,
  response: Response,
): ProviderError {
  error.message = `${providerLabel} request failed: ${error.message}`;
  if (isVeryfrontGatewayResponse(response)) {
    ObjectDefineProperty(error, "viaVeryfrontGateway", {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  const requestRoute = readRequestRoute(requestUrl);
  if (requestRoute !== undefined) {
    ObjectDefineProperty(error, "requestUrl", {
      value: requestRoute,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return error;
}

function preserveStructuredResponseBody<T extends ProviderError>(
  error: T,
  responseBody: string,
): T {
  ObjectDefineProperty(error, "responseBody", {
    value: responseBody,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return error;
}

interface ParsedProviderErrorBody {
  readonly parsedBody: Record<string, unknown> | undefined;
  readonly errorRecord: Record<string, unknown> | undefined;
  readonly errorType: string | undefined;
  readonly errorCode: string | undefined;
}

interface ProviderErrorBodyContext extends ParsedProviderErrorBody {
  readonly provider: ProviderKind;
  readonly status: number;
  readonly message: string;
  readonly retryAfterMs: number | undefined;
  readonly rawBody: string;
  readonly truncated: boolean;
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

/**
 * Whether the provider returns the OpenAI-compatible error envelope, which
 * quota and rate-limit classification reads.
 *
 * The answer comes from the wire surface the provider speaks. A provider the
 * catalog does not list resolves to the default surface and is classified on
 * the OpenAI envelope: that is the envelope an unlisted provider returns in
 * practice, and classification only fires on fields it actually finds, such as
 * an `insufficient_quota` code. A provider that answers in some other shape
 * therefore falls through to the generic handling rather than being
 * misreported.
 */
function isOpenAICompatibleProvider(provider: ProviderKind): boolean {
  return resolveVeryfrontCloudSurface(provider) === "openai";
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
 * Parse the structured error envelope without trusting it: malformed,
 * truncated, or non-JSON bodies all become absent metadata and fall back to
 * status-based classification.
 */
function parseProviderErrorBody(rawBody: string): ParsedProviderErrorBody {
  const parsedBody = (() => {
    try {
      return readRecord(JSON.parse(rawBody));
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

  return { parsedBody, errorRecord, errorType, errorCode };
}

/**
 * Gather the shared values every provider error classifier needs.
 */
function createProviderErrorBodyContext(
  provider: ProviderKind,
  response: Response,
  rawBody: string,
  truncated: boolean,
): ProviderErrorBodyContext {
  return {
    provider,
    status: response.status,
    message: `Provider request failed with status ${response.status}`,
    retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
    rawBody,
    truncated,
    ...parseProviderErrorBody(rawBody),
  };
}

/**
 * Classify Anthropic statuses whose retry behavior is fixed by HTTP status.
 */
function classifyAnthropicStatus(
  context: ProviderErrorBodyContext,
): ProviderError | undefined {
  if (context.provider !== "anthropic") return undefined;
  if (context.status === 529) {
    return new ProviderOverloadedError({
      provider: context.provider,
      status: context.status,
      message: context.message,
      retryable: true,
      ...(context.retryAfterMs !== undefined ? { retryAfterMs: context.retryAfterMs } : {}),
    });
  }
  if (context.status === 429) {
    return new ProviderRateLimitError({
      provider: context.provider,
      status: context.status,
      message: context.message,
      retryable: true,
      ...(context.retryAfterMs !== undefined ? { retryAfterMs: context.retryAfterMs } : {}),
    });
  }
  return undefined;
}

/**
 * Classify overload statuses shared by Google and OpenAI-compatible providers.
 */
function classifyExplicitOverloadStatus(
  context: ProviderErrorBodyContext,
): ProviderError | undefined {
  if (
    context.status !== 503 ||
    (!isOpenAICompatibleProvider(context.provider) && context.provider !== "google")
  ) {
    return undefined;
  }
  return new ProviderOverloadedError({
    provider: context.provider,
    status: context.status,
    message: context.message,
    retryable: true,
    ...(context.retryAfterMs !== undefined ? { retryAfterMs: context.retryAfterMs } : {}),
  });
}

/**
 * Split OpenAI-compatible 429 responses into hard quota failures and retryable
 * rate limits.
 */
function classifyOpenAICompatibleRateLimit(
  context: ProviderErrorBodyContext,
): ProviderError | undefined {
  if (!isOpenAICompatibleProvider(context.provider) || context.status !== 429) {
    return undefined;
  }
  if (context.errorCode === "insufficient_quota") {
    return new ProviderQuotaError({
      provider: context.provider,
      status: context.status,
      message: context.message,
      retryable: false,
    });
  }
  return new ProviderRateLimitError({
    provider: context.provider,
    status: context.status,
    message: context.message,
    retryable: true,
    ...(context.retryAfterMs !== undefined ? { retryAfterMs: context.retryAfterMs } : {}),
  });
}

/**
 * Split Google 429 responses by retry hints, because RESOURCE_EXHAUSTED covers
 * both permanent quota exhaustion and short-window rate limits.
 */
function classifyGoogleRateLimit(
  context: ProviderErrorBodyContext,
): ProviderError | undefined {
  if (context.provider !== "google" || context.status !== 429) return undefined;

  const retryDelayMs = context.retryAfterMs ?? parseGoogleRetryInfoMs(context.errorRecord);
  if (context.errorCode === "RESOURCE_EXHAUSTED" && retryDelayMs === undefined) {
    return new ProviderQuotaError({
      provider: context.provider,
      status: context.status,
      message: context.message,
      retryable: false,
    });
  }
  return new ProviderRateLimitError({
    provider: context.provider,
    status: context.status,
    message: context.message,
    retryable: true,
    ...(retryDelayMs !== undefined ? { retryAfterMs: retryDelayMs } : {}),
  });
}

/**
 * Classify conventional transient upstream statuses that can clear on retry.
 */
function classifyTransientStatus(
  context: ProviderErrorBodyContext,
): ProviderError | undefined {
  if (!TRANSIENT_PROVIDER_STATUSES.has(context.status)) return undefined;
  return new ProviderOverloadedError({
    provider: context.provider,
    status: context.status,
    message: context.message,
    retryable: true,
    ...(context.retryAfterMs !== undefined ? { retryAfterMs: context.retryAfterMs } : {}),
  });
}

/**
 * Decide whether an otherwise terminal request error carries structured
 * details that downstream internal classifiers are allowed to inspect.
 */
function shouldPreserveStructuredResponseBody(context: ProviderErrorBodyContext): boolean {
  if (context.truncated || context.parsedBody === undefined) return false;
  if (
    context.status === 400 &&
    isInvalidRequestEnvelope(context.errorType, context.errorRecord)
  ) {
    return true;
  }

  // The Veryfront Cloud gateway rejects a request that names no project with a
  // 400 and this code. Eval classification needs it to fail fast.
  if (context.status === 400 && context.parsedBody.code === "gateway_project_required") {
    return true;
  }

  const problemSlug = typeof context.parsedBody.slug === "string"
    ? context.parsedBody.slug
    : undefined;
  return context.status === 402 &&
    (problemSlug === "insufficient-credits" || problemSlug === "resource-limit-exceeded");
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
  let rawBody: string;
  let truncated: boolean;
  try {
    ({ text: rawBody, truncated } = await readResponseTextPrefix(
      response,
      MAX_ERROR_BODY_BYTES,
      abortSignal,
    ));
  } catch (error) {
    if (abortSignal?.aborted === true) throw error;
    return buildProviderErrorFromUnreadableBody(provider, response);
  }
  return buildProviderErrorFromBody(provider, response, rawBody, truncated);
}

/**
 * Classify a provider error response from a bounded body prefix. The body may
 * be absent or truncated when the provider stalls, so status-based fallbacks
 * stay authoritative unless a complete recognised envelope is present.
 */
function buildProviderErrorFromBody(
  provider: ProviderKind,
  response: Response,
  rawBody: string,
  truncated: boolean,
): ProviderError {
  const context = createProviderErrorBodyContext(provider, response, rawBody, truncated);

  // Anthropic 529 = overloaded. Anthropic surfaces this with
  // { error: { type: "overloaded_error" } } in the body.
  // Anthropic 429 = rate limiting. Retryable; honor Retry-After if present.
  const anthropicStatus = classifyAnthropicStatus(context);
  if (anthropicStatus !== undefined) return anthropicStatus;

  // OpenAI / Mistral / Moonshotai / Google 503 = overloaded.
  // Mistral and Moonshotai use the OpenAI-compatible wire format so their
  // error shapes are structurally identical to OpenAI's.
  const explicitOverload = classifyExplicitOverloadStatus(context);
  if (explicitOverload !== undefined) return explicitOverload;

  // OpenAI / Mistral / Moonshotai 429 splits based on the error code in the body:
  //  - insufficient_quota → hard quota, non-retryable
  //  - rate_limit_exceeded / tokens_per_min_exceeded → retry with Retry-After
  // Mistral and Moonshotai use the same OpenAI-compatible error envelope.
  //
  // A body that never parsed — empty, truncated, HTML from a gateway — carries
  // no `insufficient_quota` and so stays a rate limit. An unreadable body is
  // not evidence of exhausted quota, and calling it one ends an agent run on a
  // limit that would have cleared on its own. Retries are bounded by the
  // caller, so a misread hard quota costs attempts, never a hot loop.
  const openAICompatibleRateLimit = classifyOpenAICompatibleRateLimit(context);
  if (openAICompatibleRateLimit !== undefined) return openAICompatibleRateLimit;

  // Google returns RESOURCE_EXHAUSTED for both the daily free-tier quota and
  // short-window per-minute/per-token limits, so the status alone cannot
  // separate them. A retry delay can: Google attaches Retry-After or a
  // `google.rpc.RetryInfo` detail to the limits that clear on their own and
  // returns neither for a quota that cannot succeed again until the daily
  // window resets. The QuotaFailure detail names the violated metric but its
  // wording is not a stable contract, so the delay is the signal we key on.
  // Without one the error stays a hard quota error and callers don't hot-loop
  // on retries that can't possibly succeed until midnight UTC.
  //
  // A body that never parsed names no status at all, so it falls through to
  // the retryable branch for the same reason the OpenAI-compatible split does.
  const googleRateLimit = classifyGoogleRateLimit(context);
  if (googleRateLimit !== undefined) return googleRateLimit;

  // Retry only statuses that conventionally represent transient upstream
  // failures. Other 5xx responses can describe permanent protocol or
  // configuration errors that an unchanged retry cannot fix.
  const transientStatus = classifyTransientStatus(context);
  if (transientStatus !== undefined) return transientStatus;

  const requestError = new ProviderRequestError({
    provider: context.provider,
    status: context.status,
    message: context.message,
    retryable: false,
  });

  return shouldPreserveStructuredResponseBody(context)
    ? preserveStructuredResponseBody(requestError, context.rawBody)
    : requestError;
}

/**
 * Fall back to status-only classification when an error body cannot be read.
 */
function buildProviderErrorFromUnreadableBody(
  provider: ProviderKind,
  response: Response,
): ProviderError {
  return buildProviderErrorFromBody(provider, response, "", true);
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

/**
 * Wait out a retry delay, rejecting the moment the caller cancels. Shared with
 * providers that must replay a request the SSE body failed, so every retry
 * path honors cancellation the same way.
 */
export async function waitForProviderStreamRetry(
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

type ProviderStreamOutcome = "completed" | "failed" | "cancelled";

/**
 * Deadline on the wait for the next chunk of a stream body.
 *
 * `timeoutMs` of 0 disables it, matching `createRequestDeadline`'s convention.
 * `createError` is a closure so this helper needs no knowledge of the request
 * options the error is built from.
 */
type ProviderStreamIdleDeadline = {
  readonly timeoutMs: number;
  createError(elapsedMs: number): unknown;
};

function streamWithCleanup(
  stream: ReadableStream<Uint8Array>,
  abortSignal: AbortSignal,
  abortRequest: (reason?: unknown) => void,
  cleanup: () => void,
  onFinish: (outcome: ProviderStreamOutcome) => void,
  idle: ProviderStreamIdleDeadline,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let finished = false;
  let cancellationStarted = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const releaseReader = createReaderReleaser(reader);
  const cancelReader = (reason: unknown): void => {
    if (cancellationStarted) return;
    cancellationStarted = true;
    cancelReaderWithoutWaiting(reader, reason, releaseReader);
  };
  const disarmIdleDeadline = (): void => {
    if (idleTimeoutId === undefined) return;
    clearTimeout(idleTimeoutId);
    idleTimeoutId = undefined;
  };
  const finish = (outcome: ProviderStreamOutcome): boolean => {
    // Outside the `finished` guard: a losing caller still leaves the timer
    // armed, and an armed timer past the last read keeps the runtime awake.
    disarmIdleDeadline();
    if (finished) return false;
    finished = true;
    abortSignal.removeEventListener("abort", abortStream);
    cleanup();
    try {
      onFinish(outcome);
    } catch {
      // Stream observation must not change stream behavior.
    }
    return true;
  };
  const abortStream = () => {
    if (!finish("cancelled")) return;
    streamController?.error(abortSignal.reason);
    cancelReader(abortSignal.reason);
  };
  // Arms only around a pending read, so a consumer that stops pulling is not
  // timed out for its own backpressure: the deadline measures provider
  // silence, not response length.
  //
  // That costs a setTimeout/clearTimeout pair per chunk on the hot path.
  // Measured at ~1.15us per pair on this runtime, so a 5,000-chunk response
  // spends under 6ms on timers across a response lasting tens of seconds. A
  // polling interval over a `lastChunkAt` timestamp would trade that for
  // deadline precision and a timer that outlives the read it is guarding, so
  // the exact per-read arm stays.
  const armIdleDeadline = (): void => {
    if (idle.timeoutMs === 0) return;
    const armedAt = monotonicMilliseconds();
    idleTimeoutId = setTimeout(() => {
      idleTimeoutId = undefined;
      const error = idle.createError(monotonicMilliseconds() - armedAt);
      // Same path as a failed read: aborting the request is what releases the
      // provider connection. Erroring the reader alone leaves the socket open.
      if (!finish("failed")) return;
      abortRequest(error);
      streamController?.error(error);
      cancelReader(error);
    }, idle.timeoutMs);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      abortSignal.addEventListener("abort", abortStream, { once: true });
      if (abortSignal.aborted) abortStream();
    },
    async pull(controller) {
      if (finished) return;
      armIdleDeadline();
      try {
        const result = await reader.read();
        disarmIdleDeadline();
        if (finished) return;
        if (result.done) {
          finish("completed");
          releaseReader();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        disarmIdleDeadline();
        if (finish("failed")) {
          abortRequest(error);
          controller.error(error);
          cancelReader(error);
        }
      }
    },
    cancel(reason) {
      if (!finish("cancelled")) return;
      abortRequest(reason);
      cancelReader(reason);
    },
  });
}

/**
 * Build the error for an elapsed request deadline.
 *
 * Names the deadline that fired, the time it took to fire, and the model when
 * the caller supplied one. Without those every timeout serializes to the same
 * sentence, and a responder cannot separate one slow model from a stalled
 * gateway.
 */
function providerTimeoutError(
  options: { providerKind: ProviderKind; providerLabel: string; modelId?: string },
  deadline: { waitingFor: string; timeoutMs: number; elapsedMs: number },
): ProviderRequestError {
  const model = options.modelId === undefined ? "" : `, model ${options.modelId}`;
  return new ProviderRequestError({
    provider: options.providerKind,
    status: 0,
    message: `${options.providerLabel} request failed: request timed out after ` +
      `${deadline.elapsedMs}ms waiting for ${deadline.waitingFor} ` +
      `(${deadline.timeoutMs}ms deadline${model})`,
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
  /** Model this request is for. Reported when a deadline elapses. */
  modelId?: string;
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_JSON_TIMEOUT_MS;
  const startedAt = Date.now();
  const deadline = createRequestDeadline(options.init, timeoutMs, "timeoutMs");
  // The HTTP rejection outranks a deadline that expired while its error body
  // was being read: the status is already known and callers classify on it.
  let httpRejection: ProviderError | undefined;
  const logFields = {
    provider: options.providerLabel,
    ...(options.modelId === undefined ? {} : { model: options.modelId }),
  };
  logger.debug("Provider request started", logFields);
  let status: number | undefined;

  try {
    const response = await waitForAbortable(
      () => fetchModelRequest(options.fetchImpl, options.url, deadline.init),
      deadline.deadlineSignal,
      cancelLateResponse,
    );
    status = response.status;
    if (!response.ok) {
      let err: ProviderError;
      try {
        err = await buildProviderError(
          options.providerKind,
          response,
          deadline.deadlineSignal,
        );
      } catch (error) {
        if (!deadline.timedOut) throw error;
        err = buildProviderErrorFromUnreadableBody(options.providerKind, response);
      }
      httpRejection = labelProviderResponseError(
        err,
        options.providerLabel,
        options.url,
        response,
      );
      throw httpRejection;
    }

    const text = await readSuccessfulJsonText(
      response,
      maxResponseBytes,
      deadline.deadlineSignal,
      options,
    );

    try {
      const payload = JSON.parse(text) as unknown;
      logger.debug("Provider request finished", {
        ...logFields,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return payload;
    } catch {
      throw providerProtocolError(options, "response body was not valid JSON", response.status);
    }
  } catch (error) {
    logger.debug("Provider request failed", {
      ...logFields,
      ...(status === undefined ? {} : { status }),
      timedOut: deadline.timedOut,
      durationMs: Date.now() - startedAt,
    });
    if (deadline.timedOut && error !== httpRejection) {
      throw providerTimeoutError(options, {
        waitingFor: "the JSON response",
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
      });
    }
    throw error;
  } finally {
    deadline.dispose();
  }
}

/**
 * Request a streaming response. When the request body is replayable,
 * typed retryable failures are retried up to two times before provider output
 * is exposed. Each attempt gets a fresh stream header deadline, and replays are
 * capped so the whole header wait stays inside one shared budget.
 * ReadableStream request bodies are not retried because fetch can
 * consume them on the first attempt.
 *
 * Response headers and error bodies have a 30-second default per-attempt
 * deadline, and replays are additionally capped so the whole header wait stays
 * inside a 40-second default budget. The first attempt always runs on the full
 * per-attempt deadline; only replays are shortened to fit the budget. After
 * headers arrive, caller cancellation remains connected to the returned body;
 * consumer cancellation aborts the request and cancels the upstream body.
 *
 * The body itself is bounded by a 120-second default idle deadline: a read
 * that waits that long for the next chunk aborts the request and rejects with
 * a retryable timeout, so a provider that goes silent mid-response cannot hang
 * a caller that has no watchdog of its own. Tune it per request with
 * `idleTimeoutMs`, or process-wide with
 * `VERYFRONT_PROVIDER_STREAM_IDLE_TIMEOUT_MS`.
 */
export async function requestStream(options: {
  url: string;
  fetchImpl: typeof globalThis.fetch;
  init: RequestInit;
  providerLabel: string;
  providerKind: ProviderKind;
  /** Model this request is for. Reported when a deadline elapses. */
  modelId?: string;
  headersTimeoutMs?: number;
  /**
   * Ceiling on the wall time replays may spend waiting for headers. Defaults to
   * 40 seconds. Set it at or above `headersTimeoutMs` for it to bound the total,
   * because the first attempt always keeps its own deadline.
   */
  totalHeadersBudgetMs?: number;
  /**
   * Deadline on each wait for the next chunk of the response body, once
   * headers have arrived. Defaults to
   * `VERYFRONT_PROVIDER_STREAM_IDLE_TIMEOUT_MS` when that is set to a valid
   * value, and to 120 seconds otherwise. `0` disables it and restores an
   * unbounded body, which only a caller that runs its own idle watchdog
   * should ask for.
   */
  idleTimeoutMs?: number;
}): Promise<ReadableStream<Uint8Array>> {
  const headersTimeoutMs = options.headersTimeoutMs ??
    DEFAULT_PROVIDER_STREAM_HEADERS_TIMEOUT_MS;
  const totalHeadersBudgetMs = normalizeTimerDurationMs(
    options.totalHeadersBudgetMs ?? DEFAULT_PROVIDER_STREAM_TOTAL_HEADERS_BUDGET_MS,
    "totalHeadersBudgetMs",
  );
  // Resolved before the first attempt is issued, so a bad explicit value fails
  // fast instead of surfacing after a provider request has already been sent.
  const idleTimeoutMs = resolveProviderStreamIdleTimeoutMs(options.idleTimeoutMs);
  const requestBodyIsReplayable = !(options.init.body instanceof ReadableStream);
  const requestStartedAt = monotonicMilliseconds();
  let retryCount = 0;
  // The first attempt is never shortened to reserve room for a replay that may
  // not happen: a provider that would have answered at 29s still wins.
  let attemptTimeoutMs = headersTimeoutMs;

  const logFields = {
    provider: options.providerLabel,
    ...(options.modelId === undefined ? {} : { model: options.modelId }),
  };

  while (true) {
    const startedAt = monotonicMilliseconds();
    logger.debug("Provider stream request started", { ...logFields, attempt: retryCount + 1 });
    const deadline = createRequestDeadline(options.init, attemptTimeoutMs, "headersTimeoutMs");
    let streamOwnsDeadline = false;
    let bodyClaimAttempted = false;
    let responseReceived = false;

    try {
      const response = await waitForAbortable(
        () => fetchModelRequest(options.fetchImpl, options.url, deadline.init),
        deadline.deadlineSignal,
        cancelLateResponse,
      );
      responseReceived = true;
      logger.debug("Provider stream response received", {
        ...logFields,
        status: response.status,
        durationMs: monotonicMilliseconds() - startedAt,
      });
      if (!response.ok) {
        let err: ProviderError;
        try {
          err = await buildProviderError(
            options.providerKind,
            response,
            deadline.deadlineSignal,
          );
        } catch (error) {
          if (!deadline.timedOut) throw error;
          err = buildProviderErrorFromUnreadableBody(options.providerKind, response);
        }
        throw labelProviderResponseError(err, options.providerLabel, options.url, response);
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
      bodyClaimAttempted = true;
      const stream = streamWithCleanup(
        response.body,
        deadline.deadlineSignal,
        deadline.abort,
        deadline.dispose,
        (outcome) =>
          logger.debug("Provider stream finished", {
            ...logFields,
            outcome,
            durationMs: monotonicMilliseconds() - requestStartedAt,
          }),
        {
          timeoutMs: idleTimeoutMs,
          // `providerTimeoutError` marks this retryable, and unlike every
          // other retryable timeout here it can fire *after* provider output
          // has reached the caller. `requestStream` never acts on it itself --
          // `bodyClaimAttempted` has already blocked replays by this point --
          // so the flag is advice carried outward (stream-outcome.ts maps it
          // onto StreamLifecycleError.retryable), and the advice is sound for
          // its consumers today: nothing retries automatically, and a human or
          // caller re-running the request starts a fresh turn. A future
          // automatic retry loop must check whether output was already
          // emitted before replaying, or it will duplicate half a turn.
          createError: (elapsedMs) =>
            providerTimeoutError(options, {
              waitingFor: "the next stream chunk",
              timeoutMs: idleTimeoutMs,
              elapsedMs,
            }),
        },
      );
      // Ownership transfers only once the wrapped stream exists: a throw from
      // `streamWithCleanup` (getReader() on an unreadable body) leaves nothing
      // to call deadline.dispose(), so the finally below must still do it or
      // the caller-signal abort listener leaks (veryfront-issue-inbox#750).
      streamOwnsDeadline = true;
      return stream;
    } catch (error) {
      // Past this point `streamWithCleanup` has claimed (or tried to claim)
      // `response.body` with `getReader()`. Retrying would replay a request
      // whose body another reader may already hold, so surface the failure
      // whatever its shape. No stream was handed off, so nothing else will
      // release the provider connection: abort the request before surfacing
      // the failure, as the normal stream error and cancellation paths do.
      if (bodyClaimAttempted) {
        deadline.abort(error);
        throw error;
      }
      const failure = deadline.timedOut && !responseReceived
        ? providerTimeoutError(options, {
          waitingFor: "the stream response headers",
          // A replay runs on whatever the budget has left, so its deadline is
          // an internal clamp no configuration contains. Always report the
          // configured deadline (the first attempt runs on it unchanged), and
          // once a replay has happened report the whole wait. Reporting the
          // clamp instead reintroduces the undiagnosable error that
          // veryfront-issue-inbox#710 was filed to remove.
          timeoutMs: headersTimeoutMs,
          elapsedMs: retryCount === 0
            ? monotonicMilliseconds() - startedAt
            : monotonicMilliseconds() - requestStartedAt,
        })
        : error;
      const remainingBudgetMs = totalHeadersBudgetMs -
        (monotonicMilliseconds() - requestStartedAt);
      if (
        !(failure instanceof ProviderError) ||
        !failure.retryable ||
        !requestBodyIsReplayable ||
        retryCount >= MAX_PROVIDER_STREAM_RETRIES ||
        remainingBudgetMs <= 0
      ) {
        logger.debug("Provider stream request failed", {
          ...logFields,
          ...(failure instanceof ProviderError
            ? { status: failure.status, retryable: failure.retryable }
            : {}),
          durationMs: monotonicMilliseconds() - requestStartedAt,
        });
        throw failure;
      }

      const retryDelayMs = failure.retryAfterMs ??
        (deadline.timedOut ? 0 : DEFAULT_PROVIDER_STREAM_RETRY_DELAY_MS * 2 ** retryCount);
      // A provider-specified wait that cannot fit the current attempt's
      // remaining deadline cannot be honored. Report the provider failure we
      // actually received instead of rewriting it as a false timeout.
      // A wait that outlasts either the attempt deadline or the shared header
      // budget leaves no time to send the replay. Report the provider failure
      // instead of announcing an attempt that never happens.
      if (retryDelayMs > 0) {
        if (
          retryDelayMs >= attemptTimeoutMs - (monotonicMilliseconds() - startedAt) ||
          retryDelayMs >= remainingBudgetMs
        ) {
          throw failure;
        }
      }
      // A caller that cancelled while the failed response was read gets no
      // replay: the wait rejects, or the next attempt's deadline is already
      // aborted. Announcing one would claim a request that is never sent.
      // The per-attempt deadline signal is not that test: a header timeout
      // aborts it and still replays on a fresh deadline, so ask the caller's
      // own signal.
      if (!options.init.signal?.aborted) {
        notifyProviderRequestRetry({
          providerLabel: options.providerLabel,
          ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
          reason: deadline.timedOut && !responseReceived ? "timeout" : String(failure.status),
          attempt: retryCount + 2,
          maxAttempts: MAX_PROVIDER_STREAM_RETRIES + 1,
          delayMs: retryDelayMs,
        });
      }
      if (retryDelayMs > 0) {
        try {
          await waitForProviderStreamRetry(retryDelayMs, deadline.deadlineSignal);
        } catch (waitError) {
          if (deadline.timedOut) throw failure;
          throw waitError;
        }
      }
      retryCount++;
      // Only replays are clamped. A budget already spent stops the loop rather
      // than issuing an attempt with no time to succeed in.
      attemptTimeoutMs = Math.min(
        headersTimeoutMs,
        totalHeadersBudgetMs - (monotonicMilliseconds() - requestStartedAt),
      );
      if (attemptTimeoutMs <= 0) throw failure;
    } finally {
      deadline.cancelTimeout();
      if (!streamOwnsDeadline) deadline.dispose();
    }
  }
}
