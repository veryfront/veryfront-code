import { CONFIG_INVALID, createError, toError } from "#veryfront/errors";
import {
  getVeryfrontCloudBootstrap,
  normalizeVeryfrontApiBaseUrl,
  resolveVeryfrontPublicApiBaseUrlFromHostEnv,
} from "#veryfront/platform/cloud/resolver.ts";
import {
  guardedOutboundFetch,
  OutboundRequestBlockedError,
} from "#veryfront/security/http/outbound-fetch.ts";
import {
  getCurrentVeryfrontCloudContext,
  markCurrentVeryfrontCloudBillingGroupUsed,
} from "./context.ts";
import {
  isSupportedMistralModelId,
  normalizeVeryfrontCloudProviderAlias,
  type VeryfrontCloudProviderId,
} from "./model-catalog.ts";
import {
  requireInferenceProviderCredential,
  requireProviderCredential,
} from "../runtime-loader/provider-request-init.ts";

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
const HeadersSet = NativeHeaders.prototype.set;
const RequestHeadersGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "headers")?.get;
const URLHashSet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hash")?.set;
const URLHostnameGet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hostname")?.get;
const URLOriginGet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "origin")?.get;
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

const GATEWAY_PATHS = new Map<VeryfrontCloudProviderId, string>([
  ["anthropic", "ai/gateway/anthropic/v1"],
  ["openai", "ai/gateway/openai/v1"],
  ["google", "ai/gateway/google/v1beta"],
  ["mistral", "ai/gateway/mistral/v1"],
  ["moonshotai", "ai/gateway/moonshotai/v1"],
]);

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

function requireSecureInferenceApiBaseUrl(value: string): void {
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
  if (readNativeURLString(url, URLProtocolGet) !== "https:" && !loopback) {
    throw CONFIG_INVALID.create({
      detail: "Run-scoped inference credentials require HTTPS or a loopback API base URL",
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
  const normalizedProvider = normalizeVeryfrontCloudProviderAlias(rawProvider);
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

export function getVeryfrontCloudGatewayBaseUrl(
  apiBaseUrl: string,
  provider: VeryfrontCloudProviderId,
): string {
  const gatewayPath = GATEWAY_PATHS.get(provider);
  if (!gatewayPath) {
    throw new TypeError(`Unsupported Veryfront Cloud provider "${String(provider)}"`);
  }
  return joinUrl(apiBaseUrl, gatewayPath);
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
export function createVeryfrontCloudFetch(
  apiToken: string,
  apiBaseUrl: string,
  projectSlug?: string,
  options?: {
    inferenceCredential?: boolean;
    assertInferenceCredentialActive?: () => void;
  },
): typeof fetch {
  const trustedApiToken = options?.inferenceCredential
    ? requireInferenceProviderCredential(apiToken, "Veryfront Cloud API token")
    : requireProviderCredential(apiToken, "Veryfront Cloud API token");
  const authorizedOrigin = readNativeURLString(
    parseVeryfrontCloudApiBaseUrl(apiBaseUrl),
    URLOriginGet,
  );
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

    const billingGroup = getCurrentVeryfrontCloudContext()?.billingGroupId;
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

    return guardedOutboundFetch(
      new NativeRequest(request, { headers }),
      { redirect: "error" },
      {
        authorizeUrl(url) {
          if (readNativeURLString(url, URLOriginGet) !== authorizedOrigin) {
            throw new OutboundRequestBlockedError(
              "Veryfront Cloud request blocked: destination origin is not authorized",
            );
          }
        },
      },
    );
  };
}
