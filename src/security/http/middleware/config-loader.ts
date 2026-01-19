/**
 * Security configuration loader
 *
 * @module security/middleware/config-loader
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/index.ts";
import type { SecurityConfig } from "./types.ts";
import { serverLogger } from "#veryfront/utils";

/**
 * Validates security configuration structure
 *
 * @param config - Unknown configuration to validate
 * @returns True if configuration is valid SecurityConfig
 *
 * @example
 * ```ts
 * const valid = isValidSecurityConfig({ csp: {}, cors: true })
 * console.log(valid) // true
 * ```
 */
export function isValidSecurityConfig(config: unknown): config is SecurityConfig {
  if (!config || typeof config !== "object") return false;
  const cfg = config as Record<string, unknown>;

  // Validate CSP if present
  if (cfg.csp !== undefined && typeof cfg.csp !== "object") return false;

  // Validate CORS if present
  if (cfg.cors !== undefined) {
    if (typeof cfg.cors !== "boolean" && typeof cfg.cors !== "object") return false;
  }

  // Validate string fields
  if (cfg.coop !== undefined && typeof cfg.coop !== "string") return false;
  if (cfg.corp !== undefined && typeof cfg.corp !== "string") return false;
  if (cfg.coep !== undefined && typeof cfg.coep !== "string") return false;

  return true;
}

/**
 * Load security configuration from project config
 *
 * @param projectDir - Project directory path
 * @param adapter - Runtime adapter for environment access
 * @returns Security configuration or null if not found/invalid
 *
 * @example
 * ```ts
 * const config = await loadSecurityConfig('/path/to/project', adapter)
 * if (config) {
 *   console.log('CSP:', config.csp)
 * }
 * ```
 */
export async function loadSecurityConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<SecurityConfig | null> {
  try {
    const { getConfig } = await import("#veryfront/config");
    const cfg = await getConfig(projectDir, adapter);
    const securityConfig = (cfg as Record<string, unknown>)?.security;

    if (!securityConfig) return null;
    if (!isValidSecurityConfig(securityConfig)) {
      serverLogger.warn("Invalid security configuration structure, ignoring");
      return null;
    }

    return securityConfig;
  } catch {
    return null;
  }
}
