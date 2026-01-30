/**
 * React import rewriting strategy.
 *
 * Priority: 0 (first)
 * Handles: react, react-dom, react/*, react-dom/*
 */
import { getReactImportMap } from "../url-builder.js";
export class ReactStrategy {
    name = "react";
    priority = 0;
    importMapCache = new Map();
    matches(specifier, _ctx) {
        return (specifier === "react" ||
            specifier === "react-dom" ||
            specifier.startsWith("react/") ||
            specifier.startsWith("react-dom/"));
    }
    rewrite(info, ctx) {
        const importMap = this.getImportMap(ctx.reactVersion);
        const mapped = importMap[info.specifier];
        if (mapped) {
            return { specifier: mapped };
        }
        // Handle react/* subpaths not explicitly mapped
        if (info.specifier.startsWith("react/")) {
            const prefix = importMap["react/"];
            if (prefix) {
                const subpath = info.specifier.slice("react/".length);
                return { specifier: prefix + subpath };
            }
        }
        return { specifier: null };
    }
    getImportMap(version) {
        let cached = this.importMapCache.get(version);
        if (!cached) {
            cached = getReactImportMap(version);
            this.importMapCache.set(version, cached);
        }
        return cached;
    }
}
export const reactStrategy = new ReactStrategy();
