import {
  getHostBootEnv,
  getHostEnvExcludingEnvFile,
} from "#veryfront/platform/compat/process/env.ts";

const NativeURL = URL;
const urlOrigin = Object.getOwnPropertyDescriptor(NativeURL.prototype, "origin")!.get!;
const urlHostname = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hostname")!.get!;
const urlProtocol = Object.getOwnPropertyDescriptor(NativeURL.prototype, "protocol")!.get!;
const urlUsername = Object.getOwnPropertyDescriptor(NativeURL.prototype, "username")!.get!;
const urlPassword = Object.getOwnPropertyDescriptor(NativeURL.prototype, "password")!.get!;
const urlPathname = Object.getOwnPropertyDescriptor(NativeURL.prototype, "pathname")!.get!;
const urlSearch = Object.getOwnPropertyDescriptor(NativeURL.prototype, "search")!.get!;
const urlHash = Object.getOwnPropertyDescriptor(NativeURL.prototype, "hash")!.get!;
const DEFAULT_HOST_API_BASE_URL = "https://api.veryfront.com";
const applyIntrinsic = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringEndsWith = String.prototype.endsWith;
const stringSlice = String.prototype.slice;
const stringTrim = String.prototype.trim;
const stringToLowerCase = String.prototype.toLowerCase;

function normalizeHostApiEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = applyIntrinsic(stringTrim, value, []) as string;
  return trimmed || undefined;
}

function isCredentialFreeOrigin(value: string | undefined, origin: string): boolean {
  if (!value) return false;
  try {
    const url = new NativeURL(value);
    return applyIntrinsic(urlUsername, url, []) === "" &&
      applyIntrinsic(urlPassword, url, []) === "" &&
      applyIntrinsic(urlOrigin, url, []) === origin;
  } catch {
    return false;
  }
}

/**
 * @internal Exact numeric loopback API origin authorized by the operator at process boot.
 * It must also be the origin of `VERYFRONT_API_URL` or `VERYFRONT_API_BASE_URL`,
 * since stored-login and source-client requests select different variables.
 */
export function isHostHttpApiOrigin(value: string): boolean {
  const permission = getHostBootEnv("VERYFRONT_HOST_HTTP_API_ORIGIN");
  if (!permission) return false;
  let origin: string;
  try {
    const allowed = new NativeURL(permission);
    const hostname = applyIntrinsic(urlHostname, allowed, []) as string;
    if (
      applyIntrinsic(urlProtocol, allowed, []) !== "http:" ||
      (hostname !== "127.0.0.1" && hostname !== "[::1]") ||
      applyIntrinsic(urlPathname, allowed, []) !== "/" ||
      applyIntrinsic(urlSearch, allowed, []) !== "" ||
      applyIntrinsic(urlHash, allowed, []) !== "" ||
      applyIntrinsic(urlUsername, allowed, []) !== "" ||
      applyIntrinsic(urlPassword, allowed, []) !== ""
    ) {
      return false;
    }
    origin = applyIntrinsic(urlOrigin, allowed, []) as string;
  } catch {
    return false;
  }
  return isCredentialFreeOrigin(value, origin) &&
    (isCredentialFreeOrigin(
      normalizeHostApiEnv(getHostBootEnv("VERYFRONT_API_URL")),
      origin,
    ) ||
      isCredentialFreeOrigin(
        normalizeHostApiEnv(getHostBootEnv("VERYFRONT_API_BASE_URL")),
        origin,
      ));
}

/** Require HTTPS or an explicitly authorized numeric loopback API before attaching host credentials. */
export function requireHostPrivateApiHttps(value: string): string {
  const prefix = applyIntrinsic(stringSlice, value, [0, 8]) as string;
  if (applyIntrinsic(stringToLowerCase, prefix, []) !== "https://" && !isHostHttpApiOrigin(value)) {
    throw new TypeError("Host-private credentials require an HTTPS API endpoint");
  }
  return value;
}

function normalizeHostApiUrl(value: string): string {
  let end = value.length;
  while (end > 0 && applyIntrinsic(stringCharCodeAt, value, [end - 1]) === 47) end--;
  const normalized = applyIntrinsic(stringSlice, value, [0, end]) as string;
  if (applyIntrinsic(stringEndsWith, normalized, ["/graphql"]) as boolean) {
    return `${applyIntrinsic(stringSlice, normalized, [0, -"/graphql".length]) as string}/api`;
  }
  return normalized;
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
    return normalizeHostApiUrl(hostApiUrl);
  }
  const hostApiBaseUrl = normalizeHostApiEnv(getHostApiEnv("VERYFRONT_API_BASE_URL"));
  return hostApiBaseUrl ? normalizeHostApiUrl(hostApiBaseUrl) : DEFAULT_HOST_API_BASE_URL;
}

/**
 * Match the runtime source client: BASE selects its public API even when URL
 * selects a separate internal endpoint. Stored-login URL precedence is separate.
 */
export function resolveHostOwnedSourceApiBaseUrl(): string {
  const hostApiBaseUrl = normalizeHostApiEnv(getHostApiEnv("VERYFRONT_API_BASE_URL"));
  if (hostApiBaseUrl) return normalizeHostApiUrl(hostApiBaseUrl);
  const hostApiUrl = normalizeHostApiEnv(getHostApiEnv("VERYFRONT_API_URL"));
  return hostApiUrl ? normalizeHostApiUrl(hostApiUrl) : DEFAULT_HOST_API_BASE_URL;
}
