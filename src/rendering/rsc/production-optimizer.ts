import type { RSCPayload } from "./types.ts";
import { HASH_SEED_FNV1A } from "#veryfront/utils";
import { escapeHtml } from "#veryfront/html/html-escape.ts";

const FNV_PRIME = 16_777_619;
const SECOND_HASH_SEED = HASH_SEED_FNV1A ^ 0x9e3779b9;

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
    // Rewriting HTML with regular expressions corrupts script, style, template,
    // and preformatted content. Outer trimming is lossless for the generated
    // document and leaves structural minification to the build pipeline.
    return html.trim();
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
    const parts = [payload.html];
    for (const key of Object.keys(payload.clientRefs).sort()) {
      parts.push(key, payload.clientRefs[key] ?? "");
    }
    parts.push(...(payload.assets?.css ?? []), ...(payload.assets?.js ?? []));

    let first = HASH_SEED_FNV1A;
    let second = SECOND_HASH_SEED;
    for (const part of parts) {
      const framed = `${part.length}:${part};`;
      for (let index = 0; index < framed.length; index++) {
        const code = framed.charCodeAt(index);
        first = Math.imul(first ^ code, FNV_PRIME);
        second = Math.imul(second ^ code, FNV_PRIME);
      }
    }

    return `"${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}"`;
  }

  static checkETag(requestETag: string | null, payloadETag: string): boolean {
    if (!requestETag) return false;

    const normalizeETag = (etag: string): string => etag.trim().replace(/^W\//, "");
    const expected = normalizeETag(payloadETag);
    return requestETag.split(",").some((candidate) => {
      const normalized = normalizeETag(candidate);
      return normalized === "*" || normalized === expected;
    });
  }

  static optimizeClientRefs(
    clientRefs: Record<string, string>,
    cdnPrefix?: string,
  ): Record<string, string> {
    if (!cdnPrefix) return clientRefs;

    return Object.fromEntries(
      Object.entries(clientRefs).map(([id, path]) => [id, `${cdnPrefix}${path}`]),
    );
  }

  static bundlePayloads(payloads: Map<string, RSCPayload>): {
    bundles: Record<string, RSCPayload>;
    manifest: Record<string, string[]>;
  } {
    const bundles: Record<string, RSCPayload> = Object.create(null);
    const manifest: Record<string, string[]> = Object.create(null);

    for (const [route, payload] of payloads) {
      const bundleId = RSCProductionOptimizer.generateBundleId(route);
      if (Object.hasOwn(bundles, bundleId)) {
        throw new Error("RSC bundle identifier collision");
      }
      bundles[bundleId] = RSCProductionOptimizer.optimizePayload(payload);
      Object.defineProperty(manifest, route, {
        configurable: true,
        enumerable: true,
        value: Object.keys(payload.clientRefs),
        writable: true,
      });
    }

    return { bundles, manifest };
  }

  private static generateBundleId(route: string): string {
    if (route === "/") return "_";
    const readable = route.replace(/[^a-zA-Z0-9]/g, "_") || "_";
    let hash = HASH_SEED_FNV1A;
    for (let index = 0; index < route.length; index++) {
      hash = Math.imul(hash ^ route.charCodeAt(index), FNV_PRIME);
    }
    return `${readable}_${(hash >>> 0).toString(36)}`;
  }

  static generatePreloadLinks(clientRefs: Record<string, string>): string[] {
    return Object.values(clientRefs).map(
      (path) => `<link rel="modulepreload" href="${escapeHtml(path)}" as="script" crossorigin>`,
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
