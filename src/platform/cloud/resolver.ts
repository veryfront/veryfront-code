import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  getHostEnv,
  getHostEnvExcludingEnvFile,
  getHostSecret,
} from "#veryfront/platform/compat/process/env.ts";
import {
  getCurrentVeryfrontCloudContext,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";

const IntrinsicReflectApply = Reflect.apply;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeEndsWith = String.prototype.endsWith;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeTrim = String.prototype.trim;

function trimString(value: string): string {
  return IntrinsicReflectApply(StringPrototypeTrim, value, []) as string;
}

function charCodeAtString(value: string, index: number): number {
  return IntrinsicReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
}

function endsWithString(value: string, suffix: string): boolean {
  return IntrinsicReflectApply(StringPrototypeEndsWith, value, [suffix]) as boolean;
}

function sliceString(value: string, start: number, end?: number): string {
  return IntrinsicReflectApply(
    StringPrototypeSlice,
    value,
    end === undefined ? [start] : [start, end],
  ) as string;
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && charCodeAtString(value, end - 1) === 47) end -= 1;
  return sliceString(value, 0, end);
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

export function normalizeVeryfrontApiBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value === undefined ? undefined : trimString(value);
  if (!trimmed) return undefined;
  const withoutTrailingSlashes = stripTrailingSlashes(trimmed);
  return endsWithString(withoutTrailingSlashes, "/graphql")
    ? `${sliceString(withoutTrailingSlashes, 0, -"/graphql".length)}/api`
    : withoutTrailingSlashes;
}

export function resolveVeryfrontApiBaseUrlFromHostEnv(): string {
  return normalizeVeryfrontApiBaseUrl(getHostEnv("VERYFRONT_API_BASE_URL")) ??
    normalizeVeryfrontApiBaseUrl(getHostEnv("VERYFRONT_API_URL")) ?? DEFAULT_API_BASE_URL;
}

/** Resolve the optional public API origin used for bearer-bound inference requests. */
export function resolveVeryfrontPublicApiBaseUrlFromHostEnv(): string | undefined {
  return normalizeVeryfrontApiBaseUrl(getHostEnv("VERYFRONT_PUBLIC_API_BASE_URL"));
}

function resolveHostCredentialApiBaseUrl(): string {
  return normalizeVeryfrontApiBaseUrl(getHostEnvExcludingEnvFile("VERYFRONT_API_URL")) ??
    normalizeVeryfrontApiBaseUrl(getHostEnvExcludingEnvFile("VERYFRONT_API_BASE_URL")) ??
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
    resolvedContext.apiToken !== undefined &&
    resolvedContext.apiToken === getHostSecret("VERYFRONT_API_TOKEN");
  return {
    apiBaseUrl: usesHostCredential
      ? resolveHostCredentialApiBaseUrl()
      : resolveVeryfrontApiBaseUrlFromHostEnv(),
    ...resolvedContext,
  };
}

/** Resolve the trusted host identity used by direct server-side platform clients. */
export function getVeryfrontCloudHostBootstrap(): VeryfrontCloudBootstrap {
  const apiToken = getHostEnv("VERYFRONT_API_TOKEN");
  const usesHostPrivateCredential = apiToken !== undefined &&
    apiToken === getHostSecret("VERYFRONT_API_TOKEN");
  return {
    apiBaseUrl: usesHostPrivateCredential
      ? resolveHostCredentialApiBaseUrl()
      : resolveVeryfrontApiBaseUrlFromHostEnv(),
    apiToken,
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
