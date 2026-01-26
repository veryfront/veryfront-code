import * as dntShim from "../../../_dnt.shims.js";
import type { FileSystemAdapter, RuntimeAdapter } from "../../platform/adapters/base.js";
import { createContext, normalizeParams } from "./context-builder.js";
import type { RouteMatch } from "./api-route-matcher.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import type {
  APIRoute,
  AppRouteContext,
  AppRouteHandler,
  HTTPMethod,
  PagesRouteHandler,
} from "./module-loader/types.js";
import {
  createAppRouteMethodNotAllowed,
  createPagesRouteMethodNotAllowed,
} from "./method-validator.js";
import { handleAPIError } from "./error-handler.js";
import { isAbsolute, join } from "../../platform/compat/path/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";

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

function validateResponse(response: unknown): asserts response is dntShim.Response {
  if (response instanceof dntShim.Response) return;

  throw toError(
    createError({
      type: "api",
      message: "API handler must return a Response",
    }),
  );
}

function toHeadResponse(response: dntShim.Response): dntShim.Response {
  return new dntShim.Response(null, { status: response.status, headers: response.headers });
}

export function executeAppRoute(
  handler: APIRoute,
  request: dntShim.Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
): Promise<dntShim.Response> {
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
  request: dntShim.Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
  projectDir?: string,
): Promise<dntShim.Response> {
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
