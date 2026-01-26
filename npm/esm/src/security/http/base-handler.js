import { runWithCacheBatching } from "../../cache/request-cache-batcher.js";
import { serverLogger } from "../../utils/index.js";
import { ResponseBuilder } from "./response/index.js";
export class BaseHandler {
    helpers;
    constructor() {
        this.helpers = {
            createResponseBuilder: this.createResponseBuilder.bind(this),
            respond: this.respond.bind(this),
            logDebug: this.logDebug.bind(this),
            getErrorMessage: this.getErrorMessage.bind(this),
            continue: this.continue.bind(this),
        };
    }
    shouldHandle(req, ctx) {
        if (this.metadata.enabled && !this.metadata.enabled(ctx))
            return false;
        const patterns = this.metadata.patterns;
        if (!patterns?.length)
            return true;
        const { pathname } = new URL(req.url);
        const method = req.method.toUpperCase();
        for (const pattern of patterns) {
            if (this.matchesPattern(pathname, method, pattern))
                return true;
        }
        return false;
    }
    matchesPattern(pathname, method, pattern) {
        if (pattern.method) {
            const methods = (Array.isArray(pattern.method) ? pattern.method : [pattern.method]).map((m) => m.toUpperCase());
            if (!methods.includes(method))
                return false;
        }
        const routePattern = pattern.pattern;
        if (typeof routePattern === "string") {
            if (pattern.prefix)
                return pathname.startsWith(routePattern);
            return pathname === routePattern;
        }
        if (routePattern instanceof RegExp) {
            return routePattern.test(pathname);
        }
        return false;
    }
    createResponseBuilder(ctx, nonce, _options) {
        return new ResponseBuilder({
            securityConfig: ctx.securityConfig ?? undefined,
            isDev: ctx.requestContext?.isLocalDev ?? false,
            cspUserHeader: ctx.cspUserHeader,
            adapter: ctx.adapter,
            nonce,
            isVeryfrontDomain: ctx.parsedDomain?.allowIframeEmbed ?? false,
        });
    }
    logDebug(message, extra, ctx) {
        if (!ctx?.debug && !ctx?.adapter.env.get("VERYFRONT_DEBUG"))
            return;
        serverLogger.debug(`[${this.metadata.name}] ${message}`, extra ?? undefined);
    }
    logInfo(message, extra, _ctx) {
        serverLogger.info(`[${this.metadata.name}] ${message}`, extra ?? undefined);
    }
    getErrorMessage(error) {
        if (error instanceof Error)
            return error.message;
        return String(error);
    }
    continue() {
        return { continue: true };
    }
    respond(response, metadata) {
        return { response, continue: false, metadata };
    }
    withProxyContext(ctx, fn, options = {}) {
        const fsWrapper = ctx.adapter.fs;
        if (typeof fsWrapper.setRequestBranch === "function") {
            try {
                fsWrapper.setRequestBranch(ctx.parsedDomain?.branch ?? null);
            }
            catch {
                // Ignore - multi-project mode uses runWithContext for branch context
            }
        }
        const requireToken = options.requireToken ?? false;
        const hasSlug = !!ctx.projectSlug;
        const hasToken = !!ctx.proxyToken;
        if (!hasSlug || (requireToken && !hasToken))
            return fn();
        if (typeof fsWrapper.isMultiProjectMode === "function" && fsWrapper.isMultiProjectMode()) {
            const isProduction = (ctx.resolvedEnvironment ?? ctx.requestContext?.mode) === "production";
            const branch = ctx.parsedDomain?.branch ?? null;
            this.logDebug("[withProxyContext] Setting up multi-project context", {
                projectSlug: ctx.projectSlug,
                productionMode: isProduction,
                releaseId: ctx.releaseId,
                branch,
            }, ctx);
            return fsWrapper.runWithContext(ctx.projectSlug, ctx.proxyToken || "", fn, ctx.projectId, { productionMode: isProduction, releaseId: ctx.releaseId, branch });
        }
        if (typeof fsWrapper.setRequestToken === "function" && ctx.proxyToken) {
            fsWrapper.setRequestToken(ctx.proxyToken);
        }
        return runWithCacheBatching(fn);
    }
}
