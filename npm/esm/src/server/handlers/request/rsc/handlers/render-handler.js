import * as dntShim from "../../../../../../_dnt.shims.js";
import { serverLogger as logger } from "../../../../../utils/index.js";
import { RSCProductionOptimizer } from "../../../../../rendering/rsc/production-optimizer.js";
import { createError, toError } from "../../../../../errors/veryfront-error.js";
import { extractParams, resolveComponentPath } from "./component-resolver.js";
export class RenderHandler {
    projectDir;
    getRenderer;
    isLocalDev;
    constructor(projectDir, getRenderer, isLocalDev = false) {
        this.projectDir = projectDir;
        this.getRenderer = getRenderer;
        this.isLocalDev = isLocalDev;
    }
    async handle(pathname, searchParams, request) {
        try {
            const component = await this.loadComponent(pathname);
            const props = this.buildProps(pathname, searchParams);
            const payload = await this.renderPayload(component, props);
            return this.createResponse(payload, request);
        }
        catch (error) {
            return this.createErrorResponse(error);
        }
    }
    async loadComponent(pathname) {
        const componentPath = await resolveComponentPath(pathname, this.projectDir);
        if (!componentPath) {
            throw toError(createError({
                type: "render",
                message: "Component not found",
            }));
        }
        const module = await import(componentPath);
        const moduleObj = module;
        const Component = (moduleObj.default || moduleObj.Page || module);
        if (typeof Component !== "function") {
            throw toError(createError({
                type: "config",
                message: "Invalid component",
            }));
        }
        return Component;
    }
    buildProps(pathname, searchParams) {
        return {
            params: extractParams(pathname),
            searchParams: Object.fromEntries(searchParams),
        };
    }
    async renderPayload(component, props) {
        const renderer = this.getRenderer();
        if (!renderer) {
            throw toError(createError({
                type: "render",
                message: "Renderer not initialized",
            }));
        }
        const payload = await renderer.renderToPayload(component, props);
        if (!payload) {
            throw toError(createError({
                type: "render",
                message: "Failed to render RSC payload",
            }));
        }
        return this.isLocalDev ? payload : RSCProductionOptimizer.optimizePayload(payload);
    }
    createResponse(payload, request) {
        const etag = RSCProductionOptimizer.generateETag(payload);
        if (request && this.shouldReturn304(request, etag)) {
            return new dntShim.Response(null, { status: 304 });
        }
        return new dntShim.Response(JSON.stringify(payload), {
            headers: this.buildHeaders(etag),
        });
    }
    shouldReturn304(request, etag) {
        return RSCProductionOptimizer.checkETag(request.headers.get("if-none-match"), etag);
    }
    buildHeaders(etag) {
        const isProd = !this.isLocalDev;
        const headers = {
            "content-type": "application/json",
            etag,
            ...RSCProductionOptimizer.getCacheHeaders({
                isStatic: false,
                maxAge: isProd ? 60 : 0,
            }),
        };
        if (isProd) {
            headers["content-security-policy"] = RSCProductionOptimizer.generateCSP();
        }
        return headers;
    }
    createErrorResponse(error) {
        logger.error("[RSC] Render error:", error);
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        return new dntShim.Response(JSON.stringify({
            error: "Render error",
            message: normalizedError.message,
            stack: this.isLocalDev ? normalizedError.stack : undefined,
        }), {
            status: normalizedError.message === "Component not found" ? 404 : 500,
            headers: { "content-type": "application/json" },
        });
    }
}
