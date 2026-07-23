import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import {
  getRegisteredRuntimeConfig,
  getRegisteredVeryfrontCloudContext,
  isRegisteredRuntimeConfigInitialized,
  type VeryfrontCloudContextSnapshot,
} from "./context-bridge.ts";

const DEFAULT_API_BASE_URL = "https://api.veryfront.com";

function normalizeApiBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw INVALID_ARGUMENT.create({ message: "Veryfront API base URL is invalid" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw INVALID_ARGUMENT.create({ message: "Veryfront API base URL must use HTTP or HTTPS" });
  }
  if (parsed.username || parsed.password) {
    throw INVALID_ARGUMENT.create({
      message: "Veryfront API base URL must not include credentials",
    });
  }
  if (parsed.search || parsed.hash) {
    throw INVALID_ARGUMENT.create({
      message: "Veryfront API base URL must not include a query string or fragment",
    });
  }

  const pathname = parsed.pathname.replace(/\/graphql\/?$/i, "/api").replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

export function resolveVeryfrontApiBaseUrlFromHostEnv(): string {
  return normalizeApiBaseUrl(getHostEnv("VERYFRONT_API_BASE_URL")) ??
    normalizeApiBaseUrl(getHostEnv("VERYFRONT_API_URL")) ?? DEFAULT_API_BASE_URL;
}

export const DEFAULT_VERYFRONT_CLOUD_MODEL = "veryfront-cloud/openai/gpt-5.4-nano";
export const DEFAULT_VERYFRONT_CLOUD_EMBEDDING_MODEL =
  "veryfront-cloud/openai/text-embedding-3-small";

/** Resolved credentials and request context for Veryfront Cloud operations. */
export interface VeryfrontCloudBootstrap {
  /** Base URL for the Veryfront API. */
  apiBaseUrl: string;
  /** Bearer token used to authenticate Veryfront API requests. */
  apiToken?: string;
  /** Project slug associated with the current request. */
  projectSlug?: string;
  /** Explicit runtime service layer selection. */
  serviceLayer?: string;
  /** Whether request-scoped Veryfront context contributed to this result. */
  hasRequestContext: boolean;
  /** Whether the active runtime uses the Veryfront filesystem adapter. */
  usesVeryfrontFs: boolean;
}

function getRuntimeBootstrap(): {
  apiToken?: string;
  projectSlug?: string;
  usesVeryfrontFs: boolean;
} {
  if (!isRegisteredRuntimeConfigInitialized()) {
    return { usesVeryfrontFs: false };
  }

  const runtimeConfig = getRegisteredRuntimeConfig();

  return {
    apiToken: runtimeConfig.fs?.veryfront?.apiToken,
    projectSlug: runtimeConfig.projectSlug ?? runtimeConfig.fs?.veryfront?.projectSlug,
    usesVeryfrontFs: runtimeConfig.fs?.type === "veryfront-api",
  };
}

function normalizeCloudModelString(value: string | undefined, fallback: string): string {
  const resolved = value?.trim() || fallback;
  const normalized = resolved.startsWith("veryfront-cloud/")
    ? resolved
    : `veryfront-cloud/${resolved}`;
  const model = normalized.slice("veryfront-cloud/".length);
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1 || /\s/.test(model)) {
    throw INVALID_ARGUMENT.create({
      message: "Veryfront Cloud model must use provider/model format",
    });
  }
  return normalized;
}

function normalizeServiceLayer(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized !== "local" && normalized !== "cloud") {
    throw INVALID_ARGUMENT.create({
      message: "Veryfront service layer must be local or cloud",
    });
  }
  return normalized;
}

function firstDefinedTrimmedString(
  name: "API token" | "project slug",
  ...values: unknown[]
): string | undefined {
  for (const value of values) {
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw INVALID_ARGUMENT.create({ message: `Veryfront ${name} must be a string` });
    }
    return value.trim();
  }
  return undefined;
}

function hasScopedRuntimeContext(context: VeryfrontCloudContextSnapshot | undefined): boolean {
  return [context?.apiBaseUrl, context?.apiToken, context?.projectSlug, context?.serviceLayer].some(
    (value) => value?.trim().length,
  );
}

function getResolvedVeryfrontCloudContext(
  scopedContext: VeryfrontCloudContextSnapshot | undefined,
): Omit<VeryfrontCloudBootstrap, "apiBaseUrl"> {
  const requestContext = getCurrentRequestContext();
  const runtimeBootstrap = getRuntimeBootstrap();

  return {
    apiToken: firstDefinedTrimmedString(
      "API token",
      requestContext?.token,
      scopedContext?.apiToken,
      getHostEnv("VERYFRONT_API_TOKEN"),
      runtimeBootstrap.apiToken,
    ),
    projectSlug: firstDefinedTrimmedString(
      "project slug",
      requestContext?.projectSlug,
      scopedContext?.projectSlug,
      getHostEnv("VERYFRONT_PROJECT_SLUG"),
      runtimeBootstrap.projectSlug,
    ),
    serviceLayer: normalizeServiceLayer(scopedContext?.serviceLayer) ??
      normalizeServiceLayer(getHostEnv("VERYFRONT_SERVICE_LAYER")),
    hasRequestContext: requestContext !== null || hasScopedRuntimeContext(scopedContext),
    usesVeryfrontFs: runtimeBootstrap.usesVeryfrontFs,
  };
}

export function getVeryfrontCloudAuthToken(): string | undefined {
  return getResolvedVeryfrontCloudContext(getRegisteredVeryfrontCloudContext()).apiToken;
}

export function getVeryfrontCloudProjectSlug(): string | undefined {
  return getResolvedVeryfrontCloudContext(getRegisteredVeryfrontCloudContext()).projectSlug;
}

/** Resolves the current Veryfront Cloud bootstrap configuration. */
export function getVeryfrontCloudBootstrap(): VeryfrontCloudBootstrap {
  const scopedContext = getRegisteredVeryfrontCloudContext();

  return {
    apiBaseUrl: normalizeApiBaseUrl(scopedContext?.apiBaseUrl) ??
      resolveVeryfrontApiBaseUrlFromHostEnv(),
    ...getResolvedVeryfrontCloudContext(scopedContext),
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
