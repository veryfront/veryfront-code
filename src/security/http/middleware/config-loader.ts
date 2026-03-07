import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger } from "#veryfront/utils";
import type { SecurityConfig } from "./types.ts";

export function isValidSecurityConfig(config: unknown): config is SecurityConfig {
  if (config == null || typeof config !== "object") return false;

  const cfg = config as Record<string, unknown>;

  if (cfg.csp !== undefined && (cfg.csp == null || typeof cfg.csp !== "object")) return false;

  const cors = cfg.cors;
  if (
    cors !== undefined && typeof cors !== "boolean" && (cors == null || typeof cors !== "object")
  ) {
    return false;
  }

  const csrf = cfg.csrf;
  if (
    csrf !== undefined && typeof csrf !== "boolean" && (csrf == null || typeof csrf !== "object")
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
    async (): Promise<SecurityConfig | null> => {
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
      } catch (error) {
        serverLogger.debug("Failed to load security config", { error });
        return null;
      }
    },
    { "security.projectDir": projectDir },
  );
}
