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

/** Resolve the API origin paired with a host-private stored login token. */
export function resolveHostOwnedApiBaseUrl(): string {
  const hostApiUrl = normalizeHostApiEnv(getHostApiEnv("VERYFRONT_API_URL"));
  if (hostApiUrl) {
    return applyIntrinsic(stringReplace, hostApiUrl, ["/graphql", "/api"]) as string;
  }
  return normalizeHostApiEnv(getHostApiEnv("VERYFRONT_API_BASE_URL")) ??
    DEFAULT_HOST_API_BASE_URL;
}
