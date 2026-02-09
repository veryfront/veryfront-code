import type { FileSystemAdapter, RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createContext, normalizeParams } from "./context-builder.ts";
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
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { UNKNOWN_ERROR } from "#veryfront/errors/error-registry.ts";
import { PROBLEM_JSON_CONTENT_TYPE } from "#veryfront/errors/http-error.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { isDevelopment as isDevelopmentEnv } from "#veryfront/build/config/environment.ts";

function isDevelopment(adapter: RuntimeAdapter): boolean {
  const env = adapter.env.get("MODE") ??
    adapter.env.get("NODE_ENV") ??
    adapter.env.get("DENO_ENV");

  if (!env) return isDevelopmentEnv();

  const normalized = env.toLowerCase();
  return normalized === "development" || normalized === "dev";
}

/**
 * Convert an error to RFC 9457 error response with environment-aware filtering
 */
function handleAPIError(
  error: unknown,
  pathname: string,
  adapter: RuntimeAdapter,
): Response {
  logger.error(`API route error in ${pathname}:`, error);

  const isDev = isDevelopment(adapter);

  // Convert to VeryfrontError or wrap as unknown-error
  const vfError = error instanceof VeryfrontError ? error : UNKNOWN_ERROR.create({
    detail: getErrorMessage(error),
    instance: pathname,
    cause: error instanceof Error ? error : undefined,
  });

  // Set instance if not already set
  if (!vfError.instance) {
    vfError.instance = pathname;
  }

  // Serialize to RFC 9457
  const body = vfError.toRFC9457();

  // Apply environment-specific filtering
  if (!isDev) {
    // Production: omit stack
    delete (body as { stack?: string }).stack;

    // Production: omit detail for 5xx errors (may contain sensitive info)
    if (vfError.status >= 500) {
      delete body.detail;
    }
  } else {
    // Dev mode: include stack trace if available
    const stack = error instanceof Error ? error.stack : undefined;
    if (stack) {
      (body as { stack?: string }).stack = stack;
    }
  }

  return new Response(JSON.stringify(body, null, isDev ? 2 : undefined), {
    status: vfError.status,
    headers: {
      "Content-Type": PROBLEM_JSON_CONTENT_TYPE,
    },
  });
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

function validateResponse(response: unknown): asserts response is Response {
  if (response instanceof Response) return;

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

export function executeAppRoute(
  handler: APIRoute,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
): Promise<Response> {
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
        const response = await resolvedFn(request, appContext);
        validateResponse(response);
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
): Promise<Response> {
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
        const response = await (methodHandler as PagesRouteHandler)(ctx);
        validateResponse(response);
        return response;
      } catch (error) {
        return handleAPIError(error, pathname, adapter);
      }
    },
    { "http.method": method, "http.path": pathname, "api.route.pattern": match.route.pattern },
  );
}
