/**
 * Production optimizations for RSC
 */

import type { RSCPayload } from "./types.ts";
import { HASH_SEED_FNV1A } from "@veryfront/utils";

export class RSCProductionOptimizer {
  /**
   * Minify RSC payload for production
   */
  static optimizePayload(payload: RSCPayload): RSCPayload {
    return {
      html: RSCProductionOptimizer.minifyHTML(payload.html),
      clientRefs: payload.clientRefs,
      assets: payload.assets,
      // Remove debug tree in production
      tree: undefined,
    };
  }

  /**
   * Basic HTML minification
   */
  private static minifyHTML(html: string): string {
    return (
      html
        // Remove comments
        .replace(/<!--[\s\S]*?-->/g, "")
        // Remove unnecessary whitespace between tags
        .replace(/>\s+</g, "><")
        // Remove leading/trailing whitespace
        .trim()
    );
  }

  /**
   * Generate cache headers for RSC responses
   */
  static getCacheHeaders(
    options: { isStatic?: boolean; maxAge?: number } = {},
  ): Record<string, string> {
    const { isStatic = false, maxAge = 0 } = options;

    if (isStatic && maxAge > 0) {
      return {
        "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`,
        "CDN-Cache-Control": `max-age=${maxAge * 4}`,
      };
    }

    return {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    };
  }

  /**
   * Generate ETag for payload
   * Streams hash without JSON serialization (3-5x faster)
   */
  static generateETag(payload: RSCPayload): string {
    // Stream hash without creating intermediate JSON string
    let hash = HASH_SEED_FNV1A;

    // Hash the HTML content directly
    for (let i = 0; i < payload.html.length; i++) {
      hash ^= payload.html.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    // Hash sorted client ref keys
    const clientRefKeys = Object.keys(payload.clientRefs).sort();
    for (const key of clientRefKeys) {
      for (let i = 0; i < key.length; i++) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
    }

    return `"${(hash >>> 0).toString(36)}"`;
  }

  /**
   * Check if request matches ETag
   */
  static checkETag(requestETag: string | null, payloadETag: string): boolean {
    if (!requestETag) return false;

    // Handle weak ETags
    const normalizeETag = (etag: string) => etag.replace(/^W\//, "").replace(/"/g, "");

    return normalizeETag(requestETag) === normalizeETag(payloadETag);
  }

  /**
   * Optimize client references for production
   */
  static optimizeClientRefs(
    clientRefs: Record<string, string>,
    cdnPrefix?: string,
  ): Record<string, string> {
    if (!cdnPrefix) return clientRefs;

    const optimized: Record<string, string> = {};

    for (const [id, path] of Object.entries(clientRefs)) {
      // Add CDN prefix and version hash
      optimized[id] = `${cdnPrefix}${path}`;
    }

    return optimized;
  }

  /**
   * Bundle multiple RSC payloads for route prefetching
   */
  static bundlePayloads(payloads: Map<string, RSCPayload>): {
    bundles: Record<string, RSCPayload>;
    manifest: Record<string, string[]>;
  } {
    const bundles: Record<string, RSCPayload> = {};
    const manifest: Record<string, string[]> = {};

    for (const [route, payload] of payloads) {
      const bundleId = RSCProductionOptimizer.generateBundleId(route);
      bundles[bundleId] = RSCProductionOptimizer.optimizePayload(payload);

      // Track which client components are used by each route
      manifest[route] = Object.keys(payload.clientRefs);
    }

    return { bundles, manifest };
  }

  /**
   * Generate stable bundle ID from route
   */
  private static generateBundleId(route: string): string {
    return route.replace(/[^a-zA-Z0-9]/g, "_");
  }

  /**
   * Preload directives for client components
   */
  static generatePreloadLinks(clientRefs: Record<string, string>): string[] {
    const links: string[] = [];

    for (const [_id, path] of Object.entries(clientRefs)) {
      links.push(`<link rel="modulepreload" href="${path}" as="script" crossorigin>`);
    }

    return links;
  }

  /**
   * Content Security Policy for RSC
   */
  static getCSPDirectives(): Record<string, string[]> {
    return {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "https://esm.sh"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "connect-src": ["'self'", "https://esm.sh"],
      "img-src": ["'self'", "data:", "https:"],
      "font-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
      "upgrade-insecure-requests": [],
    };
  }

  /**
   * Generate CSP header value
   */
  static generateCSP(): string {
    const directives = RSCProductionOptimizer.getCSPDirectives();

    return Object.entries(directives)
      .map(([key, values]) => {
        if (values.length === 0) return key;
        return `${key} ${values.join(" ")}`;
      })
      .join("; ");
  }
}
