import { CONFIG_INVALID, createError, toError } from "#veryfront/errors";
import { getVeryfrontCloudBootstrap } from "#veryfront/platform/cloud/resolver.ts";
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

function parseVeryfrontCloudApiBaseUrl(value: string): URL {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(
      "Veryfront Cloud API base URL must be a non-empty valid HTTP(S) URL",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Veryfront Cloud API base URL must be a valid HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Veryfront Cloud API base URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new TypeError(
      "Veryfront Cloud API base URL must not contain embedded credentials",
    );
  }
  return url;
}

function requireSecureInferenceApiBaseUrl(value: string): void {
  const url = parseVeryfrontCloudApiBaseUrl(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !loopback) {
    throw CONFIG_INVALID.create({
      detail: "Run-scoped inference credentials require HTTPS or a loopback API base URL",
    });
  }
}

function joinUrl(base: string, path: string): string {
  const url = parseVeryfrontCloudApiBaseUrl(base);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  url.hash = "";
  return url.toString();
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
    upstreamModelId.trim() !== upstreamModelId
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

export function requireVeryfrontCloudBootstrap(apiTokenOverride?: string): {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug?: string;
} {
  const bootstrap = getVeryfrontCloudBootstrap();

  if (apiTokenOverride) {
    requireSecureInferenceApiBaseUrl(bootstrap.apiBaseUrl);
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
    apiBaseUrl: bootstrap.apiBaseUrl,
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
  options?: { inferenceCredential?: boolean },
): typeof fetch {
  const trustedApiToken = options?.inferenceCredential
    ? requireInferenceProviderCredential(apiToken, "Veryfront Cloud API token")
    : requireProviderCredential(apiToken, "Veryfront Cloud API token");
  const authorizedOrigin = parseVeryfrontCloudApiBaseUrl(apiBaseUrl).origin;
  return (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);

    headers.delete("x-api-key");
    headers.delete("x-goog-api-key");
    headers.delete("x-veryfront-project-slug");
    headers.delete("x-veryfront-billing-group-id");
    headers.set("Authorization", `Bearer ${trustedApiToken}`);

    if (projectSlug) {
      headers.set("x-veryfront-project-slug", projectSlug);
    }

    const billingGroupId = getCurrentVeryfrontCloudContext()?.billingGroupId?.trim();
    if (billingGroupId) {
      headers.set("x-veryfront-billing-group-id", billingGroupId);
      markCurrentVeryfrontCloudBillingGroupUsed();
    }

    return guardedOutboundFetch(
      new Request(request, { headers }),
      { redirect: "error" },
      {
        authorizeUrl(url) {
          if (url.origin !== authorizedOrigin) {
            throw new OutboundRequestBlockedError(
              "Veryfront Cloud request blocked: destination origin is not authorized",
            );
          }
        },
      },
    );
  };
}
