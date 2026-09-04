import { getHostEnv } from "#veryfront/platform/compat/process/env.ts";
import { getEnvSource } from "#veryfront/utils/env-loader.ts";

const DEFAULT_HOST_API_BASE_URL = "https://api.veryfront.com";
const applyIntrinsic = Reflect.apply;
const stringReplace = String.prototype.replace;

function getHostApiEnv(key: "VERYFRONT_API_BASE_URL" | "VERYFRONT_API_URL"): string | undefined {
  // loadEnv copies repository values into the process environment. Preserve
  // the source record as the trust boundary instead of treating that later
  // process mutation as a host export.
  return getEnvSource(key).source === "env-file" ? undefined : getHostEnv(key);
}

/** Resolve the API origin paired with a host-private stored login token. */
export function resolveHostOwnedApiBaseUrl(): string {
  const hostBase = getHostApiEnv("VERYFRONT_API_BASE_URL");
  if (hostBase) return hostBase;
  const hostApiUrl = getHostApiEnv("VERYFRONT_API_URL");
  return hostApiUrl
    ? applyIntrinsic(stringReplace, hostApiUrl, ["/graphql", "/api"]) as string
    : DEFAULT_HOST_API_BASE_URL;
}
