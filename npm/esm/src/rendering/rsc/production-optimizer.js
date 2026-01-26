import { HASH_SEED_FNV1A } from "../../utils/index.js";
export class RSCProductionOptimizer {
    static optimizePayload(payload) {
        return {
            html: RSCProductionOptimizer.minifyHTML(payload.html),
            clientRefs: payload.clientRefs,
            assets: payload.assets,
            tree: undefined,
        };
    }
    static minifyHTML(html) {
        return html
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/>\s+</g, "><")
            .trim();
    }
    static getCacheHeaders(options = {}) {
        const { isStatic = false, maxAge = 0 } = options;
        if (!isStatic || maxAge <= 0) {
            return {
                "Cache-Control": "no-cache, no-store, must-revalidate",
                Pragma: "no-cache",
                Expires: "0",
            };
        }
        return {
            "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`,
            "CDN-Cache-Control": `max-age=${maxAge * 4}`,
        };
    }
    static generateETag(payload) {
        let hash = HASH_SEED_FNV1A;
        for (let i = 0; i < payload.html.length; i++) {
            hash ^= payload.html.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        const clientRefKeys = Object.keys(payload.clientRefs).sort();
        for (const key of clientRefKeys) {
            for (let i = 0; i < key.length; i++) {
                hash ^= key.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
        }
        return `"${(hash >>> 0).toString(36)}"`;
    }
    static checkETag(requestETag, payloadETag) {
        if (!requestETag)
            return false;
        const normalizeETag = (etag) => etag.replace(/^W\//, "").replace(/"/g, "");
        return normalizeETag(requestETag) === normalizeETag(payloadETag);
    }
    static optimizeClientRefs(clientRefs, cdnPrefix) {
        if (!cdnPrefix)
            return clientRefs;
        const optimized = {};
        for (const [id, path] of Object.entries(clientRefs)) {
            optimized[id] = `${cdnPrefix}${path}`;
        }
        return optimized;
    }
    static bundlePayloads(payloads) {
        const bundles = {};
        const manifest = {};
        for (const [route, payload] of payloads) {
            const bundleId = RSCProductionOptimizer.generateBundleId(route);
            bundles[bundleId] = RSCProductionOptimizer.optimizePayload(payload);
            manifest[route] = Object.keys(payload.clientRefs);
        }
        return { bundles, manifest };
    }
    static generateBundleId(route) {
        return route.replace(/[^a-zA-Z0-9]/g, "_");
    }
    static generatePreloadLinks(clientRefs) {
        return Object.values(clientRefs).map((path) => `<link rel="modulepreload" href="${path}" as="script" crossorigin>`);
    }
    /**
     * CSP directives for RSC JSON responses.
     * Note: For HTML responses, use the security config with nonce support instead.
     * This is intentionally strict since RSC responses are JSON, not HTML with inline scripts.
     */
    static getCSPDirectives() {
        return {
            "default-src": ["'none'"],
            "script-src": ["'self'", "https://esm.sh"],
            "style-src": ["'self'"],
            "connect-src": ["'self'", "https://esm.sh"],
            "img-src": ["'self'", "data:", "https:"],
            "font-src": ["'self'"],
            "object-src": ["'none'"],
            "base-uri": ["'none'"],
            "form-action": ["'none'"],
            "frame-ancestors": ["'none'"],
            "upgrade-insecure-requests": [],
        };
    }
    static generateCSP() {
        const directives = RSCProductionOptimizer.getCSPDirectives();
        return Object.entries(directives)
            .map(([key, values]) => (values.length === 0 ? key : `${key} ${values.join(" ")}`))
            .join("; ");
    }
}
