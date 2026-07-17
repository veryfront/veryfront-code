import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { isConfigOptionalControlPlaneRunRequest } from "#veryfront/channels/control-plane.ts";
import { MiddlewareContext } from "#veryfront/middleware/core/context.ts";
import { MiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import { getProjectEnvSnapshot } from "#veryfront/server/project-env";
import {
  loadMiddlewareFile,
  type MiddlewareFunction,
} from "#veryfront/server/dev-server/middleware.ts";
import type { HandlerContext } from "#veryfront/types";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { serverLogger } from "#veryfront/utils";

const DEFAULT_MAX_ENTRIES = 100;
const logger = serverLogger.component("project-middleware");

type MiddlewareLoader = (
  projectDir: string,
  adapter: RuntimeAdapter,
) => Promise<MiddlewareFunction[]>;

interface ProjectMiddlewareRuntimeOptions {
  maxEntries?: number;
  loadMiddleware?: MiddlewareLoader;
  registryName?: string;
}

export interface ProjectMiddlewareRuntimeContext {
  request: Request;
  handlerContext: HandlerContext;
  isSharedProxy: boolean;
  next: () => Promise<Response | undefined>;
}

function cacheSegment(value: string): string {
  return encodeURIComponent(value);
}

function resolvedEnvironment(ctx: HandlerContext): "production" | "preview" {
  return ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview";
}

function resolvedBranch(ctx: HandlerContext): string | null {
  return ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ?? null;
}

/** Request-scoped root middleware loader for every project runtime. */
export class ProjectMiddlewareRuntime {
  readonly #cache: LRUCache<string, Promise<readonly MiddlewareFunction[]>>;
  readonly #loadMiddleware: MiddlewareLoader;

  constructor(options: ProjectMiddlewareRuntimeOptions = {}) {
    this.#cache = new LRUCache({
      maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
    });
    this.#loadMiddleware = options.loadMiddleware ??
      ((projectDir, adapter) => loadMiddlewareFile(projectDir, adapter, { throwOnError: true }));

    if (options.registryName) {
      registerLRUCache(options.registryName, this.#cache);
    }
  }

  get size(): number {
    return this.#cache.size;
  }

  invalidateProject(projectIdentity: string): number {
    const expectedProject = cacheSegment(projectIdentity);
    let deleted = 0;

    for (const key of [...this.#cache.keys()]) {
      if (key.split(":", 1)[0] !== expectedProject) continue;
      if (this.#cache.delete(key)) deleted++;
    }

    return deleted;
  }

  clear(): void {
    this.#cache.clear();
  }

  async execute(input: ProjectMiddlewareRuntimeContext): Promise<Response | undefined> {
    const { handlerContext: ctx, isSharedProxy, next, request } = input;

    if (
      isConfigOptionalControlPlaneRunRequest(
        request.method,
        new URL(request.url).pathname,
      )
    ) {
      return next();
    }

    const environment = resolvedEnvironment(ctx);
    const branch = resolvedBranch(ctx);
    const executeMiddleware = async (): Promise<Response | undefined> => {
      const middleware = await this.#getMiddleware(ctx, environment, branch);
      if (middleware.length === 0) return next();

      const pipeline = new MiddlewarePipeline();
      for (const handler of middleware) pipeline.use(handler);

      const composed = pipeline.compose();
      const middlewareContext = new MiddlewareContext(
        request,
        getProjectEnvSnapshot() ?? {},
      );
      return await composed(middlewareContext, next);
    };

    const fs = ctx.adapter.fs;
    if (
      !isSharedProxy || ctx.isLocalProject || !ctx.projectSlug || !ctx.proxyToken ||
      !isExtendedFSAdapter(fs) || !fs.isMultiProjectMode()
    ) {
      return await executeMiddleware();
    }

    return fs.runWithContext(
      ctx.projectSlug,
      ctx.proxyToken,
      executeMiddleware,
      ctx.projectId,
      {
        productionMode: environment === "production",
        releaseId: ctx.releaseId ?? null,
        branch,
        environmentName: ctx.environmentName ?? null,
      },
    );
  }

  async #getMiddleware(
    ctx: HandlerContext,
    environment: "production" | "preview",
    branch: string | null,
  ): Promise<readonly MiddlewareFunction[]> {
    const key = this.#buildCacheKey(ctx, environment, branch);
    if (!key) return this.#load(ctx);

    let pending = this.#cache.get(key);
    if (!pending) {
      pending = Promise.resolve().then(() => this.#load(ctx));
      this.#cache.set(key, pending);
    }

    try {
      return await pending;
    } catch (error) {
      if (this.#cache.get(key) === pending) this.#cache.delete(key);
      throw error;
    }
  }

  #buildCacheKey(
    ctx: HandlerContext,
    environment: "production" | "preview",
    branch: string | null,
  ): string | null {
    const projectIdentity = ctx.projectId ?? ctx.projectSlug;
    if (!projectIdentity) return null;

    const sourceIdentity = environment === "production" ? ctx.releaseId : branch ?? "default";
    if (!sourceIdentity) return null;

    const environmentIdentity = ctx.environmentId ?? ctx.environmentName ?? "default";
    return [
      cacheSegment(projectIdentity),
      environment,
      cacheSegment(sourceIdentity),
      cacheSegment(environmentIdentity),
    ].join(":");
  }

  async #load(ctx: HandlerContext): Promise<readonly MiddlewareFunction[]> {
    try {
      const fileMiddleware = await this.#loadMiddleware(ctx.projectDir, ctx.adapter);
      return [...fileMiddleware, ...(ctx.config?.middleware?.custom ?? [])];
    } catch (error) {
      logger.error("Failed to load project middleware", {
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        releaseId: ctx.releaseId,
        branch: resolvedBranch(ctx),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const projectMiddlewareRuntime = new ProjectMiddlewareRuntime({
  registryName: "project-middleware-cache",
});

export function invalidateProjectMiddlewareCache(
  projectSlug: string,
  projectId?: string,
): number {
  const identities = new Set([projectSlug, projectId].filter((value): value is string => !!value));
  let deleted = 0;
  for (const identity of identities) {
    deleted += projectMiddlewareRuntime.invalidateProject(identity);
  }
  return deleted;
}
