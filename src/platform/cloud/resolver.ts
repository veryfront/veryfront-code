import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  getCurrentVeryfrontCloudContext,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import {
  DEFAULT_VERYFRONT_CLOUD_RUNTIME_MODEL_ID,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { MAX_URL_LENGTH_FOR_VALIDATION } from "#veryfront/utils/constants/limits.ts";

// ---------------------------------------------------------------------------
// GlobalThis bridges — config/ is a middle layer, platform/ is bottom layer.
// config/runtime-config.ts and config/env.ts register these at init time.
// ---------------------------------------------------------------------------

interface RuntimeConfigLike {
  fs?: { veryfront?: { apiToken?: string; projectSlug?: string }; type?: string };
  projectSlug?: string;
}

function getRuntimeConfig(): RuntimeConfigLike {
  const getter = (globalThis as Record<string, unknown>).__vfGetRuntimeConfig as
    | (() => RuntimeConfigLike)
    | undefined;
  return getter?.() ?? {};
}

function isRuntimeConfigInitialized(): boolean {
  const checker = (globalThis as Record<string, unknown>).__vfIsRuntimeConfigInitialized as
    | (() => boolean)
    | undefined;
  return checker?.() ?? false;
}

const DEFAULT_API_BASE_URL = "https://api.veryfront.com";

function normalizeApiBaseUrl(
  value: string | undefined,
  label: string,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_URL_LENGTH_FOR_VALIDATION) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} exceeds the ${MAX_URL_LENGTH_FOR_VALIDATION}-character limit`,
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (cause) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} must be a valid HTTP(S) URL`,
      cause,
    });
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} must be an HTTP(S) URL without credentials, query parameters, or fragments`,
    });
  }

  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/graphql")) {
    pathname = `${pathname.slice(0, -"/graphql".length)}/api`;
  }
  return `${parsed.origin}${pathname}`;
}

export function resolveVeryfrontApiBaseUrlFromHostEnv(): string {
  return normalizeApiBaseUrl(
    getHostEnv("VERYFRONT_API_BASE_URL"),
    "VERYFRONT_API_BASE_URL",
  ) ??
    normalizeApiBaseUrl(getHostEnv("VERYFRONT_API_URL"), "VERYFRONT_API_URL") ??
    DEFAULT_API_BASE_URL;
}

export const DEFAULT_VERYFRONT_CLOUD_MODEL = DEFAULT_VERYFRONT_CLOUD_RUNTIME_MODEL_ID;
export const DEFAULT_VERYFRONT_CLOUD_EMBEDDING_MODEL =
  "veryfront-cloud/openai/text-embedding-3-small";

export interface VeryfrontCloudBootstrap {
  apiBaseUrl: string;
  apiToken?: string;
  projectSlug?: string;
  serviceLayer?: "auto" | "cloud" | "local";
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

function normalizeServiceLayer(
  value: string | undefined,
): VeryfrontCloudBootstrap["serviceLayer"] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "auto" || normalized === "cloud" || normalized === "local") {
    return normalized;
  }
  throw INVALID_ARGUMENT.create({
    detail: "Veryfront service layer must be one of: auto, cloud, local",
  });
}

function hasScopedRuntimeContext(context: VeryfrontCloudContext | undefined): boolean {
  return Boolean(
    context?.apiBaseUrl || context?.apiToken || context?.projectSlug || context?.serviceLayer,
  );
}

function getResolvedVeryfrontCloudContext(
  scopedContext = getCurrentVeryfrontCloudContext(),
  scopedApiBaseUrl = normalizeApiBaseUrl(
    scopedContext?.apiBaseUrl,
    "Scoped Veryfront API base URL",
  ),
): Omit<VeryfrontCloudBootstrap, "apiBaseUrl"> {
  const requestContext = getCurrentRequestContext();
  const runtimeBootstrap = getRuntimeBootstrap();
  const hasScopedApiBaseUrl = scopedApiBaseUrl !== undefined;

  return {
    apiToken: requestContext?.token ??
      scopedContext?.apiToken ??
      (hasScopedApiBaseUrl
        ? undefined
        : getHostEnv("VERYFRONT_API_TOKEN") ?? runtimeBootstrap.apiToken),
    projectSlug: requestContext?.projectSlug ??
      scopedContext?.projectSlug ??
      (hasScopedApiBaseUrl
        ? undefined
        : getHostEnv("VERYFRONT_PROJECT_SLUG") ?? runtimeBootstrap.projectSlug),
    serviceLayer: normalizeServiceLayer(scopedContext?.serviceLayer) ??
      normalizeServiceLayer(getHostEnv("VERYFRONT_SERVICE_LAYER")),
    hasRequestContext: requestContext !== null || hasScopedRuntimeContext(scopedContext),
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
  const scopedContext = getCurrentVeryfrontCloudContext();
  const scopedApiBaseUrl = normalizeApiBaseUrl(
    scopedContext?.apiBaseUrl,
    "Scoped Veryfront API base URL",
  );

  return {
    apiBaseUrl: scopedApiBaseUrl ?? resolveVeryfrontApiBaseUrlFromHostEnv(),
    ...getResolvedVeryfrontCloudContext(scopedContext, scopedApiBaseUrl),
  };
}

/** Resolve the trusted host identity used by direct server-side platform clients. */
export function getVeryfrontCloudHostBootstrap(): VeryfrontCloudBootstrap {
  return {
    apiBaseUrl: resolveVeryfrontApiBaseUrlFromHostEnv(),
    apiToken: getHostEnv("VERYFRONT_API_TOKEN"),
    projectSlug: getHostEnv("VERYFRONT_PROJECT_SLUG"),
    serviceLayer: normalizeServiceLayer(getHostEnv("VERYFRONT_SERVICE_LAYER")),
    hasRequestContext: false,
    usesVeryfrontFs: false,
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
    getHostEnv("VERYFRONT_DEFAULT_MODEL"),
    DEFAULT_VERYFRONT_CLOUD_MODEL,
  );
}

export function getDefaultVeryfrontCloudEmbeddingModel(): string {
  return normalizeCloudModelString(
    getHostEnv("VERYFRONT_DEFAULT_EMBEDDING_MODEL"),
    DEFAULT_VERYFRONT_CLOUD_EMBEDDING_MODEL,
  );
}
