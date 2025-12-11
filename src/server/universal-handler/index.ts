
import { serverLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { metrics } from "@veryfront/observability/simple-metrics/index.ts";

import type { HandlerContext } from "../handlers/types.ts";
import { RouteRegistry } from "@veryfront/routing/registry/index.ts";
import { SecurityConfigLoader } from "@veryfront/security/http/config.ts";
import { getConfig } from "@veryfront/config/loader.ts";
import type { VeryfrontConfig } from "@veryfront/config";

import { AuthHandler } from "@veryfront/security/http/auth.ts";
import { CorsHandler } from "../handlers/response/cors.ts";
import { HealthHandler } from "../handlers/monitoring/health.ts";
import { MetricsHandler } from "../handlers/monitoring/metrics.ts";
import { ClientLogHandler } from "../handlers/monitoring/client-log.ts";
import { DevEndpointsHandler } from "../handlers/dev/endpoints.ts";
import { DevFileHandler } from "../handlers/dev/files/index.ts";
import { StaticHandler } from "../handlers/request/static.ts";
import { LibModulesHandler } from "../handlers/request/lib-modules-handler.ts";
import { RSCHandler } from "../handlers/request/rsc/index.ts";
import { ModuleHandler } from "../handlers/request/module/index.ts";
import { ApiHandlerWrapper } from "../handlers/request/api/index.ts";
import { SSRHandler } from "../handlers/request/ssr/index.ts";
import { NotFoundHandler } from "../handlers/response/not-found.ts";

export interface UniversalHandlerOptions {
  projectDir: string;
  debug?: boolean;
  mode?: "development" | "production";
  moduleServerUrl?: string;
}

export function createVeryfrontHandler(
  projectDir: string,
  adapter: RuntimeAdapter,
  opts: UniversalHandlerOptions = { projectDir },
): ((req: Request) => Promise<Response>) & { ready?: Promise<void> } {
  const logDebug = (message: string, extra?: Record<string, unknown>) => {
    try {
      const shouldDebug = opts.debug || adapter.env.get("VERYFRONT_DEBUG");
      if (shouldDebug) {
        if (extra && typeof extra === "object" && !Array.isArray(extra)) {
          logger.debug(message, extra);
        } else {
          logger.debug(message);
        }
      }
    } catch (err) {
      logger.error("Debug logging failed:", err);
    }
  };

  logDebug("[universal] handler initialized", { projectDir });

  const securityLoader = new SecurityConfigLoader(projectDir, adapter);

  let config: VeryfrontConfig | undefined;
  const configPromise = getConfig(projectDir, adapter).then((c) => {
    config = c;
    return c;
  }).catch((err) => {
    logger.warn("[universal] Failed to load config, using defaults", {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  });

  const registry = new RouteRegistry({
    debug: opts.debug,
    enableMetrics: true,
  });

  const apiHandler = new ApiHandlerWrapper(projectDir, adapter);

  registry.registerAll([
    new AuthHandler(),
    new CorsHandler(),
    new HealthHandler(),
    new MetricsHandler(),
    new ClientLogHandler(),
    new DevEndpointsHandler(),
    new DevFileHandler(),
    new StaticHandler(),
    new LibModulesHandler(), // Priority: 550 (MEDIUM_LIB_MODULES, self-hosted veryfront/ai