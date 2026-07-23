import type { RuntimeAdapter, RuntimeResponse } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { isConfigOptionalControlPlaneRunRequest } from "#veryfront/channels/control-plane.ts";
import { MiddlewareContext } from "#veryfront/middleware/core/context.ts";
import { RuntimeMiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import { getProjectEnvSnapshot } from "#veryfront/server/project-env";
import {
  loadMiddlewareFile,
  MAX_MIDDLEWARE_FUNCTIONS,
  type MiddlewareFunction,
  PROJECT_MIDDLEWARE_FILES,
  validateMiddlewareFunctionList,
} from "#veryfront/server/dev-server/middleware.ts";
import type { HandlerContext } from "#veryfront/types";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { serverLogger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { createProjectCodeUnavailableResponse } from "../utils/project-code-isolation.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";

const DEFAULT_MAX_ENTRIES = 100;
const MAX_CACHE_IDENTITY_BYTES = 512;
const MAX_CACHE_PROJECT_DIR_BYTES = 4_096;
const textEncoder = new TextEncoder();
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
  next: () => Promise<RuntimeResponse | undefined>;
}

function cacheSegment(value: string, maxBytes = MAX_CACHE_IDENTITY_BYTES): string | null {
  if (
    value.length === 0 || textEncoder.encode(value).byteLength > maxBytes ||
    containsControlCharacter(value)
  ) {
    return null;
  }
  try {
    return encodeURIComponent(value);
  } catch (_) {
    return null;
  }
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
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
  readonly #adapterIdentities = new WeakMap<RuntimeAdapter, number>();
  #nextAdapterIdentity = 1;

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
    if (!expectedProject) return 0;
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

  async execute(input: ProjectMiddlewareRuntimeContext): Promise<RuntimeResponse | undefined> {
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
    const executeMiddleware = async (): Promise<RuntimeResponse | undefined> => {
      if (ctx.isLocalProject === false || (isSharedProxy && ctx.isLocalProject !== true)) {
        if (await this.#hasRemoteProjectMiddleware(ctx)) {
          return createProjectCodeUnavailableResponse(request);
        }
        return next();
      }

      const middleware = await this.#getMiddleware(ctx, environment, branch);
      if (middleware.length === 0) return next();

      const pipeline = new RuntimeMiddlewarePipeline();
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

  async #hasRemoteProjectMiddleware(ctx: HandlerContext): Promise<boolean> {
    const customMiddleware = ctx.config?.middleware?.custom;
    if (customMiddleware !== undefined) {
      if (!Array.isArray(customMiddleware) || customMiddleware.length > 0) return true;
    }

    try {
      for (const file of PROJECT_MIDDLEWARE_FILES) {
        if (await ctx.adapter.fs.exists(join(ctx.projectDir, file))) return true;
      }
      return false;
    } catch (error) {
      logger.error("Unable to verify remote project middleware", {
        errorCategory: classifyTelemetryError(error),
      });
      return true;
    }
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
    const projectSegment = cacheSegment(projectIdentity);
    const sourceSegment = cacheSegment(sourceIdentity);
    const environmentSegment = cacheSegment(environmentIdentity);
    const projectDirSegment = cacheSegment(ctx.projectDir, MAX_CACHE_PROJECT_DIR_BYTES);
    if (!projectSegment || !sourceSegment || !environmentSegment || !projectDirSegment) return null;

    let adapterIdentity = this.#adapterIdentities.get(ctx.adapter);
    if (adapterIdentity === undefined) {
      adapterIdentity = this.#nextAdapterIdentity++;
      this.#adapterIdentities.set(ctx.adapter, adapterIdentity);
    }
    return [
      projectSegment,
      `adapter-${adapterIdentity}`,
      projectDirSegment,
      environment,
      sourceSegment,
      environmentSegment,
    ].join(":");
  }

  async #load(ctx: HandlerContext): Promise<readonly MiddlewareFunction[]> {
    try {
      const customMiddleware = validateMiddlewareFunctionList(
        ctx.config?.middleware?.custom ?? [],
        "custom middleware configuration",
        true,
      );
      const fileMiddleware = validateMiddlewareFunctionList(
        await this.#loadMiddleware(ctx.projectDir, ctx.adapter),
        "loaded middleware",
        true,
      );
      if (fileMiddleware.length + customMiddleware.length > MAX_MIDDLEWARE_FUNCTIONS) {
        throw new TypeError("Invalid middleware configuration: too many functions");
      }
      return Object.freeze([...fileMiddleware, ...customMiddleware]);
    } catch (error) {
      logger.error("Failed to load project middleware", {
        environment: resolvedEnvironment(ctx),
        failureCategory: classifyTelemetryError(error),
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
