
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
    new AuthHandler(), // Priority: 0 (CRITICAL)
    new CorsHandler(), // Priority: 50
    new HealthHandler(), // Priority: 100 (HIGH)
    new MetricsHandler(), // Priority: 100 (HIGH)
    new ClientLogHandler(), // Priority: 200 (HIGH, dev only)
    new DevEndpointsHandler(), // Priority: 300 (HIGH, dev only)
    new DevFileHandler(), // Priority: 400 (dev only)
    new StaticHandler(), // Priority: 500 (MEDIUM_STATIC)
    new LibModulesHandler(), // Priority: 550 (MEDIUM_LIB_MODULES, self-hosted veryfront/ai/*)
    new RSCHandler(), // Priority: 600 (MEDIUM, runs before static to expose RSC endpoints)
    new ModuleHandler(), // Priority: 600 (MEDIUM)
    apiHandler, // Priority: 700 (MEDIUM)
    new SSRHandler(), // Priority: 1000 (LOW)
    new NotFoundHandler(), // Priority: 10000 (FALLBACK)
  ]);

  const readyPromise = apiHandler.initialize().catch((err) => {
    logger.error("[universal] API handler initialization failed", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  });

  const handler = async (req: Request): Promise<Response> => {
    await readyPromise;

    await securityLoader.ensureLoaded();

    await configPromise;

    const ctx: HandlerContext = {
      projectDir,
      adapter,
      mode: opts.mode ?? "production",
      moduleServerUrl: opts.moduleServerUrl,
      securityConfig: securityLoader.getSecurityConfig(),
      cspUserHeader: securityLoader.getCspUserHeader(),
      debug: opts.debug,
      config,
    };

    await metrics.incRequest();

    const response = await registry.execute(req, ctx);

    if (!response) {
      logDebug("[universal] No handler produced response (unexpected)", {
        path: new URL(req.url).pathname,
      });
      return new Response("Internal Server Error", { status: 500 });
    }

    return response;
  };

  handler.ready = readyPromise;

  return handler;
}

export type { HandlerContext } from "../handlers/types.ts";
export { RouteRegistry } from "@veryfront/routing/registry/index.ts";
export { BaseHandler } from "../handlers/response/base.ts";
