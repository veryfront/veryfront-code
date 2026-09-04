/**
 * Centralized CLI constants
 * @module cli/shared/constants
 */

import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";

export const DEFAULT_DEV_PORT = 3000;
export const DEFAULT_PROXY_PORT = 8080;
export const DEFAULT_MCP_PORT = 9999;
export const DEV_MCP_PORT_OFFSET = 2;
export const DEFAULT_DEV_MCP_PORT = DEFAULT_DEV_PORT + DEV_MCP_PORT_OFFSET;
export const DEFAULT_CALLBACK_PORT = 9876;
export const MAX_PORT_ATTEMPTS = 100;

export const DEFAULT_API_URL = "https://api.veryfront.com";
export const DEFAULT_LOCAL_API_URL = "https://api.veryfront.com";

function getExplicitApiBaseUrl(env: EnvironmentConfig): string | undefined {
  if (!env.apiBaseUrl || env.apiBaseUrl === DEFAULT_API_URL) return undefined;
  return env.apiBaseUrl;
}

/** Environment variables that can steer the CLI at a different API host. */
export type ApiUrlEnvKey = "VERYFRONT_API_URL" | "VERYFRONT_API_BASE_URL";

/**
 * Every environment key that can move the CLI to another API host.
 *
 * Trust decisions must neutralise all of them together: `apiBaseUrl` derives
 * from `apiUrl` when unset, so removing one still leaves the other pointing at
 * a repository-supplied host.
 */
export const API_URL_ENV_KEYS: readonly ApiUrlEnvKey[] = [
  "VERYFRONT_API_URL",
  "VERYFRONT_API_BASE_URL",
];

/** Which input supplied the effective API URL. */
export type ApiUrlOrigin =
  | { source: "env"; key: ApiUrlEnvKey }
  | { source: "config-file" }
  | { source: "default" };

/**
 * Resolve the API URL together with the input that supplied it.
 *
 * Callers that decide whether a credential may travel to the resolved host
 * need the origin, not just the string: a URL that came from a checked-in
 * `veryfront.json` (or from a project `.env` file) is controlled by whoever
 * wrote the repository, while one that came from the real process environment
 * is an operator decision.
 */
export function resolveCliApiUrlWithOrigin(
  env: EnvironmentConfig = getEnvironmentConfig(),
  configApiUrl?: string,
): { apiUrl: string; origin: ApiUrlOrigin } {
  // VERYFRONT_API_URL wins. A non-default VERYFRONT_API_BASE_URL is an
  // operator override, so it wins over a checked-in veryfront.json apiUrl.
  // The default production apiBaseUrl stays below project config.
  if (env.apiUrl != null) {
    return { apiUrl: env.apiUrl, origin: { source: "env", key: "VERYFRONT_API_URL" } };
  }

  const explicitApiBaseUrl = getExplicitApiBaseUrl(env);
  if (explicitApiBaseUrl != null) {
    return {
      apiUrl: explicitApiBaseUrl,
      origin: { source: "env", key: "VERYFRONT_API_BASE_URL" },
    };
  }

  if (configApiUrl != null) {
    return { apiUrl: configApiUrl, origin: { source: "config-file" } };
  }

  return { apiUrl: env.apiBaseUrl ?? DEFAULT_API_URL, origin: { source: "default" } };
}

export function resolveCliApiUrl(
  env: EnvironmentConfig = getEnvironmentConfig(),
  configApiUrl?: string,
): string {
  return resolveCliApiUrlWithOrigin(env, configApiUrl).apiUrl;
}

/**
 * Compare two API URLs by their parsed components rather than their spelling.
 *
 * `https://API.VERYFRONT.COM`, `https://api.veryfront.com:443` and
 * `https://api.veryfront.com/` all address the same host, so none of them is a
 * redirect away from the endpoint the CLI would have used anyway.
 */
export function isSameApiEndpoint(a: string, b: string): boolean {
  if (a === b) return true;

  let left: URL;
  let right: URL;
  try {
    left = new URL(a);
    right = new URL(b);
  } catch {
    // An unparseable URL can only be treated as equal to itself.
    return false;
  }

  return left.protocol === right.protocol &&
    left.host === right.host &&
    left.username === right.username &&
    left.password === right.password &&
    stripTrailingSlashes(left.pathname) === stripTrailingSlashes(right.pathname);
}

function stripTrailingSlashes(pathname: string): string {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === "/") end--;
  return pathname.slice(0, end);
}

export function getApiUrl(env: EnvironmentConfig = getEnvironmentConfig()): string {
  return resolveCliApiUrl(env);
}

export const DEFAULT_LOGIN_TIMEOUT_MS = 120_000;
export const SHUTDOWN_TIMEOUT_MS = 3_000;
export const REQUEST_TIMEOUT_MS = 3_000;

/**
 * Dashboard page where users mint a Veryfront API token.
 * `/settings/api-keys` is a legacy path that 301-redirects here.
 */
export const API_KEYS_URL = "veryfront.com/account/api-keys";

export const CONFIG_DIR_NAME = "veryfront";
export const TOKEN_FILE_NAME = "token";
export const TOKEN_FILE_PERMISSIONS = 0o600;
