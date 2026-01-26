import { BaseHandler } from "../../response/base.js";
import { getApiHandler } from "./pages-api-handler.js";
import { PRIORITY_MEDIUM_API } from "../../../../utils/constants/index.js";
import { withSpan } from "../../../../observability/tracing/otlp-setup.js";
/**
 * API handler wrapper for Pages and App Router
 *
 * Handles:
 * - Pages Router API routes (/api/*)
 * - App Router route.ts handlers
 *
 * @example
 * ```ts
 * const handler = new ApiHandlerWrapper(projectDir, adapter);
 * const result = await handler.handle(request, context);
 * ```
 */
export class ApiHandlerWrapper extends BaseHandler {
    projectDir;
    adapter;
    initPromise = null;
    metadata = {
        name: "ApiHandlerWrapper",
        priority: PRIORITY_MEDIUM_API, // MEDIUM priority
    };
    constructor(projectDir, adapter) {
        super();
        this.projectDir = projectDir;
        this.adapter = adapter;
    }
    /**
     * Pre-initialize the API handler to discover routes before any requests
     * Call this after construction to avoid first-request 404s
     */
    async initialize() {
        if (!this.initPromise) {
            this.initPromise = (async () => {
                // Pre-warm the API handler cache
                await getApiHandler({
                    projectDir: this.projectDir,
                    adapter: this.adapter,
                });
            })();
        }
        await this.initPromise;
    }
    /**
     * Handles incoming requests for API routes
     *
     * @param req - The incoming request
     * @param ctx - Handler context
     * @returns Handler result (respond or continue)
     */
    async handle(req, ctx) {
        const { pathname } = new URL(req.url);
        this.logDebug("[API-Wrapper] Handling request", {
            pathname,
            projectDir: ctx.projectDir,
            projectSlug: ctx.projectSlug,
        }, ctx);
        const fsWrapper = ctx.adapter.fs;
        if (!ctx.projectSlug ||
            typeof fsWrapper.isMultiProjectMode !== "function" ||
            !fsWrapper.isMultiProjectMode()) {
            return await this.handleWithContext(req, ctx, pathname);
        }
        const isProduction = ctx.requestContext?.mode === "production";
        this.logDebug("[API-Wrapper] Using multi-project context", {
            projectSlug: ctx.projectSlug,
            projectId: ctx.projectId,
            hasProxyToken: !!ctx.proxyToken,
            productionMode: isProduction,
        }, ctx);
        return await fsWrapper.runWithContext(ctx.projectSlug, ctx.proxyToken || "", () => this.handleWithContext(req, ctx, pathname), ctx.projectId, { productionMode: isProduction, releaseId: ctx.releaseId });
    }
    /**
     * Internal handler that runs within project context
     */
    handleWithContext(req, ctx, pathname) {
        return withSpan("api.handleWithContext", async () => {
            try {
                const api = await getApiHandler(ctx);
                const apiRes = await api.handle(req);
                if (!apiRes) {
                    this.logDebug("[API-Wrapper] API handler returned null, continuing to next handler", { pathname }, ctx);
                    return this.continue();
                }
                this.logDebug("[API-Wrapper] API handler returned response", { pathname, status: apiRes.status }, ctx);
                const builder = this.createResponseBuilder(ctx);
                const finalRes = builder
                    .withCORS(req, ctx.securityConfig?.cors)
                    .withSecurity(ctx.securityConfig ?? undefined)
                    .withHeaders(apiRes.headers)
                    .build(apiRes.body, apiRes.status);
                return this.respond(finalRes);
            }
            catch (error) {
                this.logDebug("[API-Wrapper] API handler error - falling through to next handler", {
                    pathname,
                    error: this.getErrorMessage(error),
                    stack: error instanceof Error ? error.stack : undefined,
                }, ctx);
                return this.continue();
            }
        }, {
            "api.pathname": pathname,
            "api.method": req.method,
            "api.projectSlug": ctx.projectSlug || "unknown",
        });
    }
}
