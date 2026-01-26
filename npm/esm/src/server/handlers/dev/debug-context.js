import { BaseHandler } from "../response/base.js";
import { HTTP_OK, PRIORITY_HIGH_DEV } from "../../../utils/constants/index.js";
import { getSSRModuleCacheStats } from "../../../modules/react-loader/ssr-module-loader/index.js";
export class DebugContextHandler extends BaseHandler {
    metadata = {
        name: "DebugContextHandler",
        priority: PRIORITY_HIGH_DEV,
        patterns: [{ pattern: "/_vf_debug/context", exact: true }],
        // Only enable in local development - debug endpoints should not be exposed in production
        enabled: (ctx) => ctx.requestContext?.isLocalDev ?? false,
    };
    handle(req, ctx) {
        if (!this.shouldHandle(req, ctx)) {
            return Promise.resolve(this.continue());
        }
        const token = req.headers.get("x-token");
        const url = new URL(req.url);
        const debugInfo = {
            timestamp: new Date().toISOString(),
            request: {
                url: req.url,
                host: url.host,
                headers: {
                    "x-project-slug": req.headers.get("x-project-slug"),
                    "x-token": token ? `[${token.length} chars]` : null,
                    "x-environment": req.headers.get("x-environment"),
                    "x-release-id": req.headers.get("x-release-id"),
                    "x-project-id": req.headers.get("x-project-id"),
                },
            },
            context: {
                projectSlug: ctx.projectSlug,
                projectId: ctx.projectId,
                projectDir: ctx.projectDir,
                proxyToken: ctx.proxyToken ? `[${ctx.proxyToken.length} chars]` : null,
                requestContext: ctx.requestContext
                    ? {
                        mode: ctx.requestContext.mode,
                        slug: ctx.requestContext.slug,
                        branch: ctx.requestContext.branch,
                        hasToken: !!ctx.requestContext.token,
                    }
                    : null,
                releaseId: ctx.releaseId,
                parsedDomain: ctx.parsedDomain,
            },
            adapter: {
                type: ctx.adapter?.fs?.constructor?.name ?? "unknown",
                isMultiProjectMode: this.checkMultiProjectMode(ctx),
                managerStats: this.getManagerStats(ctx),
            },
            ssrModuleCache: getSSRModuleCacheStats(),
        };
        const response = this.createResponseBuilder(ctx).withCache("no-cache").json(debugInfo, HTTP_OK);
        return Promise.resolve(this.respond(response));
    }
    checkMultiProjectMode(ctx) {
        try {
            const fs = ctx.adapter?.fs;
            return typeof fs?.isMultiProjectMode === "function" && fs.isMultiProjectMode();
        }
        catch {
            return false;
        }
    }
    getManagerStats(ctx) {
        try {
            const fs = ctx.adapter?.fs;
            if (typeof fs?.getUnderlyingAdapter !== "function") {
                return null;
            }
            const underlying = fs.getUnderlyingAdapter();
            if (typeof underlying?.getManagerStats !== "function") {
                return null;
            }
            return underlying.getManagerStats();
        }
        catch {
            return null;
        }
    }
}
