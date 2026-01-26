import type { RSCPayload } from "./types.js";
import { HASH_SEED_FNV1A } from "../../utils/index.js";

export class RSCProductionOptimizer {
  static optimizePayload(payload: RSCPayload): RSCPayload {
    return {
      html: RSCProductionOptimizer.minifyHTML(payload.html),
      clientRefs: payload.clientRefs,
      assets: payload.assets,
      tree: undefined,
    };
  }

  private static minifyHTML(html: string): string {
    return html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/>\s+</g, "><")
      .trim();
  }

  static getCacheHeaders(
    options: { isStatic?: boolean; maxAge?: number } = {},
  ): Record<string, string> {
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

  static generateETag(payload: RSCPayload): string {
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

  static checkETag(requestETag: string | null, payloadETag: string): boolean {
    if (!requestETag) return false;

    const normalizeETag = (etag: string) => etag.replace(/^W\//, "").replace(/"/g, "");

    return normalizeETag(requestETag) === normalizeETag(payloadETag);
  }

  static optimizeClientRefs(
    clientRefs: Record<string, string>,
    cdnPrefix?: string,
  ): Record<string, string> {
    if (!cdnPrefix) return clientRefs;

    const optimized: Record<string, string> = {};
    for (const [id, path] of Object.entries(clientRefs)) {
      optimized[id] = `${cdnPrefix}${path}`;
    }

    return optimized;
  }

  static bundlePayloads(payloads: Map<string, RSCPayload>): {
    bundles: Record<string, RSCPayload>;
    manifest: Record<string, string[]>;
  } {
    const bundles: Record<string, RSCPayload> = {};
    const manifest: Record<string, string[]> = {};

    for (const [route, payload] of payloads) {
      const bundleId = RSCProductionOptimizer.generateBundleId(route);
      bundles[bundleId] = RSCProductionOptimizer.optimizePayload(payload);
      manifest[route] = Object.keys(payload.clientRefs);
    }

    return { bundles, manifest };
  }

  private static generateBundleId(route: string): string {
    return route.replace(/[^a-zA-Z0-9]/g, "_");
  }

  static generatePreloadLinks(clientRefs: Record<string, string>): string[] {
    return Object.values(clientRefs).map(
      (path) => `<link rel="modulepreload" href="${path}" as="script" crossorigin>`,
    );
  }

  /**
   * CSP directives for RSC JSON responses.
   * Note: For HTML responses, use the security config with nonce support instead.
   * This is intentionally strict since RSC responses are JSON, not HTML with inline scripts.
   */
  static getCSPDirectives(): Record<string, string[]> {
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

  static generateCSP(): string {
    const directives = RSCProductionOptimizer.getCSPDirectives();

    return Object.entries(directives)
      .map(([key, values]) => (values.length === 0 ? key : `${key} ${values.join(" ")}`))
      .join("; ");
  }
}
