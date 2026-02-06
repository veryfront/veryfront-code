import { MiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { cors } from "#veryfront/security";
import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import {
  type RequestContext,
  runWithRequestContextAsync,
} from "#veryfront/utils/logger/request-context.ts";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";

type MiddlewareFunction = (
  c: { req: Request; var: Record<string, unknown> },
  next: () => Promise<Response | undefined> | Response,
) => Promise<Response | undefined> | Response | undefined;

const logger = getBaseLogger("SERVER");

export function createRequestLoggerMiddleware(): MiddlewareFunction {
  return async (c, next) => {
    const start = performance.now();
    const { pathname } = new URL(c.req.url);
    const method = c.req.method;
    const incomingId = c.req.headers.get("x-request-id") ?? "";
    const requestId = generateRequestId(incomingId);

    const host = c.req.headers.get("host") ?? "";
    const domain = host.replace(/:\d+$/, "");
    const projectSlug = c.req.headers.get("x-project-slug") ?? undefined;
    const projectId = c.req.headers.get("x-project-id") ?? undefined;
    const releaseId = c.req.headers.get("x-release-id") ?? undefined;
    const branchId = c.req.headers.get("x-branch-id") ?? undefined;
    const branchName = c.req.headers.get("x-branch-name") ?? undefined;

    const reqLogger = logger.child({
      requestId,
      request_url: c.req.url,
      domain,
      project_slug: projectSlug,
      project_id: projectId,
      release_id: releaseId,
      branch_id: branchId,
      branch_name: branchName,
      pathname,
    });

    c.var.requestId = requestId;
    c.var.logger = reqLogger;

    const requestContext: RequestContext = {
      logger: reqLogger,
      requestId,
      projectSlug,
      projectId,
      domain,
    };

    return runWithRequestContextAsync(requestContext, async () => {
      try {
        await enrichSpanWithRequestInfo(method, pathname, requestId);
        reqLogger.debug(`${method} ${pathname} started`);
      } catch {
        /* dev only */
      }

      let response: Response | undefined;
      try {
        response = await next();
      } catch (error) {
        const durationMs = Math.round(performance.now() - start);
        reqLogger.error(`${method} ${pathname} failed`, { durationMs }, error);
        throw error;
      }

      const durationMs = Math.round(performance.now() - start);

      if (response && response.status !== 101) {
        response.headers.set("x-request-id", requestId);
      }

      try {
        reqLogger.debug(`${method} ${pathname} completed`, {
          status: response?.status ?? 0,
          durationMs,
        });
      } catch {
        /* dev only */
      }

      return response;
    });
  };
}

async function loadMiddlewareFile(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<MiddlewareFunction[]> {
  const middlewareFiles = ["middleware.ts", "middleware.js", "middleware.mjs"];

  for (const middlewareFile of middlewareFiles) {
    const middlewarePath = join(projectDir, middlewareFile);
    if (!(await adapter.fs.exists(middlewarePath))) continue;

    try {
      logger.debug(`[MIDDLEWARE] Loading ${middlewareFile}`);

      if (isVirtualFilesystem(adapter.fs)) {
        return await loadMiddlewareFromVirtualFS(middlewarePath, adapter);
      }

      const middlewareUrl = `file://${middlewarePath}?t=${Date.now()}-${crypto.randomUUID()}`;
      const middlewareModule = await import(middlewareUrl);
      return normalizeMiddlewareExport(middlewareModule);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`[MIDDLEWARE] Failed to load ${middlewareFile}: ${errorMessage}`);
    }
  }

  return [];
}

async function loadMiddlewareFromVirtualFS(
  middlewarePath: string,
  adapter: RuntimeAdapter,
): Promise<MiddlewareFunction[]> {
  const fs = createFileSystem();

  const content = await adapter.fs.readFile(middlewarePath);
  const source = typeof content === "string" ? content : new TextDecoder().decode(content);
  const loader = getEsbuildLoader(middlewarePath);

  const { build } = await import("esbuild");
  const result = await build({
    bundle: false,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    stdin: {
      contents: source,
      loader,
      resolveDir: dirname(middlewarePath),
      sourcefile: middlewarePath,
    },
  });

  const firstError = result.errors?.[0]?.text;
  if (firstError) throw new Error(`Failed to transpile middleware: ${firstError}`);

  const js = result.outputFiles?.[0]?.text ?? "export default []";

  const tempDir = await fs.makeTempDir({ prefix: "vf-middleware-" });
  const tempFile = join(tempDir, "middleware.mjs");

  try {
    await fs.writeTextFile(tempFile, js);
    const middlewareModule = await import(`file://${tempFile}?v=${Date.now()}`);
    return normalizeMiddlewareExport(middlewareModule);
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

function normalizeMiddlewareExport(middlewareModule: unknown): MiddlewareFunction[] {
  if (middlewareModule && typeof middlewareModule === "object" && "default" in middlewareModule) {
    const exported = (middlewareModule as { default?: unknown }).default;

    if (Array.isArray(exported)) {
      return exported.filter((m): m is MiddlewareFunction => typeof m === "function");
    }

    return typeof exported === "function" ? [exported as MiddlewareFunction] : [];
  }

  if (Array.isArray(middlewareModule)) {
    return middlewareModule.filter((m): m is MiddlewareFunction => typeof m === "function");
  }

  return typeof middlewareModule === "function" ? [middlewareModule as MiddlewareFunction] : [];
}

export async function setupMiddleware(
  pipeline: MiddlewarePipeline,
  config: VeryfrontConfig,
  requestHandler: (req: Request) => Promise<Response>,
  projectDir?: string,
  adapter?: RuntimeAdapter,
): Promise<void> {
  pipeline.use(createRequestLoggerMiddleware());

  const corsConfig = config.security?.cors;
  if (corsConfig) {
    pipeline.use(cors(corsConfig === true ? {} : corsConfig));
  }

  if (config.fs?.veryfront?.proxyMode === true) {
    logger.debug("[MIDDLEWARE] Skipping file middleware in proxy mode");
  } else if (projectDir && adapter) {
    const fileMiddlewares = await loadMiddlewareFile(projectDir, adapter);
    for (const middleware of fileMiddlewares) {
      logger.debug("[MIDDLEWARE] Registered middleware from file");
      pipeline.use(middleware);
    }
  }

  const custom = config.middleware?.custom;
  if (custom) {
    for (const middleware of custom) {
      pipeline.use(middleware);
    }
  }

  pipeline.use((c) => requestHandler(c.req));
}

function generateRequestId(incomingId: string): string {
  if (incomingId) return incomingId;

  return crypto
    .getRandomValues(new Uint32Array(2))
    .reduce((acc, n) => acc + n.toString(16).padStart(8, "0"), "");
}

async function enrichSpanWithRequestInfo(
  method: string,
  pathname: string,
  requestId: string,
): Promise<void> {
  try {
    const { trace } = await import("@opentelemetry/api");
    const span = trace.getActiveSpan();
    if (!span) return;

    span.setAttribute("http.route", pathname);
    span.setAttribute("veryfront.request_id", requestId);
    span.updateName(`${method} ${pathname}`);
  } catch {
    /* otel optional */
  }
}
