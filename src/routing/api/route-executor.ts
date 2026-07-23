import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createContext, normalizeParams, parseCookies } from "./context-builder.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import {
  createError,
  ERROR_REGISTRY,
  errorToRFC9457Response,
  INVALID_ARGUMENT,
  NOT_SUPPORTED,
  toError,
} from "#veryfront/errors";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";
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
import { dirname, resolve } from "#veryfront/compat/path/index.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { isDevelopment as isDevelopmentEnv } from "#veryfront/platform/environment.ts";
import type { HandlerContext } from "#veryfront/types";
import {
  getWorkerPool,
  isWorkerIsolationEnabled,
} from "#veryfront/security/sandbox/worker-pool.ts";
import {
  MAX_WORKER_BODY_BYTES,
  type SerializedRequest,
  type SerializedResponse,
  type WorkerResponse,
} from "#veryfront/security/sandbox/worker-types.ts";
import { requireActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { readBodyBytesWithLimit } from "#veryfront/security/input-validation/limits.ts";
/**
 * Read the current project env snapshot via the globalThis bridge registered by
 * server/project-env/storage.ts.  This avoids a direct import from the server/
 * layer (which would violate the layer architecture).
 */
function getProjectEnvSnapshot(): Record<string, string> | undefined {
  const getter = (globalThis as Record<string, unknown>).__vfProjectEnvSnapshotGetter as
    | (() => Record<string, string> | undefined)
    | undefined;
  return getter?.();
}

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
  isLocalProject?: boolean,
): Response {
  logger.error("API route failed", {
    errorName: sanitizeErrorText(error instanceof Error ? error.name : typeof error, 256),
  });

  const ctx = {
    isLocalProject: isLocalProject !== false && isDevelopment(adapter),
  } as HandlerContext;
  const req = new Request(`http://localhost${pathname}`);
  return errorToRFC9457Response(error, ctx, req);
}

function createProjectScopedFs(fs: FileSystemAdapter, projectDir: string): FileSystemAdapter {
  const root = resolve(projectDir);
  let canonicalRootPromise: Promise<string> | undefined;

  const resolveLexicalPath = (path: string): string => {
    const candidate = resolve(root, path);
    if (isWithinDirectory(root, candidate)) return candidate;
    throw INVALID_ARGUMENT.create({
      message: "Filesystem path must stay within the project directory",
    });
  };

  const canonicalRoot = (): Promise<string> => {
    if (!fs.realPath) return Promise.resolve(root);
    canonicalRootPromise ??= fs.realPath(root);
    return canonicalRootPromise;
  };

  const guardPath = async (path: string): Promise<string> => {
    const candidate = resolveLexicalPath(path);
    if (!fs.realPath) return candidate;

    const realRoot = await canonicalRoot();
    let current = candidate;
    while (true) {
      try {
        const canonical = await fs.realPath(current);
        if (!isWithinDirectory(realRoot, canonical)) {
          throw INVALID_ARGUMENT.create({
            message: "Filesystem path must stay within the project directory",
          });
        }
        return candidate === current ? canonical : candidate;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        if (current === root) return candidate;
        const parent = dirname(current);
        if (parent === current || !isWithinDirectory(root, parent)) return candidate;
        current = parent;
      }
    }
  };

  const createScopedWatcher: FileSystemAdapter["watch"] = (paths, options) => {
    let closed = false;
    const watcherPromise = (async () => {
      const guarded = Array.isArray(paths)
        ? await Promise.all(paths.map(guardPath))
        : await guardPath(paths);
      const watcher = fs.watch(guarded, options);
      if (closed) watcher.close();
      return watcher;
    })();

    return {
      close() {
        closed = true;
        void watcherPromise.then((watcher) => watcher.close());
      },
      async *[Symbol.asyncIterator]() {
        const watcher = await watcherPromise;
        if (closed) return;
        for await (const event of watcher) yield event;
      },
    };
  };

  return {
    readFile: async (path: string) => await fs.readFile(await guardPath(path)),
    readFileBytes: fs.readFileBytes
      ? async (path: string) => await fs.readFileBytes!(await guardPath(path))
      : undefined,
    writeFile: async (path: string, content: string) =>
      await fs.writeFile(await guardPath(path), content),
    exists: async (path: string) => await fs.exists(await guardPath(path)),
    readDir: async function* (path: string) {
      for await (const entry of fs.readDir(await guardPath(path))) yield entry;
    },
    stat: async (path: string) => await fs.stat(await guardPath(path)),
    lstat: fs.lstat ? async (path: string) => await fs.lstat!(await guardPath(path)) : undefined,
    realPath: fs.realPath ? async (path: string) => await guardPath(path) : undefined,
    mkdir: async (path: string, options?: { recursive?: boolean }) =>
      await fs.mkdir(await guardPath(path), options),
    remove: async (path: string, options?: { recursive?: boolean }) =>
      await fs.remove(await guardPath(path), options),
    makeTempDir: async (prefix: string) => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(prefix)) {
        throw INVALID_ARGUMENT.create({
          message: "Temporary directory prefix must use letters, numbers, underscores, or hyphens",
        });
      }
      const tempRoot = await guardPath(".veryfront/tmp");
      await fs.mkdir(tempRoot, { recursive: true });
      const tempDir = await guardPath(`${tempRoot}/${prefix}-${crypto.randomUUID()}`);
      await fs.mkdir(tempDir);
      return tempDir;
    },
    watch: createScopedWatcher,
    resolveFile: fs.resolveFile
      ? async (path: string, options) => {
        const result = await fs.resolveFile!(await guardPath(path), options);
        return result ? await guardPath(result) : null;
      }
      : undefined,
    refreshSourceSnapshot: fs.refreshSourceSnapshot
      ? async (reason?: string) => await fs.refreshSourceSnapshot!(reason)
      : undefined,
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

let warnedUntrustedInProcessExecution = false;

export function __resetInProcessIsolationWarningForTests(): void {
  warnedUntrustedInProcessExecution = false;
}

function warnIfUntrustedInProcessExecution(
  routeKind: "app" | "pages",
  options?: ExecuteRouteOptions,
): void {
  if (options?.isLocalProject !== false) return;
  if (isWorkerIsolationEnabled()) return;
  if (warnedUntrustedInProcessExecution) return;

  warnedUntrustedInProcessExecution = true;
  try {
    logger.warn(
      "Untrusted project code is executing in-process with worker isolation disabled. Enable WORKER_ISOLATION_ENABLED=1 and WORKER_ISOLATION_API=1 to run project routes in a permission-restricted worker.",
      {
        requiredEnv: ["WORKER_ISOLATION_ENABLED", "WORKER_ISOLATION_API"],
        routeKind,
        workerIsolationEnabled: false,
      },
    );
  } catch {
    // A diagnostic warning must not prevent the API route from running.
  }
}

async function readBodyWithSizeGuard(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return null;
  return await readBodyBytesWithLimit(request, MAX_WORKER_BODY_BYTES);
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
  isLocalProject?: boolean,
): Response {
  if (workerResponse.type === "error") {
    const { error } = workerResponse;
    logger.error("Isolated API route failed", {
      errorName: sanitizeErrorText(error.name, 256),
    });

    const definition = typeof error.slug === "string" && Object.hasOwn(ERROR_REGISTRY, error.slug)
      ? ERROR_REGISTRY[error.slug as keyof typeof ERROR_REGISTRY]
      : undefined;
    const detail = sanitizeErrorText(error.detail ?? error.message, 16_384);
    const normalizedError = definition
      ? definition.create({ detail })
      : Object.assign(new Error(detail || "Isolated API route failed"), {
        name: sanitizeErrorText(error.name, 256) || "Error",
      });
    const ctx = {
      isLocalProject: isLocalProject !== false && isDevelopment(adapter),
    } as HandlerContext;
    const req = new Request(`http://localhost${pathname}`);
    return errorToRFC9457Response(normalizedError, ctx, req);
  }

  if (workerResponse.type === "result") {
    return deserializeResponse(workerResponse.response);
  }

  // data-result type is not expected in API route execution
  throw NOT_SUPPORTED.create({ detail: `Unexpected worker response type: ${workerResponse.type}` });
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
  isLocalProject?: boolean,
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
            sourceIntegrationPolicy: requireActiveSourceIntegrationPolicy(),
            projectEnv: getProjectEnvSnapshot(),
          },
        );

        const response = workerResponseToResponse(
          workerResponse,
          pathname,
          adapter,
          isLocalProject,
        );
        return method === "HEAD" ? toHeadResponse(response) : response;
      } catch (error) {
        return handleAPIError(error, pathname, adapter, isLocalProject);
      }
    },
    {
      "http.method": method,
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
  isLocalProject?: boolean,
): Promise<Response> {
  const method = request.method;

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
            sourceIntegrationPolicy: requireActiveSourceIntegrationPolicy(),
            projectEnv: getProjectEnvSnapshot(),
          },
        );

        const response = workerResponseToResponse(
          workerResponse,
          pathname,
          adapter,
          isLocalProject,
        );
        return request.method === "HEAD" ? toHeadResponse(response) : response;
      } catch (error) {
        return handleAPIError(error, pathname, adapter, isLocalProject);
      }
    },
    {
      "http.method": method,
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
  /** Whether the handler module belongs to a trusted local development project. */
  isLocalProject?: boolean;
}

export function executeAppRoute(
  handler: APIRoute | null,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
  options?: ExecuteRouteOptions,
): Promise<Response> {
  // Isolated path: execute in a per-project Worker.
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
      options.isLocalProject,
    );
  }

  if (!handler) {
    return Promise.resolve(
      handleAPIError(
        createError({ type: "api", message: "API route handler is unavailable" }),
        pathname,
        adapter,
        options?.isLocalProject,
      ),
    );
  }

  // Default path: execute in main process (existing behavior)
  warnIfUntrustedInProcessExecution("app", options);
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
        return handleAPIError(error, pathname, adapter, options?.isLocalProject);
      }
    },
    { "http.method": method },
  );
}

export function executePagesRoute(
  handler: APIRoute | null,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
  projectDir?: string,
  options?: ExecuteRouteOptions,
): Promise<Response> {
  const requestedMethod = request.method.toUpperCase();

  // Isolated path: execute in a per-project Worker.
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
      options.isLocalProject,
    );
  }

  if (!handler) {
    return Promise.resolve(
      handleAPIError(
        createError({ type: "api", message: "API route handler is unavailable" }),
        pathname,
        adapter,
        options?.isLocalProject,
      ),
    );
  }

  const handlerRecord = handler as Record<string, unknown>;
  const effectiveMethod = requestedMethod === "HEAD" && typeof handlerRecord.HEAD !== "function" &&
      typeof handlerRecord.GET === "function"
    ? "GET"
    : requestedMethod;

  // Default path: execute in main process (existing behavior)
  warnIfUntrustedInProcessExecution("pages", options);
  const method = requestedMethod as keyof APIRoute;

  return withSpan(
    "api.executePagesRoute",
    async () => {
      const methodHandler = handler[effectiveMethod as keyof APIRoute] ?? handler.default;

      if (!methodHandler) {
        return createPagesRouteMethodNotAllowed(handler as Record<string, unknown>);
      }

      try {
        const fs = projectDir ? createProjectScopedFs(adapter.fs, projectDir) : adapter.fs;
        const ctx = createContext(request, match, fs);
        const response = validateResponse(await (methodHandler as PagesRouteHandler)(ctx));
        return requestedMethod === "HEAD" ? toHeadResponse(response) : response;
      } catch (error) {
        return handleAPIError(error, pathname, adapter, options?.isLocalProject);
      }
    },
    { "http.method": method },
  );
}
