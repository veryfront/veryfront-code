import { getRuntimeEnv, type RuntimeEnv } from "@veryfront/config/runtime-env.ts";

export const DEFAULT_API_URL = "https://api.veryfront.com";
export const DEFAULT_CALLBACK_PORT = 9876;
export const DEFAULT_LOGIN_TIMEOUT_MS = 120000;
export const MAX_PORT_ATTEMPTS = 100;
export const TOKEN_FILE_PERMISSIONS = 0o600;
export const CONFIG_DIR_NAME = "veryfront";
export const TOKEN_FILE_NAME = "token";

/**
 * Get API URL from environment or default.
 *
 * @param env - Optional RuntimeEnv for test isolation
 */
export function getApiUrl(env: RuntimeEnv = getRuntimeEnv()): string {
  return env.apiUrl || DEFAULT_API_URL;
}
