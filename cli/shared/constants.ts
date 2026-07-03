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

export function resolveCliApiUrl(
  env: EnvironmentConfig = getEnvironmentConfig(),
  configApiUrl?: string,
): string {
  // VERYFRONT_API_URL wins. A non-default VERYFRONT_API_BASE_URL is an
  // operator override, so it wins over a checked-in veryfront.json apiUrl.
  // The default production apiBaseUrl stays below project config.
  return env.apiUrl ??
    getExplicitApiBaseUrl(env) ??
    configApiUrl ??
    env.apiBaseUrl ??
    DEFAULT_API_URL;
}

export function getApiUrl(env: EnvironmentConfig = getEnvironmentConfig()): string {
  return resolveCliApiUrl(env);
}

export const DEFAULT_LOGIN_TIMEOUT_MS = 120_000;
export const SHUTDOWN_TIMEOUT_MS = 3_000;
export const REQUEST_TIMEOUT_MS = 3_000;

export const CONFIG_DIR_NAME = "veryfront";
export const TOKEN_FILE_NAME = "token";
export const TOKEN_FILE_PERMISSIONS = 0o600;
