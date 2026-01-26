import * as dntShim from "../../../_dnt.shims.js";
import { getDisableLruIntervalEnv } from "../../config/env.js";
import { LRUCache } from "../../utils/lru-wrapper.js";
export class DynamicRouter {
    _routes = new Map();
    routeCache;
    constructor() {
        const disableIntervals = shouldDisableLruInterval();
        this.routeCache = new LRUCache({
            maxEntries: 500,
            ttlMs: disableIntervals ? undefined : 5 * 60 * 1000,
        });
    }
    /** Public accessor for route entries */
    get routes() {
        return this._routes;
    }
    addRoute(pattern, page) {
        const originalPattern = pattern;
        let regex = pattern;
        let isOptionalCatchAll = false;
        let isCatchAll = false;
        const paramNames = [];
        for (const match of originalPattern.matchAll(/\[\[\.\.\.(\w+)\]\]|\[\.\.\.(\w+)\]|\[(\w+)\]/g)) {
            if (match[1]) {
                paramNames.push(match[1]);
                isOptionalCatchAll = true;
                isCatchAll = true;
                continue;
            }
            if (match[2]) {
                paramNames.push(match[2]);
                isCatchAll = true;
                continue;
            }
            if (match[3]) {
                paramNames.push(match[3]);
            }
        }
        regex = regex
            .replace(/\/?\[\[\.\.\.([^\]]+)\]\]/g, "(?:/(.+))?")
            .replace(/\[\.\.\.([^\]]+)\]/g, "(.+)")
            .replace(/\[([^\]]+)\]/g, "([^/]+)");
        if (pattern !== "/" && pattern.endsWith("/")) {
            pattern = pattern.slice(0, -1);
            if (regex.endsWith("/")) {
                regex = regex.slice(0, -1);
            }
        }
        const route = { pattern, page };
        this._routes.set(pattern, {
            regex: new RegExp(`^${regex}$`),
            route,
            paramNames,
            isOptionalCatchAll,
            isCatchAll,
        });
    }
    normalizePathname(path) {
        return path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
    }
    sortRoutesByPriority() {
        return Array.from(this._routes.entries()).sort(([patternA], [patternB]) => {
            const hasParamsA = patternA.includes("[");
            const hasParamsB = patternB.includes("[");
            const isCatchAllA = patternA.includes("[...");
            const isCatchAllB = patternB.includes("[...");
            if (!hasParamsA && hasParamsB)
                return -1;
            if (hasParamsA && !hasParamsB)
                return 1;
            if (!isCatchAllA && isCatchAllB)
                return -1;
            if (isCatchAllA && !isCatchAllB)
                return 1;
            return patternB.split("/").length - patternA.split("/").length;
        });
    }
    match(path) {
        const normalizedPath = this.normalizePathname(path);
        const cached = this.routeCache.get(normalizedPath);
        if (cached !== undefined)
            return cached;
        for (const [, routeData] of this.sortRoutesByPriority()) {
            const match = normalizedPath.match(routeData.regex);
            if (!match)
                continue;
            const params = this.extractParams(match, routeData.paramNames, routeData.route);
            const result = { params, route: routeData.route };
            this.routeCache.set(normalizedPath, result);
            return result;
        }
        this.routeCache.set(normalizedPath, null);
        return null;
    }
    extractParams(match, paramNames, route) {
        const params = {};
        const catchAllParamNames = new Set();
        route.pattern.replace(/\[\[\.\.\.(\w+)\]\]/g, (_, paramName) => {
            catchAllParamNames.add(paramName);
            return "";
        });
        route.pattern.replace(/\[\.\.\.(\w+)\]/g, (_, paramName) => {
            catchAllParamNames.add(paramName);
            return "";
        });
        for (let i = 0; i < paramNames.length; i++) {
            const paramName = paramNames[i];
            const value = match[i + 1];
            if (catchAllParamNames.has(paramName)) {
                const segments = value ? value.split("/").filter((segment) => segment.length > 0) : [];
                params[paramName] = segments.map((segment) => decodeURIComponent(segment));
                continue;
            }
            params[paramName] = decodeURIComponent(value ?? "");
        }
        return params;
    }
    listRoutes() {
        return Array.from(this._routes.values()).map(({ route }) => route);
    }
    clear() {
        this._routes.clear();
        this.routeCache.destroy();
    }
    clearCache() {
        this.routeCache.clear();
    }
    destroy() {
        this.clear();
    }
}
function shouldDisableLruInterval() {
    if (dntShim.dntGlobalThis.__vfDisableLruInterval === true)
        return true;
    try {
        return getDisableLruIntervalEnv();
    }
    catch {
        return false;
    }
}
