/**
 * Centralized CLI constants
 *
 * Network, timeout, and configuration constants shared across CLI modules.
 * UI-specific constants remain in cli/ui/constants.ts
 *
 * @module cli/shared/constants
 */

import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";

// =============================================================================
// Network Ports
// =============================================================================

/** Default port for the dev server */
export const DEFAULT_DEV_PORT = 3000;

/** Default port for the proxy server */
export const DEFAULT_PROXY_PORT = 8080;

/** Default port for MCP server */
export const DEFAULT_MCP_PORT = 8080;

/** Default port for OAuth callback server */
export const DEFAULT_CALLBACK_PORT = 9876;

/** Maximum attempts to find an available port */
export const MAX_PORT_ATTEMPTS = 100;

// =============================================================================
// API URLs
// =============================================================================

/** Default Veryfront API URL */
export const DEFAULT_API_URL = "https://api.veryfront.com";

/** Default local API URL for development */
export const DEFAULT_LOCAL_API_URL = "http://api.lvh.me:4000";

/** Get API URL from runtime environment or default */
export function getApiUrl(env: RuntimeEnv = getRuntimeEnv()): string {
  return env.apiUrl ?? DEFAULT_API_URL;
}

// =============================================================================
// Timeouts
// =============================================================================

/** Timeout for OAuth login flow (2 minutes) */
export const DEFAULT_LOGIN_TIMEOUT_MS = 120_000;

/** Timeout for graceful shutdown */
export const SHUTDOWN_TIMEOUT_MS = 3_000;

/** Timeout for dev server client requests */
export const REQUEST_TIMEOUT_MS = 3_000;

// =============================================================================
// Token & Config Storage
// =============================================================================

/** Config directory name (~/.veryfront/) */
export const CONFIG_DIR_NAME = "veryfront";

/** Token file name */
export const TOKEN_FILE_NAME = "token";

/** Token file permissions (owner read/write only) */
export const TOKEN_FILE_PERMISSIONS = 0o600;
