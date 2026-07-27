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
  isValidContentHash,
  RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS,
  RELEASE_ASSET_MAX_SIZE_BYTES,
} from "#veryfront/release-assets/constants.ts";
import { computeHashBytes } from "#veryfront/utils/hash-utils.ts";
import { cancelProxyResponseBody, readProxyResponseBytes } from "./response-body.ts";

const ASSET_PATH_PREFIX = "/_vf/assets/";
const ASSET_PATH_RE = /^\/_vf\/assets\/([0-9a-f]{64})\.(js|css)$/;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_UPSTREAM_TIMEOUT_MS = 30_000;

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

function assetResponse(
  asset: CachedAsset,
  method: string,
): Response {
  return new Response(method === "HEAD" ? null : asset.bytes, {
    status: 200,
    headers: {
      ...IMMUTABLE_HEADERS,
      "Content-Length": String(asset.bytes.byteLength),
      "Content-Type": asset.contentType,
    },
  });
}

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

function badGateway(): Response {
  return new Response("Bad gateway", {
    status: 502,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

function methodNotAllowed(): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: {
      "Allow": "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

export interface ReleaseAssetHandlerOptions {
  apiBaseUrl: string;
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Bound for the upstream API request. */
  timeoutMs?: number;
}

function resolveTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_UPSTREAM_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_UPSTREAM_TIMEOUT_MS) {
    throw new RangeError(
      `Release asset timeout must be an integer between 1 and ${MAX_UPSTREAM_TIMEOUT_MS}ms`,
    );
  }
  return value;
}

function buildUpstreamUrl(apiBaseUrl: string, hash: string): string {
  const base = new URL(apiBaseUrl);
  if (
    (base.protocol !== "http:" && base.protocol !== "https:") ||
    base.username ||
    base.password
  ) {
    throw new TypeError("Release asset API base URL must be an HTTP(S) URL without credentials");
  }
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL(`release-assets/${hash}`, base).toString();
}

/**
 * Serve a release asset for the given request URL.
 *
 * @returns a Response on the asset path, or null if the path is not an asset
 * path (caller should continue normal forwarding). For invalid hashes/exts a
 * 400 is returned; for upstream 404s a no-cache 404 is returned.
 */
export async function handleReleaseAssetRequest(
  req: Request,
  url: URL,
  options: ReleaseAssetHandlerOptions,
): Promise<Response | null> {
  if (!isReleaseAssetPath(url.pathname)) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed();

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
  if (cached) return assetResponse(cached, req.method);

  const doFetch = options.fetchImpl ?? fetch;
  let upstreamUrl: string;
  let timeoutMs: number;
  try {
    upstreamUrl = buildUpstreamUrl(options.apiBaseUrl, hash);
    timeoutMs = resolveTimeoutMs(options.timeoutMs);
  } catch {
    return badGateway();
  }

  const controller = new AbortController();
  const abortFromRequest = (): void => controller.abort(req.signal.reason);
  if (req.signal.aborted) abortFromRequest();
  else req.signal.addEventListener("abort", abortFromRequest, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(upstreamUrl, { signal: controller.signal });

    if (response.status === 404) {
      await cancelProxyResponseBody(response);
      return notFound();
    }
    if (!response.ok) {
      await cancelProxyResponseBody(response);
      return badGateway();
    }

    // Serve the expected content type for the extension (allowlisted).
    const contentType = contentTypeForExtension(ext)!;
    const upstreamContentType = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (upstreamContentType !== contentType) {
      await cancelProxyResponseBody(response);
      return badGateway();
    }

    const bytes = await readProxyResponseBytes(
      response,
      RELEASE_ASSET_MAX_SIZE_BYTES,
      controller.signal,
    );
    if (await computeHashBytes(bytes) !== hash) return badGateway();

    assetCache.set(cacheKey, { bytes, contentType });
    return assetResponse({ bytes, contentType }, req.method);
  } catch {
    return badGateway();
  } finally {
    clearTimeout(timeoutId);
    req.signal.removeEventListener("abort", abortFromRequest);
  }
}

/** Clear the in-memory asset cache (tests / memory pressure). */
export function clearReleaseAssetProxyCache(): void {
  assetCache.clear();
}
