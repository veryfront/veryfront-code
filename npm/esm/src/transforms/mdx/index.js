import { rendererLogger as logger } from "../../utils/index.js";
import { LRUCache } from "../../utils/lru-wrapper.js";
import { MDX_RENDERER_MAX_ENTRIES, MDX_RENDERER_TTL_MS } from "../../utils/constants/cache.js";
import React from "react";
import { loadModuleESM } from "./esm-module-loader/index.js";
import { parseMDXCode } from "./parser.js";
export class MDXRenderer {
    // NOTE: We intentionally do NOT cache esmCacheDir here.
    // Each call to loadModuleESM gets the cache dir fresh from getMdxEsmCacheDir()
    // which uses AsyncLocalStorage for proper isolation in parallel tests.
    // Caching it would cause race conditions where parallel tests corrupt each other's state.
    moduleCache = new LRUCache({
        maxEntries: MDX_RENDERER_MAX_ENTRIES,
        ttlMs: MDX_RENDERER_TTL_MS,
    });
    clearCache() {
        this.moduleCache.destroy();
        // Note: We don't track/cleanup esmCacheDir here anymore.
        // Each test context manages its own cache dir via AsyncLocalStorage.
        // The temp directories are cleaned up by the test context's cleanup().
    }
    loadModuleESM(compiledProgramCode, adapter, projectId, projectDir, projectSlug, contentSourceId) {
        // Don't pass esmCacheDir - let loadModuleESM get it fresh from getMdxEsmCacheDir()
        // which respects AsyncLocalStorage for proper test isolation
        const context = {
            esmCacheDir: undefined, // Always get fresh from getMdxEsmCacheDir()
            moduleCache: this.moduleCache,
            adapter,
            projectId,
            projectDir,
            projectSlug,
            contentSourceId, // For cache isolation between preview/production
        };
        return loadModuleESM(compiledProgramCode, context);
    }
    render(_compiledCode, _options = {}) {
        logger.error("[MDX] Synchronous render() called but string-based factories are disabled for security. " +
            "Please use: await mdxRenderer.loadModuleESM(compiledCode) instead.");
        return React.createElement("div", {
            style: {
                padding: "1rem",
                backgroundColor: "#fff3cd",
                border: "1px solid #ffc107",
                borderRadius: "0.375rem",
                color: "#856404",
            },
        }, React.createElement("strong", {}, "Migration Required: "), "Synchronous render() is no longer supported for security reasons. ", React.createElement("br"), "Please update to: ", React.createElement("code", {}, "await mdxRenderer.loadModuleESM(compiledCode)"));
    }
    parseMDXCode(compiledCode) {
        return parseMDXCode(compiledCode);
    }
}
let mdxRendererInstance;
function getMDXRendererInstance() {
    mdxRendererInstance ??= new MDXRenderer();
    return mdxRendererInstance;
}
export const mdxRenderer = new Proxy({}, {
    get(_target, prop) {
        const instance = getMDXRendererInstance();
        const value = instance[prop];
        return typeof value === "function" ? value.bind(instance) : value;
    },
    set(_target, prop, value) {
        const instance = getMDXRendererInstance();
        instance[prop] = value;
        return true;
    },
    has(_target, prop) {
        return prop in getMDXRendererInstance();
    },
    ownKeys() {
        return Reflect.ownKeys(getMDXRendererInstance());
    },
    getOwnPropertyDescriptor(_target, prop) {
        return Reflect.getOwnPropertyDescriptor(getMDXRendererInstance(), prop);
    },
});
export function clearMDXRendererCache() {
    getMDXRendererInstance().clearCache();
}
export { MDXCacheAdapter, } from "./mdx-cache-adapter.js";
