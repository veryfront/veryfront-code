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
  RELEASE_ASSET_MAX_SIZE_BYTES,
} from "#veryfront/release-assets/constants.ts";
import { computeHashBytes } from "#veryfront/utils/hash-utils.ts";
import { PermitSemaphore } from "#veryfront/utils/permit-semaphore.ts";
import { waitForSharedPromise } from "#veryfront/utils/singleflight.ts";
import { readProxyResponseBytes, settleProxyResponseBody } from "./response-body.ts";

const ASSET_PATH_PREFIX = "/_vf/assets/";
const ASSET_PATH_RE = /^\/_vf\/assets\/([0-9a-f]{64})\.(js|css)$/;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Count and byte bounds for completed immutable asset snapshots.
 *
 * The byte budget is the binding limit. The entry count only exists so a
 * pathological run of tiny assets cannot grow the map without end; sized so a
 * pod serving several projects keeps whole module graphs resident, because
 * evicting one holds the next page load hostage to a cold-load round trip.
 */
const MAX_CACHED_ASSETS = 2_000;
const MAX_CACHED_ASSET_BYTES = 32 * 1024 * 1024;

/**
 * Concurrent upstream fetches. This is the one real resource: each in-flight
 * load buffers a whole asset in memory, so peak bytes is this count times
 * RELEASE_ASSET_MAX_SIZE_BYTES.
 *
 * Excess demand queues rather than failing. A page's module graph is a fan-out
 * this proxy itself produced by serving the HTML, so shedding it would reject
 * the predictable consequence of our own response — and browser `import()`
 * never retries, which turns one shed asset into a dead page. Callers are
 * already bounded by their own deadline (`timeoutMs`) and the producer ceiling
 * (`MAX_UPSTREAM_TIMEOUT_MS`); a saturated proxy therefore shows up as latency
 * and finally an honest 504.
 *
 * A 503 is still reachable, but only from the semaphore's own
 * `DEFAULT_PERMIT_SEMAPHORE_MAX_QUEUE_SIZE` backstop. That threshold is two
 * orders of magnitude above one page's module graph, so reaching it means a
 * genuine flood rather than a project being shed for the size of the document
 * this proxy just served.
 */
const MAX_CONCURRENT_COLD_LOADS = 4;

interface CachedAsset {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

interface InflightAssetLoad {
  readonly controller: AbortController;
  consumers: number;
  readonly hash: string;
  readonly promise: Promise<CachedAsset>;
  settled: boolean;
  readonly timeoutId: ReturnType<typeof setTimeout>;
}

class ReleaseAssetNotFoundError extends Error {
  constructor() {
    super("Release asset was not found upstream");
    this.name = "ReleaseAssetNotFoundError";
  }
}

class ReleaseAssetTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Release asset cold load timed out after ${timeoutMs}ms`);
    this.name = "ReleaseAssetTimeoutError";
  }
}

class ReleaseAssetOverloadedError extends Error {
  constructor() {
    super("Release asset cold-load admission is saturated");
    this.name = "ReleaseAssetOverloadedError";
  }
}

class ReleaseAssetNoConsumersError extends Error {
  constructor() {
    super("Release asset cold load has no remaining consumers");
    this.name = "ReleaseAssetNoConsumersError";
  }
}

class ReleaseAssetUpstreamError extends Error {
  constructor() {
    super("Release asset upstream response failed validation");
    this.name = "ReleaseAssetUpstreamError";
  }
}

const assetCache = new LRUCache<string, CachedAsset>({
  maxEntries: MAX_CACHED_ASSETS,
  maxSizeBytes: MAX_CACHED_ASSET_BYTES,
  estimateSizeOf: (asset) => asset.bytes.byteLength + asset.contentType.length * 2 + 64,
});
const coldLoadAdmission = new PermitSemaphore(MAX_CONCURRENT_COLD_LOADS);
const inflightAssetLoads = new Map<string, InflightAssetLoad>();

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

function gatewayTimeout(): Response {
  return new Response("Gateway timeout", {
    status: 504,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

function serviceUnavailable(): Response {
  return new Response("Service unavailable", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "Retry-After": "1",
    },
  });
}

function clientClosedRequest(): Response {
  return new Response("Client closed request", {
    status: 499,
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
  /** Bound for this caller's cold-load wait. Shared work may serve longer-lived callers. */
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

async function loadReleaseAsset(
  hash: string,
  upstreamUrl: string,
  doFetch: typeof fetch,
  signal: AbortSignal,
): Promise<CachedAsset> {
  const admitted = await coldLoadAdmission.tryAcquire(Number.POSITIVE_INFINITY, { signal });
  if (!admitted) throw new ReleaseAssetOverloadedError();

  try {
    const response = await doFetch(upstreamUrl, { signal });
    if (signal.aborted) {
      await settleProxyResponseBody(response);
      throw signal.reason ?? new ReleaseAssetNoConsumersError();
    }

    if (response.status === 404) {
      await settleProxyResponseBody(response);
      throw new ReleaseAssetNotFoundError();
    }
    if (!response.ok) {
      await settleProxyResponseBody(response);
      throw new ReleaseAssetUpstreamError();
    }

    const upstreamContentType = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (!isAllowedReleaseAssetContentType(upstreamContentType)) {
      await settleProxyResponseBody(response);
      throw new ReleaseAssetUpstreamError();
    }

    const bytes = await readProxyResponseBytes(
      response,
      RELEASE_ASSET_MAX_SIZE_BYTES,
      signal,
    );
    const computedHash = await computeHashBytes(bytes);
    if (signal.aborted) throw signal.reason ?? new ReleaseAssetNoConsumersError();
    if (computedHash !== hash) {
      throw new ReleaseAssetUpstreamError();
    }

    const asset = { bytes, contentType: upstreamContentType };
    assetCache.set(hash, asset);
    return asset;
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason ?? error;
    }
    throw error;
  } finally {
    coldLoadAdmission.release();
  }
}

async function settleInflightAssetLoad(
  task: InflightAssetLoad,
  deferred: PromiseWithResolvers<CachedAsset>,
  upstreamUrl: string,
  doFetch: typeof fetch,
): Promise<void> {
  try {
    const asset = await loadReleaseAsset(
      task.hash,
      upstreamUrl,
      doFetch,
      task.controller.signal,
    );
    finishInflightAssetLoad(task);
    deferred.resolve(asset);
  } catch (error) {
    finishInflightAssetLoad(task);
    deferred.reject(error);
  }
}

function finishInflightAssetLoad(task: InflightAssetLoad): void {
  task.settled = true;
  clearTimeout(task.timeoutId);
  if (inflightAssetLoads.get(task.hash) === task) {
    inflightAssetLoads.delete(task.hash);
  }
}

function createInflightAssetLoad(
  hash: string,
  upstreamUrl: string,
  doFetch: typeof fetch,
): InflightAssetLoad {
  const controller = new AbortController();
  const deferred = Promise.withResolvers<CachedAsset>();
  // Last-resort producer ceiling; each attached caller has its own shorter deadline.
  const timeoutId = setTimeout(
    () => controller.abort(new ReleaseAssetTimeoutError(MAX_UPSTREAM_TIMEOUT_MS)),
    MAX_UPSTREAM_TIMEOUT_MS,
  );
  const task: InflightAssetLoad = {
    controller,
    consumers: 0,
    hash,
    promise: deferred.promise,
    settled: false,
    timeoutId,
  };
  inflightAssetLoads.set(hash, task);
  void settleInflightAssetLoad(task, deferred, upstreamUrl, doFetch);
  return task;
}

function getOrCreateInflightAssetLoad(
  hash: string,
  upstreamUrl: string,
  doFetch: typeof fetch,
): InflightAssetLoad {
  return inflightAssetLoads.get(hash) ??
    createInflightAssetLoad(hash, upstreamUrl, doFetch);
}

async function waitForInflightAssetLoad(
  task: InflightAssetLoad,
  requestSignal: AbortSignal,
  timeoutMs: number,
): Promise<CachedAsset> {
  const waiterController = new AbortController();
  const abortFromRequest = (): void => waiterController.abort(requestSignal.reason);
  if (requestSignal.aborted) abortFromRequest();
  else requestSignal.addEventListener("abort", abortFromRequest, { once: true });
  const timeoutId = setTimeout(
    () => waiterController.abort(new ReleaseAssetTimeoutError(timeoutMs)),
    timeoutMs,
  );

  task.consumers++;
  try {
    return await waitForSharedPromise(task.promise, waiterController.signal);
  } finally {
    clearTimeout(timeoutId);
    requestSignal.removeEventListener("abort", abortFromRequest);
    task.consumers--;
    if (task.consumers === 0 && !task.settled) {
      if (inflightAssetLoads.get(task.hash) === task) {
        inflightAssetLoads.delete(task.hash);
      }
      task.controller.abort(new ReleaseAssetNoConsumersError());
    }
  }
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

  const expectedContentType = contentTypeForExtension(ext)!;
  const cached = assetCache.get(hash);
  if (cached) {
    return cached.contentType === expectedContentType
      ? assetResponse(cached, req.method)
      : badGateway();
  }

  const doFetch = options.fetchImpl ?? fetch;
  let upstreamUrl: string;
  let timeoutMs: number;
  try {
    upstreamUrl = buildUpstreamUrl(options.apiBaseUrl, hash);
    timeoutMs = resolveTimeoutMs(options.timeoutMs);
  } catch {
    return badGateway();
  }

  if (req.signal.aborted) return clientClosedRequest();
  try {
    const task = getOrCreateInflightAssetLoad(
      hash,
      upstreamUrl,
      doFetch,
    );
    const asset = await waitForInflightAssetLoad(task, req.signal, timeoutMs);
    return asset.contentType === expectedContentType
      ? assetResponse(asset, req.method)
      : badGateway();
  } catch (error) {
    if (req.signal.aborted) return clientClosedRequest();
    if (error instanceof ReleaseAssetNotFoundError) return notFound();
    if (error instanceof ReleaseAssetTimeoutError) return gatewayTimeout();
    if (error instanceof ReleaseAssetOverloadedError) return serviceUnavailable();
    return badGateway();
  }
}

/** Clear the in-memory asset cache (tests / memory pressure). */
export function clearReleaseAssetProxyCache(): void {
  assetCache.clear();
}
