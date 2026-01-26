import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { serverLogger } from "../../../utils/index.js";
import type { SecurityConfig } from "./types.js";

export function isValidSecurityConfig(config: unknown): config is SecurityConfig {
  if (config == null || typeof config !== "object") return false;

  const cfg = config as Record<string, unknown>;

  if (cfg.csp !== undefined && (cfg.csp == null || typeof cfg.csp !== "object")) return false;

  if (
    cfg.cors !== undefined && typeof cfg.cors !== "boolean" &&
    (cfg.cors == null || typeof cfg.cors !== "object")
  ) {
    return false;
  }

  if (cfg.coop !== undefined && typeof cfg.coop !== "string") return false;
  if (cfg.corp !== undefined && typeof cfg.corp !== "string") return false;
  if (cfg.coep !== undefined && typeof cfg.coep !== "string") return false;

  return true;
}

export function loadSecurityConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<SecurityConfig | null> {
  return withSpan(
    "security.config.load",
    async () => {
      try {
        const { getConfig } = await import("../../../config/index.js");
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
    },
    { "security.projectDir": projectDir },
  );
}
