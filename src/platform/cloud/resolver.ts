import { getRuntimeRequestContext } from "#veryfront/platform/runtime-request-context.ts";
import {
  peekVeryfrontCloudCatalog,
  type VeryfrontCloudCatalogScopeKey,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import {
  getHostBootEnv,
  getHostEnv,
  getHostEnvExcludingEnvFile,
  getHostSecret,
} from "#veryfront/platform/compat/process/env.ts";
import {
  getCurrentVeryfrontCloudContext,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { readVeryfrontApiTokenFile } from "./credential-file.ts";

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

/**
 * Resolve the optional public API origin, including values a project env file
 * set. Never send a credential here: use
 * {@link resolveVeryfrontInferenceApiBaseUrlFromHostEnv} for that.
 */
export function resolveVeryfrontPublicApiBaseUrlFromHostEnv(): string | undefined {
  return normalizeVeryfrontApiBaseUrl(getHostEnv("VERYFRONT_PUBLIC_API_BASE_URL"));
}

function resolveHostCredentialApiBaseUrl(): string {
  const apiUrl = normalizeVeryfrontApiBaseUrl(getHostEnvExcludingEnvFile("VERYFRONT_API_URL"));
  const apiBaseUrl = normalizeVeryfrontApiBaseUrl(
    getHostEnvExcludingEnvFile("VERYFRONT_API_BASE_URL"),
  );
  const resolved = getHostEnv("VERYFRONT_API_TOKEN_FILE") !== undefined
    ? apiBaseUrl ?? apiUrl
    : apiUrl ?? apiBaseUrl;
  return resolved ?? DEFAULT_API_BASE_URL;
}

/**
 * Resolve the API origin for run-scoped inference credentials from the host
 * process environment as it was at startup. The Veryfront Cloud context,
 * project env files, and later environment writes are never consulted: project
 * code can set all three, and this origin receives the credential.
 *
 * @internal The one trusted source for a run-scoped credential's destination.
 * Every path that attaches such a credential must use it or an explicit
 * host-configured URL.
 */
export function resolveVeryfrontInferenceApiBaseUrlFromHostEnv(): string {
  return normalizeVeryfrontApiBaseUrl(getHostBootEnv("VERYFRONT_PUBLIC_API_BASE_URL")) ??
    // Same precedence as resolveVeryfrontApiBaseUrlFromHostEnv().
    normalizeVeryfrontApiBaseUrl(getHostBootEnv("VERYFRONT_API_BASE_URL")) ??
    normalizeVeryfrontApiBaseUrl(getHostBootEnv("VERYFRONT_API_URL")) ??
    DEFAULT_API_BASE_URL;
}

/** Built-in default model, used until the served catalog names one. */
export const DEFAULT_VERYFRONT_CLOUD_MODEL = "veryfront-cloud/mistral/mistral-small-2503";
export const DEFAULT_VERYFRONT_CLOUD_EMBEDDING_MODEL =
  "veryfront-cloud/google/gemini-embedding-001";

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

function resolveHostCredential(): { apiToken?: string; usesHostCredential: boolean } {
  const tokenFile = getHostEnv("VERYFRONT_API_TOKEN_FILE");
  const apiToken = readVeryfrontApiTokenFile(tokenFile) ?? getHostEnv("VERYFRONT_API_TOKEN");
  return {
    apiToken,
    usesHostCredential: tokenFile !== undefined ||
      (apiToken !== undefined && apiToken === getHostSecret("VERYFRONT_API_TOKEN")),
  };
}

function getResolvedVeryfrontCloudContext():
  & Omit<VeryfrontCloudBootstrap, "apiBaseUrl">
  & { usesHostCredential: boolean } {
  const requestContext = getRuntimeRequestContext();
  const scopedContext = getCurrentVeryfrontCloudContext();
  const runtimeBootstrap = getRuntimeBootstrap();
  const scopedToken = requestContext?.token ?? scopedContext?.apiToken;
  const hostCredential = scopedToken === undefined ? resolveHostCredential() : undefined;
  const apiToken = scopedToken ?? hostCredential?.apiToken ?? runtimeBootstrap.apiToken;

  return {
    apiToken,
    usesHostCredential: hostCredential?.usesHostCredential === true ||
      (apiToken !== undefined && apiToken === getHostSecret("VERYFRONT_API_TOKEN")),
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
  const scopedContext = getCurrentVeryfrontCloudContext();
  const scopedApiBaseUrl = scopedContext?.apiBaseUrl?.trim();
  const { usesHostCredential, ...resolvedContext } = getResolvedVeryfrontCloudContext();

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

  return {
    apiBaseUrl: usesHostCredential
      ? resolveHostCredentialApiBaseUrl()
      : resolveVeryfrontApiBaseUrlFromHostEnv(),
    ...resolvedContext,
  };
}

/** Resolve the trusted host identity used by direct server-side platform clients. */
export function getVeryfrontCloudHostBootstrap(): VeryfrontCloudBootstrap {
  const { apiToken, usesHostCredential } = resolveHostCredential();
  return {
    apiBaseUrl: usesHostCredential
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

/**
 * Default Veryfront Cloud model: `VERYFRONT_DEFAULT_MODEL` when set, otherwise
 * the default the served catalog names once it has loaded for the current
 * credentials and project, otherwise the built-in default.
 */
export function getDefaultVeryfrontCloudModel(): string {
  const bootstrap = getVeryfrontCloudBootstrap();
  // A context without credentials may carry the key of the run's catalog.
  const carriedKey = getCurrentVeryfrontCloudContext()?.catalogScopeKey;
  const served = (bootstrap.apiToken
    ? peekVeryfrontCloudCatalog({
      apiBaseUrl: bootstrap.apiBaseUrl,
      apiToken: bootstrap.apiToken,
      ...(bootstrap.projectSlug ? { projectSlug: bootstrap.projectSlug } : {}),
    })
    : carriedKey
    ? peekVeryfrontCloudCatalog(carriedKey as VeryfrontCloudCatalogScopeKey)
    : peekVeryfrontCloudCatalog())?.defaultModelId;
  return normalizeCloudModelString(
    getHostEnv("VERYFRONT_DEFAULT_MODEL"),
    served?.includes("/") ? served : DEFAULT_VERYFRONT_CLOUD_MODEL,
  );
}

export function getDefaultVeryfrontCloudEmbeddingModel(): string {
  return normalizeCloudModelString(
    getHostEnv("VERYFRONT_DEFAULT_EMBEDDING_MODEL"),
    DEFAULT_VERYFRONT_CLOUD_EMBEDDING_MODEL,
  );
}
