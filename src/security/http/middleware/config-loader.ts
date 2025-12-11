
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";
import type { SecurityConfig } from "./types.ts";
import { serverLogger } from "@veryfront/utils";

export function isValidSecurityConfig(config: unknown): config is SecurityConfig {
  if (!config || typeof config !== "object") return false;
  const cfg = config as Record<string, unknown>;

  if (cfg.csp !== undefined && typeof cfg.csp !== "object") return false;

  if (cfg.cors !== undefined) {
    if (typeof cfg.cors !== "boolean" && typeof cfg.cors !== "object") return false;
  }

  if (cfg.coop !== undefined && typeof cfg.coop !== "string") return false;
  if (cfg.corp !== undefined && typeof cfg.corp !== "string") return false;
  if (cfg.coep !== undefined && typeof cfg.coep !== "string") return false;

  return true;
}

export async function loadSecurityConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<SecurityConfig | null> {
  try {
    const { getConfig } = await import("@veryfront/config");
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
