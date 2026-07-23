import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_OK,
  HTTP_SERVER_ERROR,
  PRIORITY_HIGH_DEV,
} from "#veryfront/utils/constants/index.ts";
import { specToYaml } from "#veryfront/routing/api/openapi/spec-generator.ts";
import { assertOpenAPIDocumentSize } from "#veryfront/routing/api/openapi/spec-validation.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";
import { getBaseLogger } from "#veryfront/utils";
import { OpenAPISpecService } from "./openapi-spec-service.ts";

export { __injectOpenAPIHandlerDepsForTests } from "./openapi-spec-service.ts";

const logger = getBaseLogger("SERVER").component("open-api");
const DEFAULT_JSON_PATH = "/_openapi.json";
const DEFAULT_YAML_PATH = "/_openapi.yaml";
const SPEC_CACHE_MAX_AGE_SECONDS = 3_600;

export class OpenAPIHandler extends BaseHandler {
  readonly #specService = new OpenAPISpecService();

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

    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return this.respond(
        this.createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withCache("no-store")
          .withAllow(["GET", "HEAD"])
          .text("Method Not Allowed", HTTP_METHOD_NOT_ALLOWED),
      );
    }

    const url = new URL(req.url);
    const isYaml = url.pathname === this.getPaths(ctx).yamlPath;
    try {
      const spec = await this.#specService.getOrGenerate(ctx, url);
      const content = isYaml ? specToYaml(spec) : JSON.stringify(spec, null, 2);
      assertOpenAPIDocumentSize(content);
      const response = this.createResponseBuilder(ctx)
        .withCache(
          ctx.isLocalProject ? "no-cache" : { maxAge: SPEC_CACHE_MAX_AGE_SECONDS, public: true },
        )
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withContentType(
          isYaml ? "text/yaml; charset=utf-8" : "application/json; charset=utf-8",
          method === "HEAD" ? null : content,
          HTTP_OK,
        );
      return this.respond(response);
    } catch (error) {
      logger.error("Failed to generate OpenAPI specification", {
        errorCategory: classifyTelemetryError(error),
      });
      return this.respond(
        this.createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withCache("no-store")
          .json(
            {
              error: "Failed to generate OpenAPI specification",
              message: ctx.isLocalProject
                ? "Check your API route files for invalid modules, then retry."
                : undefined,
            },
            HTTP_SERVER_ERROR,
          ),
      );
    }
  }

  private getPaths(ctx: HandlerContext): { jsonPath: string; yamlPath: string } {
    return {
      jsonPath: ctx.config?.openapi?.paths?.json ?? DEFAULT_JSON_PATH,
      yamlPath: ctx.config?.openapi?.paths?.yaml ?? DEFAULT_YAML_PATH,
    };
  }
}
