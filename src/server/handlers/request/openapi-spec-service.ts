import { API_ERROR } from "#veryfront/errors";
import { requireActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { ApiRouteMatcher } from "#veryfront/routing/api/api-route-matcher.ts";
import { bundleHandlerModuleForIsolation } from "#veryfront/routing/api/module-loader/loader.ts";
import {
  assertOpenAPIDocumentSize,
  validateOpenAPISpec,
} from "#veryfront/routing/api/openapi/spec-validation.ts";
import { generateOpenAPISpec } from "#veryfront/routing/api/openapi/spec-generator.ts";
import type { OpenAPISpec } from "#veryfront/routing/api/openapi/types.ts";
import { assertValidOpenAPIWorkerRequest } from "#veryfront/routing/api/openapi/worker-contract.ts";
import { discoverAppRoutes, discoverPagesRoutes } from "#veryfront/routing/api/route-discovery.ts";
import { getWorkerPool } from "#veryfront/security/sandbox/worker-pool.ts";
import {
  type GenerateOpenAPISpecRequest,
  MAX_OPENAPI_WORKER_MODULE_BYTES,
  MAX_OPENAPI_WORKER_ROUTES,
  MAX_OPENAPI_WORKER_TOTAL_MODULE_BYTES,
  type WorkerResponse,
} from "#veryfront/security/sandbox/worker-types.ts";
import { getBaseLogger } from "#veryfront/utils";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import type { HandlerContext } from "../types.ts";
import { resolveApiProjectExecution } from "./api/api-project-context.ts";

const logger = getBaseLogger("SERVER").component("open-api");
const encoder = new TextEncoder();
const MAX_CACHE_IDENTITY_BYTES = 1024 * 1024;

type ExecuteWorker = (
  projectId: string,
  readPaths: string[],
  request: GenerateOpenAPISpecRequest,
) => Promise<WorkerResponse>;

export interface OpenAPIHandlerDeps {
  bundleHandlerModuleForIsolation: typeof bundleHandlerModuleForIsolation;
  discoverAppRoutes: typeof discoverAppRoutes;
  discoverPagesRoutes: typeof discoverPagesRoutes;
  executeWorker: ExecuteWorker;
  generateOpenAPISpec: typeof generateOpenAPISpec;
  getProjectEnvSnapshot: () => Record<string, string> | undefined;
  requireSourceIntegrationPolicy: typeof requireActiveSourceIntegrationPolicy;
}

let injectedDeps: Partial<OpenAPIHandlerDeps> | null = null;

/** @internal Test seam for process and Worker boundary assertions. */
export function __injectOpenAPIHandlerDepsForTests(
  deps: Partial<OpenAPIHandlerDeps> | null,
): void {
  injectedDeps = deps;
}

function getProjectEnvSnapshot(): Record<string, string> | undefined {
  const getter = (globalThis as Record<string, unknown>).__vfProjectEnvSnapshotGetter as
    | (() => Record<string, string> | undefined)
    | undefined;
  return getter?.();
}

async function executeEphemeralOpenAPIWorker(
  projectId: string,
  readPaths: string[],
  request: GenerateOpenAPISpecRequest,
): Promise<WorkerResponse> {
  const pool = getWorkerPool();
  try {
    return await pool.execute(projectId, readPaths, request);
  } finally {
    pool.evictWorker(projectId);
  }
}

function getDeps(): OpenAPIHandlerDeps {
  return {
    bundleHandlerModuleForIsolation: injectedDeps?.bundleHandlerModuleForIsolation ??
      bundleHandlerModuleForIsolation,
    discoverAppRoutes: injectedDeps?.discoverAppRoutes ?? discoverAppRoutes,
    discoverPagesRoutes: injectedDeps?.discoverPagesRoutes ?? discoverPagesRoutes,
    executeWorker: injectedDeps?.executeWorker ?? executeEphemeralOpenAPIWorker,
    generateOpenAPISpec: injectedDeps?.generateOpenAPISpec ?? generateOpenAPISpec,
    getProjectEnvSnapshot: injectedDeps?.getProjectEnvSnapshot ?? getProjectEnvSnapshot,
    requireSourceIntegrationPolicy: injectedDeps?.requireSourceIntegrationPolicy ??
      requireActiveSourceIntegrationPolicy,
  };
}

async function digestIdentity(value: unknown, label: string): Promise<string> {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
  const bytes = encoder.encode(serialized);
  if (bytes.byteLength > MAX_CACHE_IDENTITY_BYTES) {
    throw new RangeError(`${label} exceeds the size limit`);
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createOpenAPICacheKey(ctx: HandlerContext, url: URL): Promise<string> {
  return await digestIdentity(
    {
      projectDir: ctx.projectDir,
      projectId: ctx.projectId ?? null,
      projectSlug: ctx.projectSlug ?? null,
      branch: ctx.parsedDomain?.branch ?? ctx.requestContext?.branch ?? null,
      releaseId: ctx.releaseId ?? null,
      contentSourceId: ctx.enriched?.contentSourceId ?? null,
      environment: ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? null,
      environmentName: ctx.environmentName ?? null,
      origin: url.origin,
      directories: ctx.config?.directories ?? null,
      openapi: ctx.config?.openapi ?? null,
    },
    "OpenAPI cache identity",
  );
}

async function createOpenAPIWorkerProjectKey(
  ctx: HandlerContext,
  requestId: string,
): Promise<string> {
  const projectHash = await digestIdentity(
    [ctx.projectId ?? null, ctx.projectSlug ?? null, ctx.projectDir],
    "OpenAPI project identity",
  );
  return `openapi:${projectHash}:${requestId}`;
}

async function discoverOpenAPIRoutes(
  ctx: HandlerContext,
  deps: OpenAPIHandlerDeps,
): Promise<ApiRouteMatcher> {
  const router = new ApiRouteMatcher();
  const pagesDirectory = join(
    ctx.projectDir,
    ctx.config?.directories?.pages ?? "pages",
    "api",
  );
  if (await ctx.adapter.fs.exists(pagesDirectory)) {
    await deps.discoverPagesRoutes(router, pagesDirectory, "/api", ctx.adapter);
  }

  const appDirectory = join(ctx.projectDir, ctx.config?.directories?.app ?? "app");
  if (await ctx.adapter.fs.exists(appDirectory)) {
    await deps.discoverAppRoutes(router, appDirectory, "", ctx.adapter);
  }
  return router;
}

function isApiRoutePattern(pattern: string): boolean {
  return pattern === "/api" || pattern.startsWith("/api/");
}

async function bundleRemoteOpenAPIRoutes(
  router: ApiRouteMatcher,
  ctx: HandlerContext,
  deps: OpenAPIHandlerDeps,
): Promise<GenerateOpenAPISpecRequest["routes"]> {
  const routes: GenerateOpenAPISpecRequest["routes"] = [];
  let totalModuleBytes = 0;

  for (const [pattern, entry] of router.routes) {
    if (!isApiRoutePattern(pattern)) continue;
    if (routes.length >= MAX_OPENAPI_WORKER_ROUTES) {
      throw new RangeError("OpenAPI worker route count exceeds the limit");
    }
    const moduleCode = await deps.bundleHandlerModuleForIsolation({
      projectDir: ctx.projectDir,
      modulePath: entry.route.page,
      adapter: ctx.adapter,
      config: ctx.config,
    });
    const moduleBytes = encoder.encode(moduleCode).byteLength;
    if (moduleBytes > MAX_OPENAPI_WORKER_MODULE_BYTES) {
      throw new RangeError("OpenAPI worker module exceeds the size limit");
    }
    totalModuleBytes += moduleBytes;
    if (totalModuleBytes > MAX_OPENAPI_WORKER_TOTAL_MODULE_BYTES) {
      throw new RangeError("OpenAPI worker module payload exceeds the total size limit");
    }
    routes.push({ pattern, moduleCode });
  }
  return routes;
}

async function generateRemoteOpenAPISpec(
  router: ApiRouteMatcher,
  ctx: HandlerContext,
  serverUrl: string,
  deps: OpenAPIHandlerDeps,
): Promise<OpenAPISpec> {
  const requestId = crypto.randomUUID();
  const sourceIntegrationPolicy = deps.requireSourceIntegrationPolicy();
  const projectEnv = deps.getProjectEnvSnapshot();
  const routes = await bundleRemoteOpenAPIRoutes(router, ctx, deps);
  const request: GenerateOpenAPISpecRequest = {
    type: "generate-openapi-spec",
    id: requestId,
    projectDir: ctx.projectDir,
    routes,
    info: {
      title: ctx.config?.openapi?.title ?? "API Documentation",
      version: ctx.config?.openapi?.version ?? "1.0.0",
      description: ctx.config?.openapi?.description,
      servers: [{ url: serverUrl, description: "Current server" }],
    },
    sourceIntegrationPolicy,
    projectEnv,
  };
  assertValidOpenAPIWorkerRequest(request);

  const workerResponse = await deps.executeWorker(
    await createOpenAPIWorkerProjectKey(ctx, requestId),
    [],
    request,
  );
  if (workerResponse.type === "error") {
    throw API_ERROR.create({ detail: "Isolated OpenAPI generation failed" });
  }
  if (workerResponse.type !== "openapi-result" || workerResponse.id !== requestId) {
    throw API_ERROR.create({ detail: "Isolated OpenAPI worker returned an invalid response" });
  }
  return validateOpenAPISpec(workerResponse.spec);
}

async function generateSpec(
  ctx: HandlerContext,
  url: URL,
  isLocalDevelopment: boolean,
): Promise<OpenAPISpec> {
  const deps = getDeps();
  const generate = async (): Promise<OpenAPISpec> => {
    const router = await discoverOpenAPIRoutes(ctx, deps);
    const options = {
      servers: [{ url: url.origin, description: "Current server" }],
    };
    if (isLocalDevelopment) {
      const spec = await deps.generateOpenAPISpec(
        router,
        ctx.projectDir,
        ctx.adapter,
        ctx.config,
        options,
      );
      return validateOpenAPISpec(spec);
    }
    return await generateRemoteOpenAPISpec(router, ctx, url.origin, deps);
  };

  if (isLocalDevelopment) return await generate();
  const execution = resolveApiProjectExecution(ctx);
  if (execution.kind === "invalid") {
    throw API_ERROR.create({ detail: "OpenAPI project context is unavailable" });
  }
  return execution.kind === "multi" ? await execution.execute(generate) : await generate();
}

export class OpenAPISpecService {
  #cachedSpec: OpenAPISpec | null = null;
  #cacheKey: string | null = null;
  readonly #flight = new Singleflight<OpenAPISpec>();

  async getOrGenerate(ctx: HandlerContext, url: URL): Promise<OpenAPISpec> {
    const localDevelopment = ctx.isLocalProject === true;
    const cacheKey = await createOpenAPICacheKey(ctx, url);
    if (!localDevelopment && this.#cachedSpec && this.#cacheKey === cacheKey) {
      return this.#cachedSpec;
    }

    return await this.#flight.do(cacheKey, async () => {
      if (!localDevelopment && this.#cachedSpec && this.#cacheKey === cacheKey) {
        return this.#cachedSpec;
      }
      const spec = await generateSpec(ctx, url, localDevelopment);
      assertOpenAPIDocumentSize(JSON.stringify(spec));
      if (!localDevelopment) {
        this.#cachedSpec = spec;
        this.#cacheKey = cacheKey;
      }
      logger.debug("Generated spec", {
        pathCount: Object.keys(spec.paths).length,
        isDev: localDevelopment,
      });
      return spec;
    });
  }
}
