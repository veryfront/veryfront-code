import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  HTTP_OK,
  HTTP_SERVER_ERROR,
  HTTP_UNAVAILABLE,
  PRIORITY_HIGH_DEV,
} from "#veryfront/utils/constants/index.ts";
import { ApiRouteMatcher } from "#veryfront/routing/api/api-route-matcher.ts";
import { discoverAppRoutes, discoverPagesRoutes } from "#veryfront/routing/api/route-discovery.ts";
import { generateOpenAPISpec, specToYaml } from "#veryfront/routing/api/openapi/spec-generator.ts";
import type { OpenAPISpec } from "#veryfront/routing/api/openapi/types.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("open-api");

const DEFAULT_JSON_PATH = "/_openapi.json";
const DEFAULT_YAML_PATH = "/_openapi.yaml";

export class OpenAPIHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "OpenAPIHandler",
    priority: PRIORITY_HIGH_DEV as HandlerPriority,
    patterns: [
      { pattern: DEFAULT_JSON_PATH, exact: true },
      { pattern: DEFAULT_YAML_PATH, exact: true },
    ],
    enabled: (ctx) => ctx.config?.openapi?.enabled !== false,
  };

  protected override shouldHandle(req: Request, ctx: HandlerContext): boolean {
    const { pathname } = new URL(req.url);
    const { jsonPath, yamlPath } = this.getPaths(ctx);

    return pathname === jsonPath || pathname === yamlPath;
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();

    // OpenAPI metadata currently lives on exported handler functions, so
    // generating it imports and evaluates every project route. Remote project
    // code must never cross that host-realm boundary. A future isolated/static
    // metadata format can replace this fail-closed response.
    if (ctx.isLocalProject !== true) {
      const response = this.createResponseBuilder(ctx)
        .withCache("no-cache")
        .json(
          { error: "Isolated OpenAPI generation is unavailable" },
          HTTP_UNAVAILABLE,
        );
      return this.respond(response);
    }

    const url = new URL(req.url);
    const { yamlPath } = this.getPaths(ctx);
    const isYaml = url.pathname === yamlPath;

    try {
      const spec = await this.getOrGenerateSpec(ctx, url);
      const content = isYaml ? specToYaml(spec) : JSON.stringify(spec, null, 2);

      const response = this.createResponseBuilder(ctx)
        .withCache("no-cache")
        .withCORS(req, ctx.securityConfig?.cors)
        .withContentType(
          isYaml ? "text/yaml; charset=utf-8" : "application/json; charset=utf-8",
          content,
          HTTP_OK,
        );

      return this.respond(response);
    } catch (error) {
      logger.error("Failed to generate spec:", { error: String(error) });

      const errorResponse = this.createResponseBuilder(ctx)
        .withCache("no-cache")
        .json(
          {
            error: "Failed to generate OpenAPI specification",
            message: ctx.isLocalProject ? String(error) : undefined,
          },
          HTTP_SERVER_ERROR,
        );

      return this.respond(errorResponse);
    }
  }

  private getPaths(ctx: HandlerContext): { jsonPath: string; yamlPath: string } {
    const jsonPath = ctx.config?.openapi?.paths?.json ?? DEFAULT_JSON_PATH;
    const yamlPath = ctx.config?.openapi?.paths?.yaml ?? DEFAULT_YAML_PATH;

    return { jsonPath, yamlPath };
  }

  private async getOrGenerateSpec(ctx: HandlerContext, url: URL): Promise<OpenAPISpec> {
    const discover = async (): Promise<OpenAPISpec> => {
      const router = new ApiRouteMatcher();
      const pagesDir = ctx.config?.directories?.pages ?? "pages";
      const appDirName = ctx.config?.directories?.app ?? "app";

      await this.tryDiscover(async () => {
        const apiDir = join(ctx.projectDir, pagesDir, "api");
        if (!(await ctx.adapter.fs.exists(apiDir))) return;
        await discoverPagesRoutes(router, apiDir, "/api", ctx.adapter);
      });

      await this.tryDiscover(async () => {
        const appApiDir = join(ctx.projectDir, appDirName, "api");
        if (!(await ctx.adapter.fs.exists(appApiDir))) return;
        await discoverAppRoutes(router, appApiDir, "/api", ctx.adapter);
      });

      await this.tryDiscover(async () => {
        const appDir = join(ctx.projectDir, appDirName);
        if (!(await ctx.adapter.fs.exists(appDir))) return;
        await discoverAppRoutes(router, appDir, "", ctx.adapter);
      });

      const serverUrl = `${url.protocol}//${url.host}`;
      return await generateOpenAPISpec(router, ctx.projectDir, ctx.adapter, ctx.config, {
        servers: [{ url: serverUrl, description: "Current server" }],
        allowHostProjectCodeExecution: true,
      });
    };

    const spec = await discover();

    logger.debug("Generated spec", {
      pathCount: Object.keys(spec.paths).length,
      isLocalProject: true,
    });

    return spec;
  }

  private async tryDiscover(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (_) {
      /* expected: directory may not exist */
    }
  }
}
