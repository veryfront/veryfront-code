import { getRuntimeConfig, isRuntimeConfigInitialized } from "#veryfront/config";
import { getApiBaseUrlEnv } from "#veryfront/config/env.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

export const DEFAULT_VERYFRONT_CLOUD_MODEL = "veryfront-cloud/anthropic/claude-sonnet-4-6";
export const DEFAULT_VERYFRONT_CLOUD_EMBEDDING_MODEL =
  "veryfront-cloud/openai/text-embedding-3-small";

export interface VeryfrontCloudBootstrap {
  apiBaseUrl: string;
  apiToken?: string;
  projectSlug?: string;
  serviceLayer?: string;
  hasRequestContext: boolean;
  usesVeryfrontFs: boolean;
}

function getRuntimeBootstrap(): {
  apiToken?: string;
  projectSlug?: string;
  usesVeryfrontFs: boolean;
} {
  if (!isRuntimeConfigInitialized()) {
    return { usesVeryfrontFs: false };
  }

  const runtimeConfig = getRuntimeConfig();

  return {
    apiToken: runtimeConfig.fs?.veryfront?.apiToken,
    projectSlug: runtimeConfig.projectSlug ?? runtimeConfig.fs?.veryfront?.projectSlug,
    usesVeryfrontFs: runtimeConfig.fs?.type === "veryfront-api",
  };
}

function normalizeCloudModelString(value: string | undefined, fallback: string): string {
  const resolved = value?.trim() || fallback;
  return resolved.startsWith("veryfront-cloud/") ? resolved : `veryfront-cloud/${resolved}`;
}

function getResolvedVeryfrontCloudContext(): Omit<VeryfrontCloudBootstrap, "apiBaseUrl"> {
  const requestContext = getCurrentRequestContext();
  const runtimeBootstrap = getRuntimeBootstrap();

  return {
    apiToken: requestContext?.token ??
      getEnv("VERYFRONT_API_TOKEN") ??
      runtimeBootstrap.apiToken,
    projectSlug: requestContext?.projectSlug ??
      getEnv("VERYFRONT_PROJECT_SLUG") ??
      runtimeBootstrap.projectSlug,
    serviceLayer: getEnv("VERYFRONT_SERVICE_LAYER")?.trim().toLowerCase(),
    hasRequestContext: requestContext !== null,
    usesVeryfrontFs: runtimeBootstrap.usesVeryfrontFs,
  };
}

export function getVeryfrontCloudAuthToken(): string | undefined {
  return getResolvedVeryfrontCloudContext().apiToken;
}

export function getVeryfrontCloudProjectSlug(): string | undefined {
  return getResolvedVeryfrontCloudContext().projectSlug;
}

export function getVeryfrontCloudBootstrap(): VeryfrontCloudBootstrap {
  return {
    apiBaseUrl: getApiBaseUrlEnv(),
    ...getResolvedVeryfrontCloudContext(),
  };
}

export function isVeryfrontCloudEnabled(): boolean {
  const bootstrap = getVeryfrontCloudBootstrap();

  if (bootstrap.serviceLayer === "local") {
    return false;
  }

  if (bootstrap.serviceLayer === "cloud") {
    return Boolean(bootstrap.apiToken);
  }

  const hasProjectContext = bootstrap.hasRequestContext ||
    bootstrap.usesVeryfrontFs ||
    Boolean(bootstrap.projectSlug);

  return Boolean(bootstrap.apiToken && hasProjectContext);
}

export function getDefaultVeryfrontCloudModel(): string {
  return normalizeCloudModelString(
    getEnv("VERYFRONT_DEFAULT_MODEL"),
    DEFAULT_VERYFRONT_CLOUD_MODEL,
  );
}

export function getDefaultVeryfrontCloudEmbeddingModel(): string {
  return normalizeCloudModelString(
    getEnv("VERYFRONT_DEFAULT_EMBEDDING_MODEL"),
    DEFAULT_VERYFRONT_CLOUD_EMBEDDING_MODEL,
  );
}
