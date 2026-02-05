/**
 * Centralized CLI constants
 * @module cli/shared/constants
 */

import { getEnvironmentConfig, type EnvironmentConfig } from "#veryfront/config/environment-config.ts";

export const DEFAULT_DEV_PORT = 3000;
export const DEFAULT_PROXY_PORT = 8080;
export const DEFAULT_MCP_PORT = 8080;
export const DEFAULT_CALLBACK_PORT = 9876;
export const MAX_PORT_ATTEMPTS = 100;

export const DEFAULT_API_URL = "https://api.veryfront.com";
export const DEFAULT_LOCAL_API_URL = "http://api.veryfront.me:4000";

export function getApiUrl(env: EnvironmentConfig = getEnvironmentConfig()): string {
  return env.apiUrl ?? DEFAULT_API_URL;
}

export const DEFAULT_LOGIN_TIMEOUT_MS = 120_000;
export const SHUTDOWN_TIMEOUT_MS = 3_000;
export const REQUEST_TIMEOUT_MS = 3_000;

export const CONFIG_DIR_NAME = "veryfront";
export const TOKEN_FILE_NAME = "token";
export const TOKEN_FILE_PERMISSIONS = 0o600;
