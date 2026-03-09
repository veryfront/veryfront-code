import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { getVeryfrontCloudBootstrap } from "#veryfront/platform/cloud/resolver.ts";

export type VeryfrontCloudProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "moonshotai";

interface ParsedVeryfrontCloudModelId {
  provider: VeryfrontCloudProviderId;
  modelId: string;
}

const PROVIDER_ALIASES: Record<string, VeryfrontCloudProviderId> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  "google-ai-studio": "google",
  moonshotai: "moonshotai",
};

const GATEWAY_PATHS: Record<VeryfrontCloudProviderId, string> = {
  anthropic: "ai/gateway/anthropic/v1",
  openai: "ai/gateway/openai/v1",
  google: "ai/gateway/google/v1beta",
  moonshotai: "ai/gateway/moonshotai/v1",
};

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function parseVeryfrontCloudModelId(
  modelId: string,
  kind: "language" | "embedding",
): ParsedVeryfrontCloudModelId {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) {
    throw toError(
      createError({
        type: "config",
        message: `Invalid veryfront-cloud model string: "${modelId}". Expected ` +
          `"veryfront-cloud/provider/model".`,
      }),
    );
  }

  const rawProvider = modelId.slice(0, slashIndex);
  const normalizedProvider = PROVIDER_ALIASES[rawProvider];
  const upstreamModelId = modelId.slice(slashIndex + 1);

  if (!normalizedProvider || !upstreamModelId) {
    throw toError(
      createError({
        type: "config",
        message: `Invalid veryfront-cloud model string: "${modelId}". Expected ` +
          `"veryfront-cloud/provider/model".`,
      }),
    );
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

  return {
    provider: normalizedProvider,
    modelId: upstreamModelId,
  };
}

export function requireVeryfrontCloudBootstrap(): {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug?: string;
} {
  const bootstrap = getVeryfrontCloudBootstrap();

  if (!bootstrap.apiToken) {
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
    apiToken: bootstrap.apiToken,
    projectSlug: bootstrap.projectSlug,
  };
}

export function getVeryfrontCloudGatewayBaseUrl(
  apiBaseUrl: string,
  provider: VeryfrontCloudProviderId,
): string {
  return joinUrl(apiBaseUrl, GATEWAY_PATHS[provider]);
}

/**
 * Creates a fetch wrapper that replaces all SDK-injected auth headers with
 * a single `Authorization: Bearer` header for the Veryfront Cloud gateway.
 *
 * AI SDK providers set their own native auth headers (`x-api-key` for
 * Anthropic, `x-goog-api-key` for Google, `Authorization` for OpenAI).
 * The gateway expects only Bearer auth, so we strip all provider-specific
 * headers to prevent credential leakage to the wrong auth path.
 */
export function createVeryfrontCloudFetch(apiToken: string): typeof fetch {
  return (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);

    headers.delete("x-api-key");
    headers.delete("x-goog-api-key");
    headers.delete("Authorization");
    headers.set("Authorization", `Bearer ${apiToken}`);

    return fetch(new Request(request, { headers }));
  };
}
