import { getHostEnv } from "#veryfront/platform/compat/process/env.ts";
import { getEnvSource } from "#veryfront/utils/env-loader.ts";

const DEFAULT_HOST_API_BASE_URL = "https://api.veryfront.com";
const applyIntrinsic = Reflect.apply;
const stringReplace = String.prototype.replace;
const stringTrim = String.prototype.trim;

function normalizeHostApiEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = applyIntrinsic(stringTrim, value, []) as string;
  return trimmed || undefined;
}

function getHostApiEnv(key: "VERYFRONT_API_BASE_URL" | "VERYFRONT_API_URL"): string | undefined {
  // loadEnv copies repository values into the process environment. Preserve
  // the source record as the trust boundary instead of treating that later
  // process mutation as a host export.
  return getEnvSource(key).source === "env-file" ? undefined : getHostEnv(key);
}

/**
 * Resolve the CLI API URL from host-owned sources only.
 *
 * Mirrors `resolveCliApiUrl()` in `cli/shared/constants.ts`, which gives
 * `VERYFRONT_API_URL` precedence over `VERYFRONT_API_BASE_URL`, but reads the
 * host environment rather than `getEnvironmentConfig()`, so a project `.env`
 * cannot steer a request that carries a host-private stored login token.
 * Callers that need the REST API base — the destination shape paired with
 * `EnvironmentConfig.apiBaseUrl` — want {@link resolveHostOwnedApiBaseUrl}
 * instead; this one preserves the CLI's own ordering for CLI callers.
 */
export function resolveHostOwnedCliApiUrl(): string {
  const hostApiUrl = normalizeHostApiEnv(getHostApiEnv("VERYFRONT_API_URL"));
  if (hostApiUrl) return hostApiUrl;
  return normalizeHostApiEnv(getHostApiEnv("VERYFRONT_API_BASE_URL")) ??
    DEFAULT_HOST_API_BASE_URL;
}

/** Resolve the API origin paired with a host-private stored login token. */
export function resolveHostOwnedApiBaseUrl(): string {
  const hostBase = normalizeHostApiEnv(getHostApiEnv("VERYFRONT_API_BASE_URL"));
  if (hostBase) return hostBase;
  const hostApiUrl = normalizeHostApiEnv(getHostApiEnv("VERYFRONT_API_URL"));
  return hostApiUrl
    ? applyIntrinsic(stringReplace, hostApiUrl, ["/graphql", "/api"]) as string
    : DEFAULT_HOST_API_BASE_URL;
}
