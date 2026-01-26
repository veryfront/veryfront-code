import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import { ResponseBuilder } from "../../../security/index.js";
import { HTTP_INTERNAL_SERVER_ERROR, HTTP_OK, PRIORITY_HIGH, } from "../../../utils/constants/index.js";
import { checkMemoryPressure, forceGC, getCacheStats, getHeapStats, getMemorySnapshot, } from "../../../utils/memory/index.js";
import { rendererLogger as logger } from "../../../utils/index.js";
export class MemoryDebugHandler extends BaseHandler {
    metadata = {
        name: "MemoryDebugHandler",
        priority: PRIORITY_HIGH,
        patterns: [{ pattern: "/_debug/memory", prefix: true }],
    };
    async handle(req, ctx) {
        const pathname = new URL(req.url).pathname;
        if (!pathname.startsWith("/_debug/memory")) {
            return this.continue();
        }
        try {
            switch (pathname) {
                case "/_debug/memory":
                case "/_debug/memory/":
                    return this.handleFullSnapshot(req, ctx);
                case "/_debug/memory/heap":
                    return this.handleHeapStats(req, ctx);
                case "/_debug/memory/caches":
                    return this.handleCacheStats(req, ctx);
                case "/_debug/memory/gc":
                    return await this.handleGC(req, ctx);
                case "/_debug/memory/pressure":
                    return this.handlePressureCheck(req, ctx);
                default:
                    return this.continue();
            }
        }
        catch (error) {
            logger.error("[MemoryDebugHandler] Error", { error });
            const response = ResponseBuilder.error(HTTP_INTERNAL_SERVER_ERROR, "Failed to get memory info", req, this.getSecurityOptions(ctx));
            return this.respond(response);
        }
    }
    getSecurityOptions(ctx) {
        return {
            securityConfig: ctx.securityConfig ?? undefined,
            corsConfig: ctx.securityConfig?.cors,
        };
    }
    jsonResponse(data, req, ctx) {
        const response = ResponseBuilder.json(data, req, {
            ...this.getSecurityOptions(ctx),
            status: HTTP_OK,
        });
        return this.respond(response);
    }
    handleFullSnapshot(req, ctx) {
        return this.jsonResponse(getMemorySnapshot(), req, ctx);
    }
    handleHeapStats(req, ctx) {
        return this.jsonResponse({
            timestamp: new Date().toISOString(),
            heap: getHeapStats(),
        }, req, ctx);
    }
    handleCacheStats(req, ctx) {
        const caches = getCacheStats();
        return this.jsonResponse({
            timestamp: new Date().toISOString(),
            caches,
            totalEntries: caches.reduce((sum, c) => sum + Math.max(0, c.entries), 0),
        }, req, ctx);
    }
    async handleGC(req, ctx) {
        const beforeHeap = getHeapStats();
        const gcTriggered = await forceGC();
        // Wait a bit for GC to complete
        await new Promise((resolve) => dntShim.setTimeout(resolve, 200));
        const afterHeap = getHeapStats();
        return this.jsonResponse({
            timestamp: new Date().toISOString(),
            gcTriggered,
            before: beforeHeap,
            after: afterHeap,
            freedMB: Math.round((beforeHeap.usedHeapSizeMB - afterHeap.usedHeapSizeMB) * 100) / 100,
        }, req, ctx);
    }
    handlePressureCheck(req, ctx) {
        const pressure = checkMemoryPressure();
        return this.jsonResponse({
            timestamp: new Date().toISOString(),
            ...pressure,
            heap: getHeapStats(),
            recommendations: this.getRecommendations(pressure),
        }, req, ctx);
    }
    getRecommendations(pressure) {
        if (pressure.critical) {
            return [
                "CRITICAL: Consider restarting the pod",
                "Clear all caches immediately",
                "Check for memory leaks in recent deployments",
            ];
        }
        if (pressure.warning) {
            return [
                "Monitor memory usage closely",
                "Consider clearing large caches",
                "Review cache TTL settings",
            ];
        }
        return ["Memory usage is healthy"];
    }
}
