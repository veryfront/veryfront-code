/**
 * Proxy handler for content-addressed release assets.
 *
 * Owns the `/_vf/assets/{hash}.{js|css}` prefix on the project's own domain.
 * Validates the hash + extension, fetches bytes from the API's public
 * `/release-assets/{hash}` endpoint, caches hot bytes in a small in-memory LRU,
 * and serves them immutable + nosniff with an allowlisted content type.
 *
 * The renderer is never involved.
 *
 * @module proxy/asset-handler
 */

import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  contentTypeForExtension,
  isAllowedReleaseAssetContentType,
  isValidContentHash,
  RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS,
} from "#veryfront/release-assets/constants.ts";

const ASSET_PATH_PREFIX = "/_vf/assets/";
const ASSET_PATH_RE = /^\/_vf\/assets\/([0-9a-f]{64})\.(js|css)$/;

/** Bound on cached asset bodies (~100 hot entries). */
const MAX_CACHED_ASSETS = 100;

interface CachedAsset {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

const assetCache = new LRUCache<string, CachedAsset>({ maxEntries: MAX_CACHED_ASSETS });

/** True when the path is owned by the release asset prefix. */
export function isReleaseAssetPath(pathname: string): boolean {
  return pathname.startsWith(ASSET_PATH_PREFIX);
}

const IMMUTABLE_HEADERS: Record<string, string> = {
  "Cache-Control": `public, max-age=${RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS}, immutable`,
  "X-Content-Type-Options": "nosniff",
};

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

function badRequest(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

export interface ReleaseAssetHandlerOptions {
  apiBaseUrl: string;
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Serve a release asset for the given request URL.
 *
 * @returns a Response on the asset path, or null if the path is not an asset
 * path (caller should continue normal forwarding). For invalid hashes/exts a
 * 400 is returned; for upstream 404s a no-cache 404 is returned.
 */
export async function handleReleaseAssetRequest(
  url: URL,
  options: ReleaseAssetHandlerOptions,
): Promise<Response | null> {
  if (!isReleaseAssetPath(url.pathname)) return null;

  const match = url.pathname.match(ASSET_PATH_RE);
  if (!match) {
    // Path is under the asset prefix but malformed (bad hash/ext) → 400.
    return badRequest("Invalid asset path");
  }

  const hash = match[1]!;
  const ext = match[2] as "js" | "css";

  // Defense in depth: the regex already constrains these.
  if (!isValidContentHash(hash) || (ext !== "js" && ext !== "css")) {
    return badRequest("Invalid asset path");
  }

  const cacheKey = `${hash}.${ext}`;
  const cached = assetCache.get(cacheKey);
  if (cached) {
    return new Response(cached.bytes, {
      status: 200,
      headers: { ...IMMUTABLE_HEADERS, "Content-Type": cached.contentType },
    });
  }

  const doFetch = options.fetchImpl ?? fetch;
  const upstreamUrl = `${options.apiBaseUrl}/release-assets/${hash}`;

  let response: Response;
  try {
    response = await doFetch(upstreamUrl);
  } catch {
    return new Response("Bad gateway", {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  if (response.status === 404) return notFound();
  if (!response.ok) {
    return new Response("Bad gateway", {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  const upstreamContentType = response.headers.get("content-type");
  if (!isAllowedReleaseAssetContentType(upstreamContentType)) {
    return new Response("Bad gateway", {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  // Serve the expected content type for the extension (allowlisted).
  const contentType = contentTypeForExtension(ext)!;
  const bytes = new Uint8Array(await response.arrayBuffer());
  assetCache.set(cacheKey, { bytes, contentType });

  return new Response(bytes, {
    status: 200,
    headers: { ...IMMUTABLE_HEADERS, "Content-Type": contentType },
  });
}

/** Clear the in-memory asset cache (tests / memory pressure). */
export function clearReleaseAssetProxyCache(): void {
  assetCache.clear();
}
