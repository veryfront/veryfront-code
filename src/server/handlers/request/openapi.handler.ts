import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_OK, HTTP_SERVER_ERROR, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { ApiRouteMatcher } from "#veryfront/routing/api/api-route-matcher.ts";
import { discoverAppRoutes, discoverPagesRoutes } from "#veryfront/routing/api/route-discovery.ts";
import {
  generateOpenAPISpec,
  specToJson,
  specToYaml,
} from "#veryfront/routing/api/openapi/spec-generator.ts";
import type { OpenAPISpec } from "#veryfront/routing/api/openapi/types.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { logger as baseLogger } from "#veryfront/utils";
import {
  createOpenAPIResponseBuilder,
  createOpenAPIUnavailableResponse,
  snapshotOpenAPIHostExecutionPermission,
  snapshotOpenAPIRequestLocality,
} from "./openapi-policy.ts";

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

    const url = new URL(req.url);
    const { yamlPath } = this.getPaths(ctx);
    const isYaml = url.pathname === yamlPath;
    const isLocalProject = snapshotOpenAPIRequestLocality(ctx);
    const allowHostProjectCodeExecution = snapshotOpenAPIHostExecutionPermission(
      ctx,
      isLocalProject,
    );

    // Route metadata currently lives on executable exports. Until metadata
    // inspection is worker-owned, remote and unknown projects must not cause
    // their route modules to be imported into the server process.
    if (!allowHostProjectCodeExecution) {
      return this.respond(createOpenAPIUnavailableResponse(req, ctx));
    }

    try {
      const spec = await this.getOrGenerateSpec(
        ctx,
        url,
        isLocalProject,
        allowHostProjectCodeExecution,
      );
      const content = isYaml ? specToYaml(spec) : specToJson(spec);

      const response = createOpenAPIResponseBuilder(ctx, isLocalProject)
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

      const errorResponse = createOpenAPIResponseBuilder(ctx, isLocalProject)
        .withCache("no-store")
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .json(
          {
            error: "Failed to generate OpenAPI specification",
            message: isLocalProject ? String(error) : undefined,
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

  private async getOrGenerateSpec(
    ctx: HandlerContext,
    url: URL,
    isLocalProject: boolean,
    allowHostProjectCodeExecution: boolean,
  ): Promise<OpenAPISpec> {
    const discover = async (): Promise<OpenAPISpec> => {
      const router = new ApiRouteMatcher();
      try {
        const pagesDir = ctx.config?.directories?.pages ?? "pages";
        const appDirName = ctx.config?.directories?.app ?? "app";

        const apiDir = join(ctx.projectDir, pagesDir, "api");
        if (await ctx.adapter.fs.exists(apiDir)) {
          await discoverPagesRoutes(router, apiDir, "/api", ctx.adapter);
        }

        const appDir = join(ctx.projectDir, appDirName);
        if (await ctx.adapter.fs.exists(appDir)) {
          await discoverAppRoutes(router, appDir, "", ctx.adapter);
        }

        const serverUrl = `${url.protocol}//${url.host}`;
        return await generateOpenAPISpec(router, ctx.projectDir, ctx.adapter, ctx.config, {
          isLocalProject,
          allowHostProjectCodeExecution,
          servers: [{ url: serverUrl, description: "Current server" }],
        });
      } finally {
        router.destroy();
      }
    };

    const spec = await discover();

    logger.debug("Generated spec", {
      pathCount: Object.keys(spec.paths).length,
      isLocalProject,
    });

    return spec;
  }
}
