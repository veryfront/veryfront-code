/**
 * OpenAPI Handler
 *
 * Serves automatically generated OpenAPI specification at /_openapi.json and /_openapi.yaml.
 * Discovers routes, extracts OpenAPI metadata from wrapped handlers, and builds the spec.
 *
 * @module server/handlers/request/openapi-handler
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_OK, HTTP_SERVER_ERROR, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { DynamicRouter } from "#veryfront/routing/api/api-route-matcher.ts";
import { discoverAppRoutes, discoverPagesRoutes } from "#veryfront/routing/api/route-discovery.ts";
import { generateOpenAPISpec, specToYaml } from "#veryfront/routing/api/openapi/spec-generator.ts";
import type { OpenAPISpec } from "#veryfront/routing/api/openapi/types.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { logger } from "#veryfront/utils";

/** Default paths for OpenAPI spec endpoints */
const DEFAULT_JSON_PATH = "/_openapi.json";
const DEFAULT_YAML_PATH = "/_openapi.yaml";

export class OpenAPIHandler extends BaseHandler {
  /** Cache for generated spec (production only) */
  private cachedSpec: OpenAPISpec | null = null;
  private cacheKey: string | null = null;

  metadata: HandlerMetadata = {
    name: "OpenAPIHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [
      { pattern: DEFAULT_JSON_PATH, exact: true },
      { pattern: DEFAULT_YAML_PATH, exact: true },
    ],
    // Enable by default, can be disabled via config.openapi.enabled = false
    enabled: (ctx) => ctx.config?.openapi?.enabled !== false,
  };

  /**
   * Check if request matches configured paths.
   */
  protected override shouldHandle(req: Request, ctx: HandlerContext): boolean {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const jsonPath = ctx.config?.openapi?.paths?.json || DEFAULT_JSON_PATH;
    const yamlPath = ctx.config?.openapi?.paths?.yaml || DEFAULT_YAML_PATH;

    return pathname === jsonPath || pathname === yamlPath;
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const url = new URL(req.url);
    const yamlPath = ctx.config?.openapi?.paths?.yaml || DEFAULT_YAML_PATH;
    const isYaml = url.pathname === yamlPath;

    try {
      const spec = await this.getOrGenerateSpec(ctx, url);

      const content = isYaml ? specToYaml(spec) : JSON.stringify(spec, null, 2);

      const isDev = ctx.requestContext?.isLocalDev ?? false;
      const response = this.createResponseBuilder(ctx)
        .withCache(!isDev ? { maxAge: 3600, public: true } : "no-cache")
        .withCORS(req, { origin: "*" })
        .withContentType(
          isYaml ? "text/yaml; charset=utf-8" : "application/json; charset=utf-8",
          content,
          HTTP_OK,
        );

      return this.respond(response);
    } catch (error) {
      logger.error("[OpenAPI] Failed to generate spec:", { error: String(error) });

      const errorResponse = this.createResponseBuilder(ctx)
        .withCache("no-cache")
        .json(
          {
            error: "Failed to generate OpenAPI specification",
            message: ctx.requestContext?.isLocalDev ? String(error) : undefined,
          },
          HTTP_SERVER_ERROR,
        );

      return this.respond(errorResponse);
    }
  }

  /**
   * Get cached spec or generate a new one.
   * Caching is only enabled in production mode (non-local-dev).
   */
  private async getOrGenerateSpec(ctx: HandlerContext, url: URL): Promise<OpenAPISpec> {
    const isDev = ctx.requestContext?.isLocalDev ?? false;
    // Create cache key based on project
    const currentKey = `${ctx.projectDir}:${ctx.projectSlug || "default"}`;

    // Return cached spec in production (non-local-dev)
    if (this.cachedSpec && this.cacheKey === currentKey && !isDev) {
      return this.cachedSpec;
    }

    // Discover routes
    const router = new DynamicRouter();

    // Discover Pages Router routes (pages/api/*)
    const pagesDir = ctx.config?.directories?.pages || "pages";
    const apiDir = join(ctx.projectDir, pagesDir, "api");

    try {
      const apiDirExists = await ctx.adapter.fs.exists(apiDir);
      if (apiDirExists) {
        await discoverPagesRoutes(router, apiDir, "/api", ctx.adapter);
      }
    } catch {
      // Ignore - pages/api may not exist
    }

    // Discover App Router routes (app/api/*)
    const appDirName = ctx.config?.directories?.app || "app";
    const appApiDir = join(ctx.projectDir, appDirName, "api");

    try {
      const appApiDirExists = await ctx.adapter.fs.exists(appApiDir);
      if (appApiDirExists) {
        await discoverAppRoutes(router, appApiDir, "/api", ctx.adapter);
      }
    } catch {
      // Ignore - app/api may not exist
    }

    // Also discover from app root for catch-all API routes
    const appDir = join(ctx.projectDir, appDirName);
    try {
      const appDirExists = await ctx.adapter.fs.exists(appDir);
      if (appDirExists) {
        await discoverAppRoutes(router, appDir, "", ctx.adapter);
      }
    } catch {
      // Ignore
    }

    // Generate spec with server URL
    const serverUrl = `${url.protocol}//${url.host}`;
    const spec = await generateOpenAPISpec(router, ctx.projectDir, ctx.adapter, ctx.config, {
      servers: [{ url: serverUrl, description: "Current server" }],
    });

    // Cache in production mode (non-local-dev)
    if (!isDev) {
      this.cachedSpec = spec;
      this.cacheKey = currentKey;
    }

    logger.debug("[OpenAPI] Generated spec", {
      pathCount: Object.keys(spec.paths).length,
      isDev,
    });

    return spec;
  }
}
