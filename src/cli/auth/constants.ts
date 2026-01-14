import { getEnv } from "@veryfront/platform/compat/process.ts";

export const DEFAULT_API_URL = "https://api.veryfront.com";
export const DEFAULT_CALLBACK_PORT = 9876;
export const DEFAULT_LOGIN_TIMEOUT_MS = 120000;
export const MAX_PORT_ATTEMPTS = 100;
export const TOKEN_FILE_PERMISSIONS = 0o600;
export const CONFIG_DIR_NAME = "veryfront";
export const TOKEN_FILE_NAME = "token";

export function getApiUrl(): string {
  return getEnv("VERYFRONT_API_URL") || DEFAULT_API_URL;
}
