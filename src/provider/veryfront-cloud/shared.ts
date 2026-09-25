import { CONFIG_INVALID, createError, toError } from "#veryfront/errors";
import {
  getVeryfrontCloudBootstrap,
  normalizeVeryfrontApiBaseUrl,
  resolveVeryfrontPublicApiBaseUrlFromHostEnv,
} from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  createVeryfrontApiOriginBoundOutboundFetch,
  HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV,
  HOST_INTERNAL_EGRESS_OVERRIDE_ENV,
  isHostAllowedInternalProviderOrigin,
} from "#veryfront/security/http/outbound-fetch.ts";
import { isInternalEgressOverrideEnabled } from "#veryfront/security/sandbox/worker-egress-guard.ts";
import {
  getCurrentVeryfrontCloudContext,
  markCurrentVeryfrontCloudBillingGroupUsed,
} from "./context.ts";
import {
  isSupportedMistralModelId,
  resolveVeryfrontCloudGatewayPath,
  resolveVeryfrontCloudProviderId,
  resolveVeryfrontCloudSurface,
  type VeryfrontCloudProviderId,
} from "./model-catalog.ts";
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
const ResponseHeadersGet = Object.getOwnPropertyDescriptor(Response.prototype, "headers")?.get;
const ResponsePrototypeClone = Response.prototype.clone;
const ResponsePrototypeText = Response.prototype.text;
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

  if (
    kind === "language" && normalizedProvider === "mistral" &&
    !isSupportedMistralModelId(`mistral/${upstreamModelId}`)
  ) {
    throw toError(
      createError({
        type: "config",
        message: `Unsupported Mistral model "mistral/${upstreamModelId}"`,
      }),
    );
  }

  return {
    provider: normalizedProvider,
    modelId: upstreamModelId,
  };
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
  const apiBaseUrl = apiTokenOverride
    ? normalizedInferenceApiBaseUrlOverride ?? resolveVeryfrontPublicApiBaseUrlFromHostEnv() ??
      bootstrap.apiBaseUrl
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
 * Host environment variable that restores the vendor-scoped gateway routes.
 *
 * Temporary: it exists for one release so a deployment can move back to the
 * previous request URLs and bodies while it migrates, and is then removed.
 * Only the value `vendor` changes anything.
 */
export const VERYFRONT_CLOUD_GATEWAY_ROUTES_ENV = "VERYFRONT_CLOUD_GATEWAY_ROUTES";

/**
 * Vendor-neutral gateway paths, keyed by the wire protocol a model speaks
 * (`resolveVeryfrontCloudSurface`). A protocol with no entry (Google) keeps its
 * vendor-scoped path.
 */
const NEUTRAL_GATEWAY_PATHS_BY_PROTOCOL: ReadonlyMap<string, string> = new Map([
  ["openai", "ai/v1"],
  ["anthropic", "ai/anthropic/v1"],
]);

/** Where a Veryfront Cloud model's requests go, and how the body names the model. */
export interface VeryfrontCloudGatewayRoute {
  /** Base URL the request builder appends its operation path to. */
  baseURL: string;
  /**
   * Set on a vendor-neutral route: the body's `model` is sent as
   * `<provider>/<model>`, because one neutral path serves many providers.
   * Unset on a vendor-scoped route, whose path already names the provider.
   */
  wireModelProvider?: VeryfrontCloudProviderId;
}

function usesVendorGatewayRoutes(): boolean {
  const value = getHostEnv(VERYFRONT_CLOUD_GATEWAY_ROUTES_ENV);
  if (value === undefined) return false;
  const normalized = IntrinsicReflectApply(
    StringPrototypeToLowerCase,
    IntrinsicReflectApply(StringPrototypeTrim, value, []),
    [],
  );
  return normalized === "vendor";
}

function getVeryfrontCloudVendorGatewayBaseUrl(
  apiBaseUrl: string,
  provider: VeryfrontCloudProviderId,
): string {
  const gatewayPath = resolveVeryfrontCloudGatewayPath(provider);
  if (!gatewayPath) {
    throw new TypeError(`Unsupported Veryfront Cloud provider "${String(provider)}"`);
  }
  return joinUrl(apiBaseUrl, gatewayPath);
}

/**
 * Gateway route for a provider. OpenAI-protocol providers use `<api>/ai/v1`,
 * Anthropic-protocol providers use `<api>/ai/anthropic/v1`, and Google keeps
 * its vendor-scoped path. {@link VERYFRONT_CLOUD_GATEWAY_ROUTES_ENV} set to
 * `vendor` restores the vendor-scoped path for every provider.
 */
export function resolveVeryfrontCloudGatewayRoute(
  apiBaseUrl: string,
  provider: VeryfrontCloudProviderId,
): VeryfrontCloudGatewayRoute {
  const providerId = resolveVeryfrontCloudProviderId(provider);
  if (providerId && !usesVendorGatewayRoutes()) {
    const neutralPath = IntrinsicReflectApply(MapPrototypeGet, NEUTRAL_GATEWAY_PATHS_BY_PROTOCOL, [
      resolveVeryfrontCloudSurface(providerId),
    ]) as string | undefined;
    if (neutralPath) {
      return { baseURL: joinUrl(apiBaseUrl, neutralPath), wireModelProvider: providerId };
    }
  }
  return { baseURL: getVeryfrontCloudVendorGatewayBaseUrl(apiBaseUrl, provider) };
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
  const wireBody = toWireModelBody(text, provider);
  if (wireBody === undefined) return new NativeRequest(request, { headers, body: text });
  // The body length changes, so any length the builder set no longer holds.
  IntrinsicReflectApply(HeadersDelete, headers, ["content-length"]);
  return new NativeRequest(request, { headers, body: wireBody });
}

/**
 * Send a request on a vendor-neutral route: the body's `model` becomes
 * `<provider>/<model>`, and a Veryfront refusal is read back in the vendor
 * route's shape. A string body, which every request builder sends, is
 * rewritten before the send starts, so the request leaves as promptly as on a
 * vendor-scoped route; any other body is read first.
 */
function sendOnNeutralRoute(
  apiBaseUrl: string,
  request: Request,
  headers: Headers,
  wireModelProvider: string,
  initBody: unknown,
): Promise<Response> {
  const send = (outbound: Request): Promise<Response> =>
    IntrinsicReflectApply(
      PromisePrototypeThen,
      createVeryfrontApiOriginBoundOutboundFetch(
        apiBaseUrl,
      )(outbound),
      [normalizeNeutralGatewayRefusal],
    ) as Promise<Response>;

  // Without the captured getter, read the request's own method rather than
  // assume one: a GET or HEAD must never get a rewritten body.
  const method = RequestMethodGet
    ? IntrinsicReflectApply(RequestMethodGet, request, []) as string
    : request.method;
  if (method === "GET" || method === "HEAD") return send(new NativeRequest(request, { headers }));
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

/**
 * The vendor-route problem body for a Veryfront refusal a neutral surface sent
 * in its native envelope (`{error: {code, message, veryfront}}`, Anthropic's
 * wrapped in `{type: "error"}`), or undefined for any other body, including
 * every upstream provider error, which is left exactly as it arrived.
 */
function toVendorRouteRefusal(body: unknown): Record<string, unknown> | undefined {
  if (!isJsonRecord(body)) return undefined;
  const error = readOwn(body, "error");
  if (!isJsonRecord(error)) return undefined;
  const code = readOwn(error, "code");
  if (typeof code !== "string") return undefined;
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
    const copy = IntrinsicReflectApply(ResponsePrototypeClone, response, []) as Response;
    const text = await (IntrinsicReflectApply(ResponsePrototypeText, copy, []) as Promise<string>);
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
    IntrinsicReflectApply(HeadersSet, headers, ["Authorization", `Bearer ${trustedApiToken}`]);

    if (projectSlug) {
      IntrinsicReflectApply(HeadersSet, headers, ["x-veryfront-project-slug", projectSlug]);
    }

    const cloudContext = getCurrentVeryfrontCloudContext();
    const billingGroup = cloudContext?.billingGroupId;
    const billingGroupId = billingGroup === undefined
      ? undefined
      : IntrinsicReflectApply(StringPrototypeTrim, billingGroup, []) as string;
    if (billingGroupId) {
      IntrinsicReflectApply(HeadersSet, headers, [
        "x-veryfront-billing-group-id",
        billingGroupId,
      ]);
      markCurrentVeryfrontCloudBillingGroupUsed();
    }

    // Consults the internal-provider-origin allowlist and the operator-configured Veryfront API
    // origin; resolved per call since it snapshots the host transport eagerly.
    const wireModelProvider = options?.wireModelProvider;
    const responsePromise = IntrinsicReflectApply(
      PromisePrototypeThen,
      wireModelProvider
        ? sendOnNeutralRoute(apiBaseUrl, request, headers, wireModelProvider, init?.body)
        : createVeryfrontApiOriginBoundOutboundFetch(apiBaseUrl)(
          new NativeRequest(request, { headers }),
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
