import { createError, toError } from "#veryfront/errors";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import { getVeryfrontCloudBootstrap } from "#veryfront/platform/cloud/resolver.ts";
import {
  getCurrentVeryfrontCloudContext,
  markCurrentVeryfrontCloudBillingGroupUsed,
} from "./context.ts";
import { isSupportedMistralModelId, type VeryfrontCloudProviderId } from "./model-catalog.ts";

export type { VeryfrontCloudProviderId } from "./model-catalog.ts";

interface ParsedVeryfrontCloudModelId {
  provider: VeryfrontCloudProviderId;
  modelId: string;
}

const PROVIDER_ALIASES: Record<string, VeryfrontCloudProviderId> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  "google-ai-studio": "google",
  mistral: "mistral",
  moonshotai: "moonshotai",
};

const GATEWAY_PATHS: Record<VeryfrontCloudProviderId, string> = {
  anthropic: "ai/gateway/anthropic/v1",
  openai: "ai/gateway/openai/v1",
  google: "ai/gateway/google/v1beta",
  mistral: "ai/gateway/mistral/v1",
  moonshotai: "ai/gateway/moonshotai/v1",
};

function joinUrl(base: string, path: string): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw toError(createError({ type: "config", message: "Veryfront Cloud base URL is invalid." }));
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password ||
    url.search || url.hash
  ) {
    throw toError(createError({ type: "config", message: "Veryfront Cloud base URL is invalid." }));
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/${path.replace(/^\/+/, "")}`;
  return url.toString();
}

function createInvalidModelIdError(): Error {
  return toError(
    createError({
      type: "config",
      message: 'Invalid veryfront-cloud model string. Expected "veryfront-cloud/provider/model".',
    }),
  );
}

export function parseVeryfrontCloudModelId(
  modelId: string,
  kind: "language" | "embedding",
): ParsedVeryfrontCloudModelId {
  if (
    typeof modelId !== "string" || modelId.length === 0 || modelId.length > 4_096 ||
    /\s/u.test(modelId) || hasUnsafeControlCharacters(modelId)
  ) {
    throw createInvalidModelIdError();
  }
  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) {
    throw createInvalidModelIdError();
  }

  const rawProvider = modelId.slice(0, slashIndex);
  const normalizedProvider = Object.hasOwn(PROVIDER_ALIASES, rawProvider)
    ? PROVIDER_ALIASES[rawProvider]
    : undefined;
  const upstreamModelId = modelId.slice(slashIndex + 1);

  if (!normalizedProvider || !upstreamModelId) {
    throw createInvalidModelIdError();
  }

  if (
    kind === "embedding" && normalizedProvider !== "openai" &&
    normalizedProvider !== "google"
  ) {
    throw toError(
      createError({
        type: "config",
        message: "Embedding provider is not supported for veryfront-cloud. " +
          "Supported providers: openai, google.",
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
        message: "The requested Mistral model is not supported for veryfront-cloud.",
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
  if (!Object.hasOwn(GATEWAY_PATHS, provider)) {
    throw toError(createError({ type: "config", message: "Veryfront Cloud provider is invalid." }));
  }
  return joinUrl(apiBaseUrl, GATEWAY_PATHS[provider]);
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
  projectSlug: string | undefined,
  allowedBaseUrl: string,
): typeof fetch {
  if (!allowedBaseUrl) {
    throw toError(createError({
      type: "config",
      message: "Veryfront Cloud fetch requires an allowed base URL.",
    }));
  }
  if (
    typeof apiToken !== "string" || apiToken.length === 0 || apiToken.length > 16_384 ||
    /\s/u.test(apiToken) || hasUnsafeControlCharacters(apiToken)
  ) {
    throw toError(
      createError({ type: "config", message: "Veryfront Cloud API token is invalid." }),
    );
  }
  if (
    projectSlug !== undefined &&
    (projectSlug.length === 0 || projectSlug.length > 1_024 ||
      /\s/u.test(projectSlug) || hasUnsafeControlCharacters(projectSlug))
  ) {
    throw toError(createError({ type: "config", message: "Veryfront project slug is invalid." }));
  }

  let allowed: URL;
  try {
    allowed = new URL(allowedBaseUrl);
  } catch {
    throw toError(createError({ type: "config", message: "Veryfront Cloud base URL is invalid." }));
  }
  if (
    (allowed.protocol !== "http:" && allowed.protocol !== "https:") || allowed.username ||
    allowed.password || allowed.search || allowed.hash
  ) {
    throw toError(createError({ type: "config", message: "Veryfront Cloud base URL is invalid." }));
  }
  const allowedPath = allowed.pathname.replace(/\/+$/u, "");

  return (input, init) => {
    const request = new Request(input, init);
    const target = new URL(request.url);
    if (
      target.origin !== allowed.origin ||
      (target.pathname !== allowedPath && !target.pathname.startsWith(`${allowedPath}/`))
    ) {
      throw toError(createError({
        type: "config",
        message: "Veryfront Cloud request URL is outside the allowed base URL.",
      }));
    }
    const headers = new Headers(request.headers);

    headers.delete("x-api-key");
    headers.delete("x-goog-api-key");
    headers.set("Authorization", `Bearer ${apiToken}`);

    if (projectSlug) {
      headers.set("x-veryfront-project-slug", projectSlug);
    }

    const billingGroupId = getCurrentVeryfrontCloudContext()?.billingGroupId?.trim();
    if (billingGroupId) {
      if (billingGroupId.length > 1_024 || hasUnsafeControlCharacters(billingGroupId)) {
        throw toError(createError({
          type: "config",
          message: "Veryfront billing group ID is invalid.",
        }));
      }
      headers.set("x-veryfront-billing-group-id", billingGroupId);
      markCurrentVeryfrontCloudBillingGroupUsed();
    }

    return fetch(new Request(request, { headers, redirect: "error" }));
  };
}
