import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  getHostEnv,
  getHostEnvExcludingEnvFile,
  hasEnvFileValueSource,
} from "#veryfront/platform/compat/process/env.ts";
import {
  getCurrentVeryfrontCloudContext,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";

const IntrinsicReflectApply = Reflect.apply;
const StringPrototypeReplace = String.prototype.replace;
const StringPrototypeTrim = String.prototype.trim;

function trimString(value: string): string {
  return IntrinsicReflectApply(StringPrototypeTrim, value, []) as string;
}

function replaceString(value: string, searchValue: RegExp, replaceValue: string): string {
  return IntrinsicReflectApply(StringPrototypeReplace, value, [
    searchValue,
    replaceValue,
  ]) as string;
}

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

function normalizeApiBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value === undefined ? undefined : trimString(value);
  if (!trimmed) return undefined;
  return replaceString(
    replaceString(trimmed, /\/graphql\/?$/, "/api"),
    /\/+$/,
    "",
  );
}

export function resolveVeryfrontApiBaseUrlFromHostEnv(): string {
  return normalizeApiBaseUrl(getHostEnv("VERYFRONT_API_BASE_URL")) ??
    normalizeApiBaseUrl(getHostEnv("VERYFRONT_API_URL")) ?? DEFAULT_API_BASE_URL;
}

function resolveHostCredentialApiBaseUrl(): string {
  return normalizeApiBaseUrl(getHostEnvExcludingEnvFile("VERYFRONT_API_URL")) ??
    normalizeApiBaseUrl(getHostEnvExcludingEnvFile("VERYFRONT_API_BASE_URL")) ??
    DEFAULT_API_BASE_URL;
}

export const DEFAULT_VERYFRONT_CLOUD_MODEL = "veryfront-cloud/openai/gpt-5.4-nano";
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

function normalizeServiceLayer(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized?.length ? normalized : undefined;
}

function hasScopedRuntimeContext(context: VeryfrontCloudContext | undefined): boolean {
  return Boolean(
    context?.apiBaseUrl || context?.apiToken || context?.projectSlug || context?.serviceLayer,
  );
}

function getResolvedVeryfrontCloudContext(): Omit<VeryfrontCloudBootstrap, "apiBaseUrl"> {
  const requestContext = getCurrentRequestContext();
  const scopedContext = getCurrentVeryfrontCloudContext();
  const runtimeBootstrap = getRuntimeBootstrap();

  return {
    apiToken: requestContext?.token ??
      scopedContext?.apiToken ??
      getHostEnv("VERYFRONT_API_TOKEN") ??
      runtimeBootstrap.apiToken,
    projectSlug: requestContext?.projectSlug ??
      scopedContext?.projectSlug ??
      getHostEnv("VERYFRONT_PROJECT_SLUG") ??
      runtimeBootstrap.projectSlug,
    serviceLayer: normalizeServiceLayer(scopedContext?.serviceLayer) ??
      normalizeServiceLayer(getHostEnv("VERYFRONT_SERVICE_LAYER")),
    hasRequestContext: requestContext !== null || hasScopedRuntimeContext(scopedContext),
    usesVeryfrontFs: runtimeBootstrap.usesVeryfrontFs,
  };
}

export function getVeryfrontCloudAuthToken(): string | undefined {
  return getVeryfrontCloudBootstrap().apiToken;
}

export function getVeryfrontCloudProjectSlug(): string | undefined {
  return getResolvedVeryfrontCloudContext().projectSlug;
}

export function getVeryfrontCloudBootstrap(): VeryfrontCloudBootstrap {
  const requestContext = getCurrentRequestContext();
  const scopedContext = getCurrentVeryfrontCloudContext();
  const scopedApiBaseUrl = scopedContext?.apiBaseUrl?.trim();
  const resolvedContext = getResolvedVeryfrontCloudContext();

  // A scoped endpoint is a different credential domain. Never attach a
  // request- or host-owned platform token to it: callers that select an
  // endpoint must supply the credential for that endpoint in the same scope.
  if (scopedApiBaseUrl) {
    return {
      apiBaseUrl: scopedApiBaseUrl,
      ...resolvedContext,
      apiToken: scopedContext?.apiToken,
    };
  }

  const usesHostCredential = requestContext?.token === undefined &&
    scopedContext?.apiToken === undefined &&
    getHostEnv("VERYFRONT_API_TOKEN") !== undefined &&
    !hasEnvFileValueSource("VERYFRONT_API_TOKEN");
  return {
    apiBaseUrl: usesHostCredential
      ? resolveHostCredentialApiBaseUrl()
      : resolveVeryfrontApiBaseUrlFromHostEnv(),
    ...resolvedContext,
  };
}

/** Resolve the trusted host identity used by direct server-side platform clients. */
export function getVeryfrontCloudHostBootstrap(): VeryfrontCloudBootstrap {
  return {
    apiBaseUrl: resolveHostCredentialApiBaseUrl(),
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
