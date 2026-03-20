import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createContext, normalizeParams, parseCookies } from "./context-builder.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type {
  APIRoute,
  AppRouteContext,
  AppRouteHandler,
  HTTPMethod,
  PagesRouteHandler,
} from "./module-loader/types.ts";
import {
  createAppRouteMethodNotAllowed,
  createPagesRouteMethodNotAllowed,
} from "./method-validator.ts";
import { isAbsolute, join } from "#veryfront/compat/path/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { errorToRFC9457Response } from "#veryfront/errors/middleware/http-error-boundary.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { isDevelopment as isDevelopmentEnv } from "#veryfront/build/config/environment.ts";
import type { HandlerContext } from "#veryfront/types";
import {
  getWorkerPool,
  isWorkerIsolationEnabled,
} from "#veryfront/security/sandbox/worker-pool.ts";
import type {
  SerializedRequest,
  SerializedResponse,
  WorkerResponse,
} from "#veryfront/security/sandbox/worker-types.ts";
import { getProjectEnvSnapshot } from "#veryfront/server/project-env/storage.ts";

function isDevelopment(adapter: RuntimeAdapter): boolean {
  const env = adapter.env.get("MODE") ??
    adapter.env.get("NODE_ENV") ??
    adapter.env.get("DENO_ENV");

  if (!env) return isDevelopmentEnv();

  const normalized = env.toLowerCase();
  return normalized === "development" || normalized === "dev";
}

/**
 * Convert an error to RFC 9457 error response with environment-aware filtering.
 * Delegates to the shared errorToRFC9457Response from http-error-boundary.
 */
function handleAPIError(
  error: unknown,
  pathname: string,
  adapter: RuntimeAdapter,
): Response {
  logger.error(`API route error in ${pathname}:`, error);

  const ctx = { isLocalProject: isDevelopment(adapter) } as HandlerContext;
  const req = new Request(`http://localhost${pathname}`);
  return errorToRFC9457Response(error, ctx, req);
}

function createProjectScopedFs(fs: FileSystemAdapter, projectDir: string): FileSystemAdapter {
  const resolvePath = (path: string): string => (isAbsolute(path) ? path : join(projectDir, path));

  return {
    readFile: (path: string) => fs.readFile(resolvePath(path)),
    readFileBytes: fs.readFileBytes
      ? (path: string) => fs.readFileBytes!(resolvePath(path))
      : undefined,
    writeFile: (path: string, content: string) => fs.writeFile(resolvePath(path), content),
    exists: (path: string) => fs.exists(resolvePath(path)),
    readDir: (path: string) => fs.readDir(resolvePath(path)),
    stat: (path: string) => fs.stat(resolvePath(path)),
    mkdir: (path: string, options?: { recursive?: boolean }) =>
      fs.mkdir(resolvePath(path), options),
    remove: (path: string, options?: { recursive?: boolean }) =>
      fs.remove(resolvePath(path), options),
    makeTempDir: fs.makeTempDir,
    watch: fs.watch,
    resolveFile: fs.resolveFile ? (path: string) => fs.resolveFile!(resolvePath(path)) : undefined,
  };
}

/**
 * Check if an object is a cross-context Response (e.g. Deno native Response
 * when this code runs in the npm package context with a different constructor).
 */
function isCrossContextResponse(
  value: unknown,
): value is { status: number; statusText: string; headers: Headers; body: ReadableStream | null } {
  if (value == null || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.status === "number" &&
    typeof r.headers === "object" &&
    r.headers !== null &&
    typeof (r.headers as Headers).get === "function" &&
    typeof r.text === "function" &&
    typeof r.arrayBuffer === "function"
  );
}

function validateResponse(response: unknown): Response {
  if (response instanceof Response) return response;

  // Normalize cross-context Response objects into a real Response so downstream
  // code (toHeadResponse, applyCORSHeaders, withHeaders) always receives a
  // genuine instance with correct body, headers, and status.
  if (isCrossContextResponse(response)) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  throw toError(
    createError({
      type: "api",
      message: "API handler must return a Response",
    }),
  );
}

function toHeadResponse(response: Response): Response {
  return new Response(null, { status: response.status, headers: response.headers });
}

// ---------------------------------------------------------------------------
// Worker Isolation Helpers
// ---------------------------------------------------------------------------

/** Maximum request body size for worker isolation (10 MB) */
const MAX_WORKER_BODY_BYTES = 10 * 1024 * 1024;

function checkContentLengthLimit(request: Request): void {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_WORKER_BODY_BYTES) {
    throw createError({
      type: "api",
      message: `Request body too large for isolated execution (${
        (parseInt(contentLength, 10) / 1024 / 1024).toFixed(1)
      } MB, limit ${MAX_WORKER_BODY_BYTES / 1024 / 1024} MB)`,
    });
  }
}

async function readBodyWithSizeGuard(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return null;

  // Fast path: reject before buffering if Content-Length is known
  checkContentLengthLimit(request);

  const body = new Uint8Array(await request.arrayBuffer());

  // Fallback: check actual size for chunked/streaming bodies
  if (body.byteLength > MAX_WORKER_BODY_BYTES) {
    throw createError({
      type: "api",
      message: `Request body too large for isolated execution (${
        (body.byteLength / 1024 / 1024).toFixed(1)
      } MB, limit ${MAX_WORKER_BODY_BYTES / 1024 / 1024} MB)`,
    });
  }

  return body;
}

async function serializeRequest(request: Request): Promise<SerializedRequest> {
  return {
    url: request.url,
    method: request.method,
    headers: [...request.headers.entries()],
    body: await readBodyWithSizeGuard(request),
  };
}

function deserializeResponse(s: SerializedResponse): Response {
  return new Response(s.body as BodyInit | null, {
    status: s.status,
    statusText: s.statusText,
    headers: s.headers,
  });
}

function workerResponseToResponse(
  workerResponse: WorkerResponse,
  pathname: string,
  adapter: RuntimeAdapter,
): Response {
  if (workerResponse.type === "error") {
    const { error } = workerResponse;
    logger.error(`API route error in ${pathname} (worker):`, error.message);

    // If the worker serialized RFC 9457 fields, return them directly
    // to preserve the original status code, type, and detail.
    if (error.status && error.type) {
      return Response.json(
        {
          type: error.type,
          title: error.name,
          status: error.status,
          detail: error.detail ?? error.message,
          instance: pathname,
        },
        { status: error.status },
      );
    }

    const ctx = { isLocalProject: isDevelopment(adapter) } as HandlerContext;
    const req = new Request(`http://localhost${pathname}`);
    const err = new Error(error.message);
    err.name = error.name;
    return errorToRFC9457Response(err, ctx, req);
  }

  if (workerResponse.type === "result") {
    return deserializeResponse(workerResponse.response);
  }

  // data-result type is not expected in API route execution
  throw new Error(`Unexpected worker response type: ${workerResponse.type}`);
}

// ---------------------------------------------------------------------------
// Isolated Execution (Worker Path)
// ---------------------------------------------------------------------------

function executeAppRouteIsolated(
  modulePath: string,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
  projectDir: string,
): Promise<Response> {
  const method = request.method.toUpperCase() as HTTPMethod;

  return withSpan(
    "api.executeAppRoute.isolated",
    async () => {
      try {
        const pool = getWorkerPool();
        const serialized = await serializeRequest(request);

        const workerResponse = await pool.execute(
          projectDir,
          [projectDir],
          {
            type: "execute-app-route",
            id: crypto.randomUUID(),
            modulePath,
            method,
            request: serialized,
            params: match.params,
            projectDir,
            projectEnv: getProjectEnvSnapshot(),
          },
        );

        const response = workerResponseToResponse(workerResponse, pathname, adapter);
        return method === "HEAD" ? toHeadResponse(response) : response;
      } catch (error) {
        return handleAPIError(error, pathname, adapter);
      }
    },
    {
      "http.method": method,
      "http.path": pathname,
      "api.route.pattern": match.route.pattern,
      "api.isolated": true,
    },
  );
}

function executePagesRouteIsolated(
  modulePath: string,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
  projectDir: string,
): Promise<Response> {
  const method = request.method as string;

  return withSpan(
    "api.executePagesRoute.isolated",
    async () => {
      try {
        const pool = getWorkerPool();
        const body = await readBodyWithSizeGuard(request);

        const workerResponse = await pool.execute(
          projectDir,
          [projectDir],
          {
            type: "execute-pages-route",
            id: crypto.randomUUID(),
            modulePath,
            method,
            context: {
              url: request.url,
              method: request.method,
              headers: [...request.headers.entries()],
              body,
              params: match.params,
              cookies: parseCookies(request.headers.get("cookie") ?? ""),
            },
            projectDir,
            projectEnv: getProjectEnvSnapshot(),
          },
        );

        return workerResponseToResponse(workerResponse, pathname, adapter);
      } catch (error) {
        return handleAPIError(error, pathname, adapter);
      }
    },
    {
      "http.method": method,
      "http.path": pathname,
      "api.route.pattern": match.route.pattern,
      "api.isolated": true,
    },
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExecuteRouteOptions {
  /** Absolute path to the handler module on disk (for isolated execution) */
  modulePath?: string;
  /** Project directory (for isolated execution scope) */
  projectDir?: string;
}

export function executeAppRoute(
  handler: APIRoute,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
  options?: ExecuteRouteOptions,
): Promise<Response> {
  // Isolated path: execute in per-project Worker, fall back to main process on error
  if (
    isWorkerIsolationEnabled() &&
    options?.modulePath &&
    options?.projectDir
  ) {
    return executeAppRouteIsolated(
      options.modulePath,
      request,
      match,
      pathname,
      adapter,
      options.projectDir,
    );
  }

  // Default path: execute in main process (existing behavior)
  const method = request.method.toUpperCase() as HTTPMethod;

  return withSpan(
    "api.executeAppRoute",
    async () => {
      const handlerModule = handler as Record<string, unknown>;
      const handlerFn = handlerModule[method] as AppRouteHandler | undefined;
      const defaultFn = handlerModule.default as AppRouteHandler | undefined;

      let resolvedFn = handlerFn ?? defaultFn;

      if (!resolvedFn && method === "HEAD") {
        resolvedFn = handlerModule.GET as AppRouteHandler | undefined;
      }

      if (!resolvedFn) return createAppRouteMethodNotAllowed(handlerModule);

      try {
        const appContext: AppRouteContext = { params: normalizeParams(match.params) };
        const response = validateResponse(await resolvedFn(request, appContext));
        return method === "HEAD" ? toHeadResponse(response) : response;
      } catch (error) {
        return handleAPIError(error, pathname, adapter);
      }
    },
    { "http.method": method, "http.path": pathname, "api.route.pattern": match.route.pattern },
  );
}

export function executePagesRoute(
  handler: APIRoute,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
  projectDir?: string,
  options?: ExecuteRouteOptions,
): Promise<Response> {
  // Isolated path: execute in per-project Worker, fall back to main process on error
  if (
    isWorkerIsolationEnabled() &&
    options?.modulePath &&
    (options?.projectDir ?? projectDir)
  ) {
    return executePagesRouteIsolated(
      options.modulePath,
      request,
      match,
      pathname,
      adapter,
      options.projectDir ?? projectDir!,
    );
  }

  // Default path: execute in main process (existing behavior)
  const method = request.method as keyof APIRoute;

  return withSpan(
    "api.executePagesRoute",
    async () => {
      const methodHandler = handler[method] ?? handler.default;

      if (!methodHandler) {
        return createPagesRouteMethodNotAllowed(handler as Record<string, unknown>);
      }

      try {
        const fs = projectDir ? createProjectScopedFs(adapter.fs, projectDir) : adapter.fs;
        const ctx = createContext(request, match, fs);
        return validateResponse(await (methodHandler as PagesRouteHandler)(ctx));
      } catch (error) {
        return handleAPIError(error, pathname, adapter);
      }
    },
    { "http.method": method, "http.path": pathname, "api.route.pattern": match.route.pattern },
  );
}
