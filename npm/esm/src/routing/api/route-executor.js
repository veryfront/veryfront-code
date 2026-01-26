import * as dntShim from "../../../_dnt.shims.js";
import { createContext, normalizeParams } from "./context-builder.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { createAppRouteMethodNotAllowed, createPagesRouteMethodNotAllowed, } from "./method-validator.js";
import { handleAPIError } from "./error-handler.js";
import { isAbsolute, join } from "../../platform/compat/path/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
function createProjectScopedFs(fs, projectDir) {
    const resolvePath = (path) => (isAbsolute(path) ? path : join(projectDir, path));
    return {
        readFile: (path) => fs.readFile(resolvePath(path)),
        readFileBytes: fs.readFileBytes
            ? (path) => fs.readFileBytes(resolvePath(path))
            : undefined,
        writeFile: (path, content) => fs.writeFile(resolvePath(path), content),
        exists: (path) => fs.exists(resolvePath(path)),
        readDir: (path) => fs.readDir(resolvePath(path)),
        stat: (path) => fs.stat(resolvePath(path)),
        mkdir: (path, options) => fs.mkdir(resolvePath(path), options),
        remove: (path, options) => fs.remove(resolvePath(path), options),
        makeTempDir: fs.makeTempDir,
        watch: fs.watch,
        resolveFile: fs.resolveFile ? (path) => fs.resolveFile(resolvePath(path)) : undefined,
    };
}
function validateResponse(response) {
    if (response instanceof dntShim.Response)
        return;
    throw toError(createError({
        type: "api",
        message: "API handler must return a Response",
    }));
}
function toHeadResponse(response) {
    return new dntShim.Response(null, { status: response.status, headers: response.headers });
}
export function executeAppRoute(handler, request, match, pathname, adapter) {
    const method = request.method.toUpperCase();
    return withSpan("api.executeAppRoute", async () => {
        const handlerModule = handler;
        const handlerFn = handlerModule[method];
        const defaultFn = handlerModule.default;
        let resolvedFn = handlerFn ?? defaultFn;
        if (!resolvedFn && method === "HEAD") {
            resolvedFn = handlerModule.GET;
        }
        if (!resolvedFn)
            return createAppRouteMethodNotAllowed(handlerModule);
        try {
            const appContext = { params: normalizeParams(match.params) };
            const response = await resolvedFn(request, appContext);
            validateResponse(response);
            return method === "HEAD" ? toHeadResponse(response) : response;
        }
        catch (error) {
            return handleAPIError(error, pathname, adapter);
        }
    }, { "http.method": method, "http.path": pathname, "api.route.pattern": match.route.pattern });
}
export function executePagesRoute(handler, request, match, pathname, adapter, projectDir) {
    const method = request.method;
    return withSpan("api.executePagesRoute", async () => {
        const methodHandler = handler[method] ?? handler.default;
        if (!methodHandler) {
            return createPagesRouteMethodNotAllowed(handler);
        }
        try {
            const fs = projectDir ? createProjectScopedFs(adapter.fs, projectDir) : adapter.fs;
            const ctx = createContext(request, match, fs);
            const response = await methodHandler(ctx);
            validateResponse(response);
            return response;
        }
        catch (error) {
            return handleAPIError(error, pathname, adapter);
        }
    }, { "http.method": method, "http.path": pathname, "api.route.pattern": match.route.pattern });
}
