import { getHostEnvExcludingEnvFile } from "#veryfront/platform/compat/process/env.ts";

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
  return getHostEnvExcludingEnvFile(key);
}

/**
 * Resolve the API origin paired with a host-private stored login token.
 *
 * `VERYFRONT_API_URL` comes first, matching `resolveCliApiUrl()` in
 * `cli/shared/constants.ts`: a host that exports both must not see its
 * requests move to the other server just because the credential came from the
 * token store. Only host-owned sources are read, so a project `.env` cannot
 * steer a request that carries the credential.
 */
export function resolveHostOwnedApiBaseUrl(): string {
  const hostApiUrl = normalizeHostApiEnv(getHostApiEnv("VERYFRONT_API_URL"));
  if (hostApiUrl) {
    return applyIntrinsic(stringReplace, hostApiUrl, ["/graphql", "/api"]) as string;
  }
  return normalizeHostApiEnv(getHostApiEnv("VERYFRONT_API_BASE_URL")) ??
    DEFAULT_HOST_API_BASE_URL;
}
