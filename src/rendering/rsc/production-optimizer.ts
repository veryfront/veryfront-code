import type { RSCPayload } from "./types.ts";
import { escapeHtml } from "#veryfront/html/html-escape.ts";
import { HASH_SEED_FNV1A } from "#veryfront/utils";

const FNV1A_PRIME = 16_777_619;
const MAX_SAFE_CACHE_AGE_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 4);

function updateHash(hash: number, value: string): number {
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV1A_PRIME);
  }
  return hash;
}

function updateLengthDelimitedHash(hash: number, label: string, value: string): number {
  hash = updateHash(hash, label);
  hash = updateHash(hash, ":");
  hash = updateHash(hash, String(value.length));
  hash = updateHash(hash, ":");
  return updateHash(hash, value);
}

function hashText(value: string): string {
  return (updateHash(HASH_SEED_FNV1A, value) >>> 0).toString(36);
}

export class RSCProductionOptimizer {
  static optimizePayload(payload: RSCPayload): RSCPayload {
    return {
      html: RSCProductionOptimizer.minifyHTML(payload.html),
      clientRefs: { ...payload.clientRefs },
      assets: payload.assets
        ? {
          css: payload.assets.css ? [...payload.assets.css] : undefined,
          js: payload.assets.js ? [...payload.assets.js] : undefined,
        }
        : undefined,
      tree: undefined,
    };
  }

  private static minifyHTML(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, "").trim();
  }

  static getCacheHeaders(
    options: { isStatic?: boolean; maxAge?: number } = {},
  ): Record<string, string> {
    const { isStatic = false, maxAge = 0 } = options;

    if (
      !isStatic ||
      !Number.isSafeInteger(maxAge) ||
      maxAge <= 0 ||
      maxAge > MAX_SAFE_CACHE_AGE_SECONDS
    ) {
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

    hash = updateLengthDelimitedHash(hash, "html", payload.html);

    for (const key of Object.keys(payload.clientRefs).sort()) {
      hash = updateLengthDelimitedHash(hash, "client-ref-key", key);
      hash = updateLengthDelimitedHash(hash, "client-ref-value", payload.clientRefs[key] ?? "");
    }

    for (const asset of payload.assets?.css ?? []) {
      hash = updateLengthDelimitedHash(hash, "css-asset", asset);
    }

    for (const asset of payload.assets?.js ?? []) {
      hash = updateLengthDelimitedHash(hash, "js-asset", asset);
    }

    return `"${(hash >>> 0).toString(36)}"`;
  }

  static checkETag(requestETag: string | null, payloadETag: string): boolean {
    if (!requestETag) return false;

    const normalizeETag = (etag: string): string => {
      let normalized = etag.trim();
      if (normalized.startsWith("W/")) normalized = normalized.slice(2).trimStart();
      if (normalized.startsWith('"') && normalized.endsWith('"')) {
        normalized = normalized.slice(1, -1);
      }
      return normalized;
    };
    const normalizedPayloadETag = normalizeETag(payloadETag);

    return requestETag.split(",").some((candidate) => {
      const trimmed = candidate.trim();
      return trimmed === "*" || normalizeETag(trimmed) === normalizedPayloadETag;
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
    const bundles: Record<string, RSCPayload> = {};
    const manifest: Record<string, string[]> = {};
    const baseCounts = new Map<string, number>();

    for (const route of payloads.keys()) {
      const base = RSCProductionOptimizer.generateBundleId(route);
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    }

    for (const [route, payload] of payloads) {
      const base = RSCProductionOptimizer.generateBundleId(route);
      let bundleId = (baseCounts.get(base) ?? 0) > 1 ? `${base}_${hashText(route)}` : base;
      let collisionIndex = 1;
      while (Object.hasOwn(bundles, bundleId)) {
        bundleId = `${base}_${hashText(route)}_${collisionIndex++}`;
      }
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
