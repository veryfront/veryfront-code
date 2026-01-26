import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.js";
import { HTTP_OK, HTTP_SERVER_ERROR, PRIORITY_HIGH_DEV } from "../../../utils/constants/index.js";
import { DynamicRouter } from "../../../routing/api/api-route-matcher.js";
import { discoverAppRoutes, discoverPagesRoutes } from "../../../routing/api/route-discovery.js";
import { generateOpenAPISpec, specToYaml } from "../../../routing/api/openapi/spec-generator.js";
import type { OpenAPISpec } from "../../../routing/api/openapi/types.js";
import { join } from "../../../platform/compat/path/index.js";
import { logger } from "../../../utils/index.js";

const DEFAULT_JSON_PATH = "/_openapi.json";
const DEFAULT_YAML_PATH = "/_openapi.yaml";

export class OpenAPIHandler extends BaseHandler {
  private cachedSpec: OpenAPISpec | null = null;
  private cacheKey: string | null = null;

  metadata: HandlerMetadata = {
    name: "OpenAPIHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [
      { pattern: DEFAULT_JSON_PATH, exact: true },
      { pattern: DEFAULT_YAML_PATH, exact: true },
    ],
    enabled: (ctx) => ctx.config?.openapi?.enabled !== false,
  };

  protected override shouldHandle(req: dntShim.Request, ctx: HandlerContext): boolean {
    const { pathname } = new URL(req.url);
    const jsonPath = ctx.config?.openapi?.paths?.json ?? DEFAULT_JSON_PATH;
    const yamlPath = ctx.config?.openapi?.paths?.yaml ?? DEFAULT_YAML_PATH;

    return pathname === jsonPath || pathname === yamlPath;
  }

  async handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();

    const url = new URL(req.url);
    const yamlPath = ctx.config?.openapi?.paths?.yaml ?? DEFAULT_YAML_PATH;
    const isYaml = url.pathname === yamlPath;

    try {
      const spec = await this.getOrGenerateSpec(ctx, url);
      const content = isYaml ? specToYaml(spec) : JSON.stringify(spec, null, 2);
      const isDev = ctx.requestContext?.isLocalDev ?? false;

      const response = this.createResponseBuilder(ctx)
        .withCache(isDev ? "no-cache" : { maxAge: 3600, public: true })
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

  private async getOrGenerateSpec(ctx: HandlerContext, url: URL): Promise<OpenAPISpec> {
    const isDev = ctx.requestContext?.isLocalDev ?? false;
    const currentKey = `${ctx.projectDir}:${ctx.projectSlug || "default"}`;

    if (!isDev && this.cachedSpec && this.cacheKey === currentKey) {
      return this.cachedSpec;
    }

    const router = new DynamicRouter();
    const pagesDir = ctx.config?.directories?.pages ?? "pages";
    const appDirName = ctx.config?.directories?.app ?? "app";

    await this.tryDiscover(async () => {
      const apiDir = join(ctx.projectDir, pagesDir, "api");
      if (await ctx.adapter.fs.exists(apiDir)) {
        await discoverPagesRoutes(router, apiDir, "/api", ctx.adapter);
      }
    });

    await this.tryDiscover(async () => {
      const appApiDir = join(ctx.projectDir, appDirName, "api");
      if (await ctx.adapter.fs.exists(appApiDir)) {
        await discoverAppRoutes(router, appApiDir, "/api", ctx.adapter);
      }
    });

    await this.tryDiscover(async () => {
      const appDir = join(ctx.projectDir, appDirName);
      if (await ctx.adapter.fs.exists(appDir)) {
        await discoverAppRoutes(router, appDir, "", ctx.adapter);
      }
    });

    const serverUrl = `${url.protocol}//${url.host}`;
    const spec = await generateOpenAPISpec(router, ctx.projectDir, ctx.adapter, ctx.config, {
      servers: [{ url: serverUrl, description: "Current server" }],
    });

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

  private async tryDiscover(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      // Ignore - directory may not exist
    }
  }
}
