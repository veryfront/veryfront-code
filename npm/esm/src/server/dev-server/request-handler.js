import * as dntShim from "../../../_dnt.shims.js";
import { DEV_SERVER_ENDPOINTS, HTTP_CONTENT_TYPES, HTTP_OK, HTTP_SERVER_ERROR, HTTP_UNAVAILABLE, serverLogger as logger, } from "../../utils/index.js";
import { clearConfigCache } from "../../config/index.js";
import { ErrorOverlay } from "./error-overlay/index.js";
import { createResponseBuilder } from "../../security/index.js";
import { resetApiHandler } from "../handlers/request/api/pages-api-handler.js";
import { clearLayoutDiscoveryCache } from "../../rendering/layouts/index.js";
export class RequestHandler {
    projectDir;
    adapter;
    isReady;
    isDebug;
    hmrServer;
    config;
    universalHandler;
    constructor(projectDir, adapter, isReady, isDebug, hmrServer, config) {
        this.projectDir = projectDir;
        this.adapter = adapter;
        this.isReady = isReady;
        this.isDebug = isDebug;
        this.hmrServer = hmrServer;
        this.config = config;
    }
    async handleRequest(req) {
        const url = new URL(req.url);
        logger.debug(`Request: ${req.method} ${url.pathname}`);
        const healthResponse = this.handleHealthCheck(url.pathname);
        if (healthResponse)
            return healthResponse;
        this.incrementRequestMetrics();
        try {
            const devResponse = this.handleDevEndpoint(req, url.pathname);
            if (devResponse)
                return devResponse;
            return await this.handleApplicationRequest(req);
        }
        catch (error) {
            return this.handleServerError(error);
        }
    }
    handleHealthCheck(pathname) {
        if (pathname === "/healthz") {
            return new dntShim.Response("ok", {
                status: HTTP_OK,
                headers: { "content-type": "text/plain" },
            });
        }
        if (pathname === "/readyz") {
            const ready = this.isReady();
            return new dntShim.Response(ready ? "ready" : "not-ready", {
                status: ready ? HTTP_OK : HTTP_UNAVAILABLE,
                headers: { "content-type": "text/plain" },
            });
        }
        return null;
    }
    incrementRequestMetrics() {
        import("../../observability/simple-metrics/index.js")
            .then(({ metrics }) => metrics.incRequest())
            .catch((error) => logger.debug("[dev] metrics.incRequest failed", error));
    }
    handleDevEndpoint(req, pathname) {
        const normalized = this.normalizeDevEndpoint(pathname);
        if (!normalized)
            return null;
        const isHeadRequest = req.method.toUpperCase() === "HEAD";
        const builder = createResponseBuilder({ isDev: true }).withHeaders({
            "cache-control": "no-cache",
            "X-Content-Type-Options": "nosniff",
        });
        if (normalized === DEV_SERVER_ENDPOINTS.HMR_RUNTIME) {
            if (!this.hmrServer)
                return null;
            if (isHeadRequest)
                return builder.withContentType(HTTP_CONTENT_TYPES.JS, "", HTTP_OK);
            const runtime = this.getHMRRuntime();
            if (runtime === null)
                return null;
            return builder.withContentType(HTTP_CONTENT_TYPES.JS, runtime, HTTP_OK);
        }
        if (normalized === DEV_SERVER_ENDPOINTS.ERROR_OVERLAY) {
            const overlay = isHeadRequest ? null : ErrorOverlay.getRuntime();
            return builder.withContentType(HTTP_CONTENT_TYPES.JS, overlay, HTTP_OK);
        }
        return null;
    }
    normalizeDevEndpoint(pathname) {
        const validEndpoints = new Set([
            DEV_SERVER_ENDPOINTS.HMR_RUNTIME,
            DEV_SERVER_ENDPOINTS.ERROR_OVERLAY,
        ]);
        if (validEndpoints.has(pathname))
            return pathname;
        if (!pathname.startsWith("/__veryfront/"))
            return null;
        const rewritten = pathname.replace("/__veryfront/", "/_veryfront/");
        return validEndpoints.has(rewritten) ? rewritten : null;
    }
    getHMRRuntime() {
        const runtimeProvider = this.hmrServer;
        if (typeof runtimeProvider?.getHMRRuntime !== "function")
            return null;
        try {
            return runtimeProvider.getHMRRuntime();
        }
        catch (error) {
            logger.debug("[dev] failed to read HMR runtime from server", error);
            return null;
        }
    }
    async handleApplicationRequest(req) {
        if (!this.universalHandler) {
            const { createVeryfrontHandler } = await import("../universal-handler/index.js");
            this.universalHandler = createVeryfrontHandler(this.projectDir, this.adapter, {
                projectDir: this.projectDir,
                debug: this.isDebug(),
                // Module server is integrated into main server at /_vf_modules/
                // Use relative path since modules are served on the same server
                moduleServerUrl: "/_vf_modules",
                config: this.config,
                // Dev server always runs in local development mode
                envConfig: { isLocalDev: true },
            });
        }
        return this.universalHandler(req);
    }
    invalidateUniversalHandler() {
        this.universalHandler = undefined;
        // Also reset the API handler cache to pick up new/modified handlers
        resetApiHandler(this.projectDir).catch((error) => {
            logger.debug("[dev] resetApiHandler failed", error);
        });
        // Clear config cache so HMR picks up config changes
        clearConfigCache();
        // Clear layout discovery cache so HMR picks up layout changes
        clearLayoutDiscoveryCache();
    }
    handleServerError(error) {
        logger.error("Server error:", error);
        return new dntShim.Response(ErrorOverlay.createHTML({
            type: "runtime",
            error: error,
        }), {
            status: HTTP_SERVER_ERROR,
            headers: { "content-type": "text/html; charset=utf-8" },
        });
    }
}
