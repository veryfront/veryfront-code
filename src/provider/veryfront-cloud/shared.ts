import { CONFIG_INVALID, createError, NOT_SUPPORTED, toError } from "#veryfront/errors";
import {
  getVeryfrontCloudBootstrap,
  normalizeVeryfrontApiBaseUrl,
  resolveVeryfrontInferenceApiBaseUrlFromHostEnv,
} from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import {
  createVeryfrontApiOriginBoundOutboundFetch,
  HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV,
  HOST_INTERNAL_EGRESS_OVERRIDE_ENV,
  isHostAllowedInternalProviderOrigin,
} from "#veryfront/security/http/outbound-fetch.ts";
import { isInternalEgressOverrideEnabled } from "#veryfront/security/sandbox/worker-egress-guard.ts";
import {
  assertNativeRequestProcessing,
  createNativeRequest,
  createNativeRequestInit,
  readOwnInitField,
} from "#veryfront/platform/compat/http/native-request-init.ts";
import {
  getCurrentVeryfrontCloudContext,
  getCurrentVeryfrontCloudModelCallCapture,
} from "./context.ts";
import {
  canVeryfrontCloudCatalogRefuse,
  createRetiredVeryfrontCloudModelError,
  isRetiredVeryfrontCloudModelId,
  isSupportedMistralModelId,
  resolveVeryfrontCloudProviderId,
  resolveVeryfrontCloudSurface,
  type VeryfrontCloudProviderId,
} from "./model-catalog.ts";
import { loadVeryfrontCloudCatalog } from "./catalog-client.ts";
import {
  requireInferenceProviderCredential,
  requireProviderCredential,
} from "../runtime-loader/provider-request-init.ts";
import {
  markVeryfrontGatewayResponse,
  markVeryfrontGatewayTransportFailure,
} from "../runtime-loader/provider-http.ts";

export type { VeryfrontCloudProviderId } from "./model-catalog.ts";

const IntrinsicReflectApply = Reflect.apply;
const NativeHeaders = Headers;
const NativeRequest = Request;
const NativeURL = URL;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeReplace = String.prototype.replace;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeTrim = String.prototype.trim;
const HeadersDelete = NativeHeaders.prototype.delete;
const HeadersGet = NativeHeaders.prototype.get;
const HeadersSet = NativeHeaders.prototype.set;
const JSONParse = JSON.parse;
const JSONStringify = JSON.stringify;
const MapPrototypeGet = Map.prototype.get;
const NativeResponse = Response;
const ObjectHasOwn = Object.hasOwn;
const PromisePrototypeThen = Promise.prototype.then;
const RequestMethodGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "method")?.get;
const RequestPrototypeText = NativeRequest.prototype.text;
const SetPrototypeHas = Set.prototype.has;
const ResponseHeadersGet = Object.getOwnPropertyDescriptor(Response.prototype, "headers")?.get;
const ResponsePrototypeClone = Response.prototype.clone;
const ResponseStatusGet = Object.getOwnPropertyDescriptor(Response.prototype, "status")?.get;
const ResponseStatusTextGet = Object.getOwnPropertyDescriptor(Response.prototype, "statusText")
  ?.get;
const StringPrototypeIncludes = String.prototype.includes;
/**
 * Gateway admission rejections that return before any usage is recorded. A 400
 * is included because the gateway rejects invalid requests, including the
 * project-required refusal, before admission; treating a rare upstream 400 as
 * unadmitted only risks demoting a finalize warning to debug.
 */
const GATEWAY_ADMISSION_REJECTION_STATUSES: ReadonlySet<number> = new Set([400, 401, 402, 403]);
const RequestHeadersGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "headers")?.get;
const URLHashSet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hash")?.set;
const URLHostnameGet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hostname")?.get;
const URLPasswordGet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "password")?.get;
const URLPathnameGet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "pathname")?.get;
const URLPathnameSet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "pathname")?.set;
const URLProtocolGet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "protocol")?.get;
const URLToString = NativeURL.prototype.toString;
const URLUsernameGet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "username")?.get;

interface ParsedVeryfrontCloudModelId {
  provider: VeryfrontCloudProviderId;
  modelId: string;
}

function readNativeURLString(
  url: URL,
  getter: ((this: URL) => string) | undefined,
): string {
  if (!getter) {
    throw CONFIG_INVALID.create({ detail: "Veryfront Cloud URL accessors are unavailable" });
  }
  return IntrinsicReflectApply(getter, url, []) as string;
}

function writeNativeURLString(
  url: URL,
  setter: ((this: URL, value: string) => void) | undefined,
  value: string,
): void {
  if (!setter) {
    throw CONFIG_INVALID.create({ detail: "Veryfront Cloud URL accessors are unavailable" });
  }
  IntrinsicReflectApply(setter, url, [value]);
}

function readNativeRequestHeaders(request: Request): Headers {
  if (!RequestHeadersGet) {
    throw CONFIG_INVALID.create({ detail: "Veryfront Cloud Request accessors are unavailable" });
  }
  return IntrinsicReflectApply(RequestHeadersGet, request, []) as Headers;
}

/**
 * `request` sent with `headers`, and `body` when given. The headers carry the
 * gateway bearer, so they reach the constructor as a null-prototype record in
 * a null-prototype init that has every field as its own property: a Headers
 * object would be read through a patchable `Symbol.iterator`, and an init
 * field looked up on `Object.prototype` would let a getter there read
 * `this.headers`.
 */
function withCredentialHeaders(request: Request, headers: Headers, body?: string): Request {
  // The constructor calls live prototype methods with the headers in reach.
  assertNativeRequestProcessing();
  return createNativeRequest(
    request,
    createNativeRequestInit(undefined, body === undefined ? { headers } : { headers, body }),
  );
}

function parseVeryfrontCloudApiBaseUrl(value: string): URL {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    IntrinsicReflectApply(StringPrototypeTrim, value, []) !== value
  ) {
    throw new TypeError(
      "Veryfront Cloud API base URL must be a non-empty valid HTTP(S) URL",
    );
  }

  let url: URL;
  try {
    url = new NativeURL(value);
  } catch {
    throw new TypeError("Veryfront Cloud API base URL must be a valid HTTP(S) URL");
  }
  const protocol = readNativeURLString(url, URLProtocolGet);
  if (protocol !== "http:" && protocol !== "https:") {
    throw new TypeError("Veryfront Cloud API base URL must use HTTP or HTTPS");
  }
  if (
    readNativeURLString(url, URLUsernameGet) ||
    readNativeURLString(url, URLPasswordGet)
  ) {
    throw new TypeError(
      "Veryfront Cloud API base URL must not contain embedded credentials",
    );
  }
  return url;
}

function stripIpv6HostnameBrackets(value: string): string {
  if (
    value.length >= 2 &&
    IntrinsicReflectApply(StringPrototypeCharCodeAt, value, [0]) === 91 &&
    IntrinsicReflectApply(StringPrototypeCharCodeAt, value, [value.length - 1]) === 93
  ) {
    return IntrinsicReflectApply(StringPrototypeSlice, value, [1, -1]) as string;
  }
  return value;
}

/** @internal Apply the host-owned inference credential transport policy. */
export function requireSecureInferenceApiBaseUrl(value: string): void {
  const url = parseVeryfrontCloudApiBaseUrl(value);
  const hostname = stripIpv6HostnameBrackets(
    IntrinsicReflectApply(
      StringPrototypeToLowerCase,
      readNativeURLString(url, URLHostnameGet),
      [],
    ) as string,
  );
  // 0.0.0.0 binds all interfaces and is intentionally not an HTTP exception.
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  // Same allowlist -- and the same host-wide override -- the outbound fetch
  // layer consults, so bootstrap validation and the actual request can never
  // disagree about which internal origin is trusted.
  if (
    readNativeURLString(url, URLProtocolGet) !== "https:" && !loopback &&
    !isHostAllowedInternalProviderOrigin(url) &&
    !isInternalEgressOverrideEnabled(getHostEnv(HOST_INTERNAL_EGRESS_OVERRIDE_ENV))
  ) {
    throw CONFIG_INVALID.create({
      detail:
        `Run-scoped inference credentials require HTTPS, a loopback, or a ${HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV}-allowed API base URL`,
    });
  }
}

function joinUrl(base: string, path: string): string {
  const url = parseVeryfrontCloudApiBaseUrl(base);
  const pathname = IntrinsicReflectApply(
    StringPrototypeReplace,
    readNativeURLString(url, URLPathnameGet),
    [/\/+$/, ""],
  ) as string;
  const normalizedPath = IntrinsicReflectApply(StringPrototypeReplace, path, [
    /^\/+/,
    "",
  ]) as string;
  writeNativeURLString(url, URLPathnameSet, `${pathname}/${normalizedPath}`);
  writeNativeURLString(url, URLHashSet, "");
  return IntrinsicReflectApply(URLToString, url, []) as string;
}

function createInvalidModelIdError(modelId: string): Error {
  return toError(
    createError({
      type: "config",
      message: `Invalid veryfront-cloud model string: "${modelId}". Expected ` +
        `"veryfront-cloud/provider/model".`,
    }),
  );
}

export function parseVeryfrontCloudModelId(
  modelId: string,
  kind: "language" | "embedding",
  options: {
    /**
     * Also refuse a model the catalog in effect does not list (the Mistral
     * check). A model built before its catalog loaded passes `false` and runs
     * the check once the catalog for its own credentials is known.
     */
    catalogChecks?: boolean;
  } = {},
): ParsedVeryfrontCloudModelId {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) {
    throw createInvalidModelIdError(modelId);
  }

  const rawProvider = modelId.slice(0, slashIndex);
  const normalizedProvider = resolveVeryfrontCloudProviderId(rawProvider);
  const upstreamModelId = modelId.slice(slashIndex + 1);

  if (
    !normalizedProvider || !upstreamModelId ||
    IntrinsicReflectApply(StringPrototypeTrim, upstreamModelId, []) !== upstreamModelId
  ) {
    throw createInvalidModelIdError(modelId);
  }

  if (
    kind === "embedding" && normalizedProvider !== "openai" &&
    normalizedProvider !== "google"
  ) {
    throw toError(
      createError({
        type: "config",
        message: `Embedding provider "${rawProvider}" is not supported for veryfront-cloud. ` +
          `Supported providers: openai, google.`,
      }),
    );
  }

  if (kind === "language" && options.catalogChecks !== false) {
    assertVeryfrontCloudModelListed(normalizedProvider, upstreamModelId);
  }

  if (kind === "language" && isRetiredVeryfrontCloudModelId(modelId)) {
    throw createRetiredVeryfrontCloudModelError(modelId);
  }

  return {
    provider: normalizedProvider,
    modelId: upstreamModelId,
  };
}

/**
 * Refuse a Mistral model a fresh served catalog does not list, so a caller gets
 * a clear error rather than a gateway-side failure. Without one, nothing is
 * refused and the gateway answers for the model.
 */
export function assertVeryfrontCloudModelListed(provider: string, upstreamModelId: string): void {
  if (
    provider === "mistral" && canVeryfrontCloudCatalogRefuse() &&
    !isSupportedMistralModelId(`mistral/${upstreamModelId}`)
  ) {
    throw toError(
      createError({
        type: "config",
        message: `Unsupported Mistral model "mistral/${upstreamModelId}"`,
      }),
    );
  }
}

export function requireVeryfrontCloudBootstrap(
  apiTokenOverride?: string,
  inferenceApiBaseUrlOverride?: string,
): {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug?: string;
} {
  const bootstrap = getVeryfrontCloudBootstrap();
  const normalizedInferenceApiBaseUrlOverride = inferenceApiBaseUrlOverride === undefined
    ? undefined
    : normalizeVeryfrontApiBaseUrl(inferenceApiBaseUrlOverride) ?? inferenceApiBaseUrlOverride;
  // A run-scoped credential never takes its destination from the cloud
  // context: project code in the same process can forge that context.
  const apiBaseUrl = apiTokenOverride
    ? normalizedInferenceApiBaseUrlOverride ?? resolveVeryfrontInferenceApiBaseUrlFromHostEnv()
    : bootstrap.apiBaseUrl;

  if (apiTokenOverride) {
    requireSecureInferenceApiBaseUrl(apiBaseUrl);
  }

  const apiToken = apiTokenOverride ?? bootstrap.apiToken;
  if (!apiToken) {
    throw toError(
      createError({
        type: "config",
        message:
          "VERYFRONT_API_TOKEN not set. Set the environment variable or provide request-scoped " +
          "Veryfront credentials before using veryfront-cloud providers.",
      }),
    );
  }

  return {
    apiBaseUrl,
    apiToken,
    projectSlug: bootstrap.projectSlug,
  };
}

/**
 * Load the model catalog Veryfront Cloud serves, with the Veryfront Cloud
 * credentials and project in effect, so model facts read synchronously
 * afterward (thinking defaults, short aliases such as `opus`, the default
 * model) come from it. Resolves to whether a catalog is available. Never
 * throws. When a refresh fails, the last catalog loaded for these credentials
 * stays in use. While none has loaded (no credentials, or no load has
 * succeeded yet), reads use protocol defaults only:
 * `resolveVeryfrontCloudModelId()` resolves no short alias and no model has a
 * thinking default.
 */
export async function loadVeryfrontCloudModelCatalog(
  options: { signal?: AbortSignal; maxWaitMs?: number } = {},
): Promise<boolean> {
  let bootstrap: ReturnType<typeof requireVeryfrontCloudBootstrap>;
  try {
    bootstrap = requireVeryfrontCloudBootstrap();
  } catch {
    return false;
  }
  const catalog = await loadVeryfrontCloudCatalog({
    fresh: true,
    apiBaseUrl: bootstrap.apiBaseUrl,
    apiToken: bootstrap.apiToken,
    ...(bootstrap.projectSlug ? { projectSlug: bootstrap.projectSlug } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
  });
  return catalog !== undefined;
}

/**
 * Vendor-neutral gateway paths, keyed by the wire protocol a model speaks
 * (`resolveVeryfrontCloudSurface`). A protocol with no entry has no route
 * this package can send to.
 */
const NEUTRAL_GATEWAY_PATHS_BY_PROTOCOL: ReadonlyMap<string, string> = new Map([
  ["openai", "ai/v1"],
  ["anthropic", "ai/v1"],
  ["google", "ai/v1beta"],
]);

/**
 * Protocols whose requests name the model in the URL
 * (`models/{model}:{method}`), not in the body. The builder's bare model id is
 * already what the neutral route accepts, so the body is sent unchanged.
 */
const PATH_ADDRESSED_PROTOCOLS: ReadonlySet<string> = new Set(["google"]);

/** Where a Veryfront Cloud model's requests go, and how the body names the model. */
export interface VeryfrontCloudGatewayRoute {
  /** Base URL the request builder appends its operation path to. */
  baseURL: string;
  /**
   * Always set: every route is vendor-neutral, and its Veryfront refusals
   * arrive in the protocol's native error envelope and are read back in the
   * vendor-route shape.
   */
  neutral: true;
  /**
   * Set on a route whose body names the model: the body's `model` is sent as
   * `<provider>/<model>`, because one neutral path serves many providers.
   * Unset on a route that names the model in its URL (Google).
   */
  wireModelProvider?: VeryfrontCloudProviderId;
}

/**
 * Gateway route for a provider. OpenAI- and Anthropic-protocol providers both
 * use `<api>/ai/v1` (`/chat/completions`, `/responses` or `/messages`), and Google uses
 * `<api>/ai/v1beta`.
 *
 * Throws for a provider no route can address: an unknown provider id, a
 * protocol this package builds no requests for, or a provider other than
 * Google on the Google protocol, whose route names only the model.
 */
export function resolveVeryfrontCloudGatewayRoute(
  apiBaseUrl: string,
  provider: VeryfrontCloudProviderId,
): VeryfrontCloudGatewayRoute {
  const providerId = resolveVeryfrontCloudProviderId(provider);
  if (!providerId) {
    throw new TypeError(`Unsupported Veryfront Cloud provider "${String(provider)}"`);
  }
  const protocol = resolveVeryfrontCloudSurface(providerId);
  const neutralPath = IntrinsicReflectApply(MapPrototypeGet, NEUTRAL_GATEWAY_PATHS_BY_PROTOCOL, [
    protocol,
  ]) as string | undefined;
  if (neutralPath === undefined) {
    throw NOT_SUPPORTED.create({
      detail: `Veryfront Cloud wire surface "${protocol}" is not supported by this package version`,
    });
  }
  const pathAddressed = IntrinsicReflectApply(SetPrototypeHas, PATH_ADDRESSED_PROTOCOLS, [
    protocol,
  ]);
  if (!pathAddressed) {
    return {
      baseURL: joinUrl(apiBaseUrl, neutralPath),
      neutral: true,
      wireModelProvider: providerId,
    };
  }
  // A path-addressed route names only the model, so a provider other than the
  // protocol's own would be indistinguishable there from another provider with
  // the same upstream id.
  if (providerId !== protocol) {
    throw NOT_SUPPORTED.create({
      detail:
        `Veryfront Cloud provider "${providerId}" speaks the ${protocol} protocol, whose gateway route addresses only ${protocol} models; this package version cannot send requests for it`,
    });
  }
  return { baseURL: joinUrl(apiBaseUrl, neutralPath), neutral: true };
}

export function getVeryfrontCloudGatewayBaseUrl(
  apiBaseUrl: string,
  provider: VeryfrontCloudProviderId,
): string {
  return resolveVeryfrontCloudGatewayRoute(apiBaseUrl, provider).baseURL;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwn(record: Record<string, unknown>, key: string): unknown {
  return IntrinsicReflectApply(ObjectHasOwn, undefined, [record, key]) ? record[key] : undefined;
}

/**
 * The body with its JSON `model` sent as `<provider>/<model>`, or undefined
 * when the body is not a JSON object with a string `model` and goes unchanged.
 */
function toWireModelBody(text: string, provider: string): string | undefined {
  let body: unknown;
  try {
    body = JSONParse(text);
  } catch {
    return undefined;
  }
  if (!isJsonRecord(body)) return undefined;
  const model = readOwn(body, "model");
  if (typeof model !== "string") return undefined;
  body.model = `${provider}/${model}`;
  return JSONStringify(body) as string;
}

function toNeutralRouteRequest(
  request: Request,
  headers: Headers,
  text: string,
  provider: string,
): Request {
  // The headers hold the bearer. Reading the body awaited, and rewriting it
  // runs JSON.stringify, which calls any toJSON project code installed: check
  // after both, right before the headers change.
  const wireBody = toWireModelBody(text, provider);
  assertNativeRequestProcessing();
  if (wireBody === undefined) {
    return withCredentialHeaders(request, headers, text);
  }
  // The body length changes, so any length the builder set no longer holds.
  IntrinsicReflectApply(HeadersDelete, headers, ["content-length"]);
  return withCredentialHeaders(request, headers, wireBody);
}

/**
 * Send a request on a vendor-neutral route: the body's `model` becomes
 * `<provider>/<model>` when the route names one, and a Veryfront refusal is
 * read back in the vendor route's shape. A string body, which every request
 * builder sends, is rewritten before the send starts, so the request leaves as
 * promptly as on a vendor-scoped route; any other body is read first. A route
 * that names the model in its URL sends the body unchanged.
 */
function sendOnNeutralRoute(
  apiBaseUrl: string,
  request: Request,
  headers: Headers,
  wireModelProvider: string | undefined,
  initBody: unknown,
  onBuilt: (outbound: Request) => Request,
): Promise<Response> {
  const send = (outbound: Request): Promise<Response> =>
    IntrinsicReflectApply(
      PromisePrototypeThen,
      createVeryfrontApiOriginBoundOutboundFetch(
        apiBaseUrl,
      )(onBuilt(outbound)),
      [normalizeNeutralGatewayRefusal],
    ) as Promise<Response>;

  // Without the captured getter, read the request's own method rather than
  // assume one: a GET or HEAD must never get a rewritten body.
  const method = RequestMethodGet
    ? IntrinsicReflectApply(RequestMethodGet, request, []) as string
    : request.method;
  if (method === "GET" || method === "HEAD" || wireModelProvider === undefined) {
    return send(withCredentialHeaders(request, headers));
  }
  if (typeof initBody === "string") {
    return send(toNeutralRouteRequest(request, headers, initBody, wireModelProvider));
  }
  return IntrinsicReflectApply(
    PromisePrototypeThen,
    IntrinsicReflectApply(RequestPrototypeText, request, []) as Promise<string>,
    [(text: string) => send(toNeutralRouteRequest(request, headers, text, wireModelProvider))],
  ) as Promise<Response>;
}

/**
 * Neutral refusal code -> the vendor-route problem body field names, so every
 * existing refusal classifier reads a neutral refusal the way it reads the
 * vendor route's. `slug` refusals carry their amounts under unit-explicit names
 * on the neutral surfaces; the vendor route names them `balance`/`required`.
 */
const NEUTRAL_REFUSAL_SHAPES: ReadonlyMap<
  string,
  { field: "code" | "slug"; value: string; renames?: ReadonlyMap<string, string> }
> = new Map([
  ["gateway_project_required", { field: "code", value: "gateway_project_required" }],
  ["eu_inference_policy", { field: "code", value: "eu_inference_policy" }],
  ["resource-limit-exceeded", { field: "slug", value: "resource-limit-exceeded" }],
  ["insufficient-credits", {
    field: "slug",
    value: "insufficient-credits",
    renames: new Map([["balance_credits", "balance"], ["required_credits", "required"]]),
  }],
  ["agent-run-credit-limit", {
    field: "slug",
    value: "insufficient-credits",
    renames: new Map([["remaining_run_credits", "balance"], ["required_credits", "required"]]),
  }],
  ["provider-spend-limit", {
    field: "slug",
    value: "insufficient-credits",
    renames: new Map([["remaining_usd", "balance"], ["required_usd", "required"]]),
  }],
  ["ai-budget-exceeded", {
    field: "slug",
    value: "ai-budget-exceeded",
    renames: new Map([
      ["balance_credits", "balance"],
      ["required_credits", "required"],
      ["limit_credits", "limit"],
      ["used_credits", "used"],
    ]),
  }],
]);

/** `ErrorInfo.domain` the Google neutral surface names on a Veryfront refusal. */
const GOOGLE_REFUSAL_DOMAIN = "veryfront.com";
const GOOGLE_ERROR_INFO_TYPE = "type.googleapis.com/google.rpc.ErrorInfo";

/**
 * The refusal code of a Google `google.rpc.Status` error: the `reason` of its
 * Veryfront `ErrorInfo` detail. Google's own errors carry `ErrorInfo` details
 * under Google's domains, which never match.
 */
function readGoogleRefusalCode(error: Record<string, unknown>): string | undefined {
  const details = readOwn(error, "details");
  if (!Array.isArray(details)) return undefined;
  for (const detail of details) {
    if (
      isJsonRecord(detail) &&
      readOwn(detail, "@type") === GOOGLE_ERROR_INFO_TYPE &&
      readOwn(detail, "domain") === GOOGLE_REFUSAL_DOMAIN
    ) {
      const reason = readOwn(detail, "reason");
      return typeof reason === "string" ? reason : undefined;
    }
  }
  return undefined;
}

/**
 * The vendor-route problem body for a Veryfront refusal a neutral surface sent
 * in its native envelope (`{error: {code, message, veryfront}}`, Anthropic's
 * wrapped in `{type: "error"}`, Google's a `google.rpc.Status` whose code is a
 * Veryfront `ErrorInfo` reason), or undefined for any other body, including
 * every upstream provider error, which is left exactly as it arrived.
 */
function toVendorRouteRefusal(body: unknown): Record<string, unknown> | undefined {
  if (!isJsonRecord(body)) return undefined;
  const error = readOwn(body, "error");
  if (!isJsonRecord(error)) return undefined;
  const envelopeCode = readOwn(error, "code");
  const code = typeof envelopeCode === "string" ? envelopeCode : readGoogleRefusalCode(error);
  if (code === undefined) return undefined;
  const shape = IntrinsicReflectApply(MapPrototypeGet, NEUTRAL_REFUSAL_SHAPES, [code]) as
    | { field: "code" | "slug"; value: string; renames?: ReadonlyMap<string, string> }
    | undefined;
  if (!shape) return undefined;

  const message = readOwn(error, "message");
  const refusal: Record<string, unknown> = {
    ...(typeof message === "string" ? { error: message } : {}),
  };
  const detail = readOwn(error, "veryfront");
  if (isJsonRecord(detail)) {
    for (const key of Object.keys(detail)) {
      const renamed = shape.renames
        ? IntrinsicReflectApply(MapPrototypeGet, shape.renames, [key]) as string | undefined
        : undefined;
      refusal[renamed ?? key] = detail[key];
    }
  }
  refusal[shape.field] = shape.value;
  return refusal;
}

/** Largest neutral error body inspected for a Veryfront refusal. */
const NEUTRAL_REFUSAL_MAX_BYTES = 8 * 1024;

/**
 * Give a Veryfront refusal from a neutral surface the vendor route's body, so
 * credit, project and policy refusals classify exactly as before the move.
 * Successes, non-JSON bodies and upstream provider errors pass through untouched.
 */
async function normalizeNeutralGatewayRefusal(response: Response): Promise<Response> {
  if (!ResponseStatusGet || !ResponseHeadersGet) return response;
  const status = IntrinsicReflectApply(ResponseStatusGet, response, []) as number;
  if (status < 400) return response;
  const responseHeaders = IntrinsicReflectApply(ResponseHeadersGet, response, []) as Headers;
  const contentType = IntrinsicReflectApply(HeadersGet, responseHeaders, ["content-type"]) as
    | string
    | null;
  if (
    contentType === null ||
    !IntrinsicReflectApply(StringPrototypeIncludes, contentType, ["json"])
  ) {
    return response;
  }

  let refusal: Record<string, unknown> | undefined;
  try {
    // A Veryfront refusal is small. Read a bounded prefix of a copy and cancel
    // the rest, so a large upstream error is never buffered here; anything that
    // does not fit is not a refusal and passes through untouched.
    const copy = IntrinsicReflectApply(ResponsePrototypeClone, response, []) as Response;
    const { text, truncated } = await readResponseTextPrefix(copy, NEUTRAL_REFUSAL_MAX_BYTES);
    if (truncated) return response;
    refusal = toVendorRouteRefusal(JSONParse(text));
  } catch {
    return response;
  }
  if (!refusal) return response;

  const headers = new NativeHeaders(responseHeaders);
  IntrinsicReflectApply(HeadersDelete, headers, ["content-length"]);
  IntrinsicReflectApply(HeadersSet, headers, ["content-type", "application/json"]);
  return new NativeResponse(JSONStringify(refusal) as string, {
    status,
    statusText: ResponseStatusTextGet
      ? IntrinsicReflectApply(ResponseStatusTextGet, response, []) as string
      : "",
    headers,
  });
}

/**
 * Creates a fetch wrapper that replaces all SDK-injected auth headers with
 * a single `Authorization: Bearer` header for the Veryfront Cloud gateway.
 *
 * Provider runtimes set their own native auth headers (`x-api-key` for
 * Anthropic, `x-goog-api-key` for Google, `Authorization` for OpenAI).
 * The gateway expects only Bearer auth, so we strip all provider-specific
 * headers to prevent credential leakage to the wrong auth path.
 */
/** Keep gateway provenance on a transport that threw before any response. */
function rethrowAsGatewayTransportFailure(error: unknown): never {
  markVeryfrontGatewayTransportFailure(error);
  throw error;
}

export function createVeryfrontCloudFetch(
  apiToken: string,
  apiBaseUrl: string,
  projectSlug?: string,
  options?: {
    inferenceCredential?: boolean;
    assertInferenceCredentialActive?: () => void;
    /**
     * The route's {@link VeryfrontCloudGatewayRoute.wireModelProvider}. When
     * set, the body's `model` is sent as `<provider>/<model>` and a Veryfront
     * refusal in the neutral envelope is read back in the vendor-route shape.
     */
    wireModelProvider?: string;
    /**
     * The route's {@link VeryfrontCloudGatewayRoute.neutral}: a Veryfront
     * refusal in the neutral envelope is read back in the vendor-route shape.
     * Implied by `wireModelProvider`.
     */
    neutralRoute?: boolean;
  },
): typeof fetch {
  const trustedApiToken = options?.inferenceCredential
    ? requireInferenceProviderCredential(apiToken, "Veryfront Cloud API token")
    : requireProviderCredential(apiToken, "Veryfront Cloud API token");
  // Validate the shape eagerly so a malformed apiBaseUrl fails at construction, not on first use.
  parseVeryfrontCloudApiBaseUrl(apiBaseUrl);
  return (input, init) => {
    options?.assertInferenceCredentialActive?.();
    const request = new NativeRequest(input, init);
    const headers = new NativeHeaders(readNativeRequestHeaders(request));

    IntrinsicReflectApply(HeadersDelete, headers, ["x-api-key"]);
    IntrinsicReflectApply(HeadersDelete, headers, ["x-goog-api-key"]);
    IntrinsicReflectApply(HeadersDelete, headers, ["x-veryfront-project-slug"]);
    IntrinsicReflectApply(HeadersDelete, headers, ["x-veryfront-billing-group-id"]);
    IntrinsicReflectApply(HeadersDelete, headers, ["x-veryfront-model-call-id"]);
    IntrinsicReflectApply(HeadersDelete, headers, ["x-veryfront-model-call-capture-event-id"]);

    // Everything that can reach project code (the cloud context store, the
    // caller's init) is read before the bearer joins the headers, so nothing
    // can replace an array intrinsic between the check below and the send.
    const modelCallCapture = getCurrentVeryfrontCloudModelCallCapture();
    const cloudContext = getCurrentVeryfrontCloudContext();
    const billingGroup = cloudContext?.billingGroupId;
    const billingGroupId = billingGroup === undefined
      ? undefined
      : IntrinsicReflectApply(StringPrototypeTrim, billingGroup, []) as string;
    const initBody = readOwnInitField(init, "body");
    // Consults the internal-provider-origin allowlist and the operator-configured Veryfront API
    // origin; resolved per call since it snapshots the host transport eagerly.
    const wireModelProvider = options?.wireModelProvider;
    const neutralRoute = options?.neutralRoute;

    // Setting the bearer pushes it onto the header list's internal array.
    assertNativeRequestProcessing();
    IntrinsicReflectApply(HeadersSet, headers, ["Authorization", `Bearer ${trustedApiToken}`]);
    if (projectSlug) {
      IntrinsicReflectApply(HeadersSet, headers, ["x-veryfront-project-slug", projectSlug]);
    }
    if (modelCallCapture) {
      IntrinsicReflectApply(HeadersSet, headers, [
        "x-veryfront-model-call-id",
        modelCallCapture.modelCallId,
      ]);
      IntrinsicReflectApply(HeadersSet, headers, [
        "x-veryfront-model-call-capture-event-id",
        modelCallCapture.eventId,
      ]);
    }
    if (billingGroupId) {
      IntrinsicReflectApply(HeadersSet, headers, [
        "x-veryfront-billing-group-id",
        billingGroupId,
      ]);
    }

    // The billing group counts as used only once the outbound request is
    // built, past every refusal check: a refused call sends nothing, and an
    // eval must not finalize a group no request reached.
    // Marked on the context read before the bearer joined the headers, not
    // through another live store lookup that project code could hook.
    const built = (outbound: Request): Request => {
      if (billingGroupId && cloudContext) cloudContext.billingGroupUsed = true;
      return outbound;
    };
    const responsePromise = IntrinsicReflectApply(
      PromisePrototypeThen,
      wireModelProvider || neutralRoute
        ? sendOnNeutralRoute(apiBaseUrl, request, headers, wireModelProvider, initBody, built)
        : createVeryfrontApiOriginBoundOutboundFetch(apiBaseUrl)(
          built(withCredentialHeaders(request, headers)),
        ),
      [markVeryfrontGatewayResponse, rethrowAsGatewayTransportFailure],
    ) as Promise<Response>;
    if (!billingGroupId || !cloudContext || !ResponseStatusGet) return responsePromise;
    return IntrinsicReflectApply(PromisePrototypeThen, responsePromise, [
      (response: Response) => {
        const status = IntrinsicReflectApply(ResponseStatusGet, response, []) as number;
        if (!GATEWAY_ADMISSION_REJECTION_STATUSES.has(status)) {
          cloudContext.billingGroupRequestAdmitted = true;
        }
        return response;
      },
    ]) as Promise<Response>;
  };
}
