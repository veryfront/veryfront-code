import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { HTTP_OK, HTTP_SERVER_ERROR, PRIORITY_HIGH_DEV } from "#veryfront/utils/constants/index.ts";
import { DynamicRouter } from "#veryfront/routing/api/api-route-matcher.ts";
import { discoverAppRoutes, discoverPagesRoutes } from "#veryfront/routing/api/route-discovery.ts";
import { generateOpenAPISpec, specToYaml } from "#veryfront/routing/api/openapi/spec-generator.ts";
import type { OpenAPISpec } from "#veryfront/routing/api/openapi/types.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import {
  type ExtendedFileSystemAdapter,
  isExtendedFSAdapter,
} from "#veryfront/platform/adapters/fs/wrapper.ts";

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

    try {
      const spec = await this.getOrGenerateSpec(ctx, url);
      const content = isYaml ? specToYaml(spec) : JSON.stringify(spec, null, 2);
      const isDev = !!ctx.isLocalProject;

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
    const isDev = !!ctx.isLocalProject;
    const branch = ctx.parsedDomain?.branch ?? "";
    const currentKey = `${ctx.projectDir}:${ctx.projectSlug || "default"}:${branch}:${ctx.releaseId ?? ""}`;

    if (!isDev && this.cachedSpec && this.cacheKey === currentKey) return this.cachedSpec;

    const discover = async (): Promise<OpenAPISpec> => {
      const router = new DynamicRouter();
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
      });
    };

    // In proxy mode, wrap discovery in runWithContext so VFS can resolve files.
    // Requires both extended FS adapter AND multi-project mode support.
    const extFs = isExtendedFSAdapter(ctx.adapter.fs) ? ctx.adapter.fs : null;
    const needsContext = !isDev && ctx.projectSlug && ctx.proxyToken &&
      extFs?.isMultiProjectMode();

    const spec = needsContext
      ? await (extFs as ExtendedFileSystemAdapter).runWithContext(
        ctx.projectSlug!,
        ctx.proxyToken!,
        discover,
        ctx.projectId,
        {
          productionMode: ctx.resolvedEnvironment === "production",
          releaseId: ctx.releaseId,
          branch: ctx.parsedDomain?.branch ?? null,
          environmentName: ctx.environmentName,
        },
      )
      : await discover();

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
