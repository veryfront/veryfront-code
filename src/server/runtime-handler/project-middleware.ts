import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import {
  isConfigOptionalControlPlaneRunRequest,
  isSignedChannelDispatch,
  isSignedControlPlaneDispatch,
} from "#veryfront/channels/control-plane.ts";
import { MiddlewareContext } from "#veryfront/middleware/core/context.ts";
import { MiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import { getProjectEnvSnapshot } from "#veryfront/server/project-env";
import {
  loadMiddlewareFile,
  type MiddlewareFunction,
  ProjectMiddlewareHostExecutionDeniedError,
} from "#veryfront/server/dev-server/middleware.ts";
import {
  createErrorResponseFromDefinition,
  PROJECT_EXECUTION_UNAVAILABLE,
} from "#veryfront/errors";
import type { HandlerContext } from "#veryfront/types";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { serverLogger } from "#veryfront/utils";
import { isWebSocketPath } from "#veryfront/server/runtime-handler/request-utils.ts";
import { isHostProjectCodeExecutionAllowed } from "#veryfront/security/project-locality.ts";
import { createApplicationRequest } from "#veryfront/security/http/application-request.ts";
import { runWithRetainedPreviewDocumentSourceSnapshot } from "../handlers/request/source-snapshot-freshness.ts";

const DEFAULT_MAX_ENTRIES = 100;
const logger = serverLogger.component("project-middleware");

type MiddlewareLoader = (
  projectDir: string,
  adapter: RuntimeAdapter,
  allowHostProjectCodeExecution: boolean,
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
  /** Signals before project middleware can perform request-scoped side effects. */
  onMiddlewareStart?: () => void;
  /** True only when route inspection proved the response is framework-owned. */
  isFrameworkOwnedPreflight?: boolean;
  /** True when a preflight auth response should flow to the API fallback. */
  skipProjectMiddleware?: boolean;
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

/** Run one request phase inside the filesystem's authenticated tenant context. */
export async function runInProjectFilesystemContext<T>(
  ctx: HandlerContext,
  isSharedProxy: boolean,
  operation: () => Promise<T>,
): Promise<T> {
  const fs = ctx.adapter.fs;
  const effectiveProxyToken = ctx.proxyToken ?? ctx.requestContext?.token;
  if (
    !isSharedProxy || ctx.isLocalProject || !ctx.projectSlug || !effectiveProxyToken ||
    !isExtendedFSAdapter(fs) || !fs.isMultiProjectMode()
  ) {
    return await operation();
  }

  return await fs.runWithContext(
    ctx.projectSlug,
    effectiveProxyToken,
    operation,
    ctx.projectId,
    {
      productionMode: resolvedEnvironment(ctx) === "production",
      releaseId: ctx.releaseId ?? null,
      branch: resolvedBranch(ctx),
      environmentName: ctx.environmentName ?? null,
    },
  );
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
      ((projectDir, adapter, allowHostProjectCodeExecution) =>
        loadMiddlewareFile(projectDir, adapter, {
          throwOnError: true,
          allowHostProjectCodeExecution,
        }));

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
    const {
      handlerContext: ctx,
      isFrameworkOwnedPreflight,
      isSharedProxy,
      next,
      onMiddlewareStart,
      request,
      skipProjectMiddleware,
    } = input;
    const pathname = new URL(request.url).pathname;

    if (isWebSocketPath(pathname)) {
      return next();
    }

    if (skipProjectMiddleware) {
      return next();
    }

    // Browser preflight is framework-owned only after route inspection
    // prepared the response from the same source snapshot. Keep middleware on
    // every ambiguous or authored route shape.
    if (isFrameworkOwnedPreflight) {
      return next();
    }

    // A control-plane dispatch is not the project's traffic. It addresses a
    // platform handler in the reserved control-plane namespace, carries a
    // signed operation envelope rather than a user session, and asks the
    // runtime to perform internal work such as building the release asset
    // manifest for the project's own deploy.
    //
    // Project middleware cannot authorize such a request even in principle:
    // `createApplicationRequest` withholds every `x-veryfront-*` header from
    // project code, so the signature the receiving handler authenticates with
    // is invisible to middleware. A root `middleware.ts` that gates requests
    // therefore has no choice but to reject its own deploy, which surfaces
    // only as `deploy` timing out with `last state: missing`.
    //
    // The bypass is keyed on a registered surface, not on a path shape:
    // `isSignedControlPlaneDispatch` requires both a method/path pair a
    // control-plane handler owns and the signature header that handler
    // verifies. The predicate cannot tell a genuine dispatch from a set header
    // and does not try to; it concedes nothing to an unauthenticated caller
    // because the only routes it can reach are owned by handlers registered
    // ahead of `ApiHandlerWrapper`, which answer 401 without a valid envelope
    // and never fall through to project code. Every other request, including
    // an unsigned one to the same path and a project route that merely sits
    // inside the reserved namespace, still traverses project middleware.
    if (isSignedControlPlaneDispatch(request)) {
      return next();
    }

    // A platform channel dispatch is not the project's traffic either. It
    // addresses `ChannelInvokeHandler`, carries a signed dispatch envelope
    // rather than a user session, and asks the runtime to run one of the
    // project's own agents on a message that arrived from Slack, Discord or a
    // sibling runtime instance that owns the run.
    //
    // The same impossibility applies: `createApplicationRequest` withholds
    // every `x-veryfront-*` header from project code, so the dispatch signature
    // is invisible to middleware, and a root `middleware.ts` that gates
    // requests has no choice but to reject the project's own channels. The
    // symptom is that the channel simply goes quiet.
    //
    // Two predicates, not one: a channel dispatch is verified by
    // `verifyDispatchJws` against the dispatch id, platform, project id and
    // body hash, not by `verifyControlPlaneJws` against a method and path. What
    // is shared is the set of gates each dispatch kind is exempt from. See
    // `security/http/dispatch-exemption-matrix.test.ts`. The bypass concedes
    // nothing: `POST /channels/invoke` without a valid envelope answers 401 at
    // the handler and never falls through to project code, and an unsigned
    // request to the same path still traverses project middleware.
    if (isSignedChannelDispatch(request)) {
      return next();
    }

    if (
      isConfigOptionalControlPlaneRunRequest(
        request.method,
        pathname,
      )
    ) {
      return next();
    }

    const environment = resolvedEnvironment(ctx);
    const branch = resolvedBranch(ctx);
    const allowHostProjectCodeExecution = isHostProjectCodeExecutionAllowed(ctx);
    const executeMiddleware = async (): Promise<Response | undefined> => {
      let middleware: readonly MiddlewareFunction[];
      try {
        middleware = await this.#getMiddleware(
          ctx,
          environment,
          branch,
          isSharedProxy,
          allowHostProjectCodeExecution,
        );
      } catch (error) {
        if (!(error instanceof ProjectMiddlewareHostExecutionDeniedError)) throw error;

        const unavailable = createErrorResponseFromDefinition(
          PROJECT_EXECUTION_UNAVAILABLE,
          {
            detail:
              "Shared runtimes require a dedicated isolated project runtime for project middleware",
            instance: pathname,
          },
        );
        unavailable.headers.set("cache-control", "no-store");
        if (request.method !== "HEAD") return unavailable;

        return new Response(null, {
          status: unavailable.status,
          statusText: unavailable.statusText,
          headers: unavailable.headers,
        });
      }
      if (middleware.length === 0) return next();
      onMiddlewareStart?.();

      const pipeline = new MiddlewarePipeline();
      for (const handler of middleware) pipeline.use(handler);

      const composed = pipeline.compose();
      const middlewareContext = new MiddlewareContext(
        createApplicationRequest(request, {
          denyHeaders: ctx.applicationIdentityHeaderNames,
        }),
        getProjectEnvSnapshot() ?? {},
        undefined,
        ctx.applicationIdentity ?? null,
      );
      return await composed(middlewareContext, next);
    };
    const runInFilesystemContext = <T>(operation: () => Promise<T>) =>
      runInProjectFilesystemContext(ctx, isSharedProxy, operation);
    const executeWithPreparedSnapshot = () =>
      runWithRetainedPreviewDocumentSourceSnapshot(ctx, executeMiddleware, {
        runDeferredOperation: runInFilesystemContext,
      });

    return await runInFilesystemContext(executeWithPreparedSnapshot);
  }

  async #getMiddleware(
    ctx: HandlerContext,
    environment: "production" | "preview",
    branch: string | null,
    isSharedProxy: boolean,
    allowHostProjectCodeExecution: boolean,
  ): Promise<readonly MiddlewareFunction[]> {
    const key = this.#buildCacheKey(
      ctx,
      environment,
      branch,
      isSharedProxy,
      allowHostProjectCodeExecution,
    );
    if (!key) return this.#load(ctx, allowHostProjectCodeExecution);

    let pending = this.#cache.get(key);
    if (!pending) {
      pending = Promise.resolve().then(() => this.#load(ctx, allowHostProjectCodeExecution));
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
    _branch: string | null,
    isSharedProxy: boolean,
    allowHostProjectCodeExecution: boolean,
  ): string | null {
    // A branch name identifies a mutable pointer, not a source generation. Do
    // not retain preview middleware across requests until the adapter exposes a
    // verified content digest. Production release IDs are immutable snapshots.
    if (environment !== "production" || !ctx.releaseId) return null;

    // Shared caches require the canonical ID resolved at an authenticated
    // boundary. A tenant-selected slug alone must never be cache authority.
    if (isSharedProxy && (!ctx.projectId || !ctx.projectSlug)) return null;

    const projectIdentity = ctx.projectId ?? ctx.projectSlug;
    if (!projectIdentity) return null;

    const environmentIdentity = ctx.environmentId ?? ctx.environmentName ?? "default";
    return [
      cacheSegment(projectIdentity),
      cacheSegment(ctx.projectSlug ?? ""),
      allowHostProjectCodeExecution ? "host" : "isolated",
      environment,
      cacheSegment(ctx.releaseId),
      cacheSegment(environmentIdentity),
    ].join(":");
  }

  async #load(
    ctx: HandlerContext,
    allowHostProjectCodeExecution: boolean,
  ): Promise<readonly MiddlewareFunction[]> {
    try {
      const fileMiddleware = await this.#loadMiddleware(
        ctx.projectDir,
        ctx.adapter,
        allowHostProjectCodeExecution,
      );
      return [...fileMiddleware, ...(ctx.config?.middleware?.custom ?? [])];
    } catch (error) {
      if (!(error instanceof ProjectMiddlewareHostExecutionDeniedError)) {
        logger.error("Failed to load project middleware", {
          projectSlug: ctx.projectSlug,
          projectId: ctx.projectId,
          releaseId: ctx.releaseId,
          branch: resolvedBranch(ctx),
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
