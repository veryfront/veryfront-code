import { logger as baseLogger } from "#veryfront/utils";
import {
  recordContentCacheHit,
  recordContentNetworkFetch,
} from "#veryfront/observability/simple-metrics/index.ts";

const logger = baseLogger.component("content-metrics");

type FileType = "page" | "layout" | "component" | "api" | "data" | "config" | "other";
export type MissReason = "cold_start" | "not_in_filelist" | "invalidation" | "no_filelist_cache";

interface PerRequestMetrics {
  startTime: number;
  requestScopedHits: number;
  persistentCacheHits: number;
  fileListHits: number;
  networkFetches: number;
  networkMs: number;
  fetchesByType: Record<FileType, number>;
  missReasons: Record<MissReason, number>;
  isPreviewMode: boolean | null;
  filesAccessed: Set<string>;
}

interface CumulativeMetrics {
  requestScopedHits: number;
  persistentCacheHits: number;
  fileListHits: number;
  networkFetches: number;
  totalNetworkMs: number;
  requestsTracked: number;
}

const cumulativeMetrics: CumulativeMetrics = {
  requestScopedHits: 0,
  persistentCacheHits: 0,
  fileListHits: 0,
  networkFetches: 0,
  totalNetworkMs: 0,
  requestsTracked: 0,
};

let currentRequest: PerRequestMetrics | null = null;

function createFreshRequestMetrics(): PerRequestMetrics {
  return {
    startTime: performance.now(),
    requestScopedHits: 0,
    persistentCacheHits: 0,
    fileListHits: 0,
    networkFetches: 0,
    networkMs: 0,
    fetchesByType: { page: 0, layout: 0, component: 0, api: 0, data: 0, config: 0, other: 0 },
    missReasons: { cold_start: 0, not_in_filelist: 0, invalidation: 0, no_filelist_cache: 0 },
    isPreviewMode: null,
    filesAccessed: new Set(),
  };
}

function detectFileType(path: string): FileType {
  if (path.startsWith("pages/api/") || path.startsWith("app/api/")) return "api";
  if (path.includes("/layout.") || path.includes("/layout/")) return "layout";
  if (path.startsWith("pages/") || path.startsWith("app/")) return "page";
  if (path.startsWith("components/") || path.includes("/components/")) return "component";
  if (path.endsWith(".json") || path.endsWith(".yaml") || path.endsWith(".yml")) return "data";
  if (path.includes("config") || path.includes(".config.")) return "config";
  return "other";
}

export function startRequestMetrics(): void {
  currentRequest = createFreshRequestMetrics();
}

export function endRequestMetrics(
  requestContext?: { requestId?: string; pathname?: string; mode?: string },
): void {
  if (!currentRequest) return;

  const req = currentRequest;
  const durationMs = Math.round(performance.now() - req.startTime);

  const totalCacheHits = req.requestScopedHits + req.persistentCacheHits + req.fileListHits;
  const totalOperations = totalCacheHits + req.networkFetches;
  const cacheHitRate = totalOperations > 0
    ? Math.round((totalCacheHits / totalOperations) * 100)
    : 100;
  const networkTimeRatio = durationMs > 0 ? Math.round((req.networkMs / durationMs) * 100) : 0;

  cumulativeMetrics.requestScopedHits += req.requestScopedHits;
  cumulativeMetrics.persistentCacheHits += req.persistentCacheHits;
  cumulativeMetrics.fileListHits += req.fileListHits;
  cumulativeMetrics.networkFetches += req.networkFetches;
  cumulativeMetrics.totalNetworkMs += req.networkMs;
  cumulativeMetrics.requestsTracked++;

  recordContentNetworkFetch(req.networkMs, req.isPreviewMode ?? false);

  logger.info("REQUEST_SUMMARY", {
    ...requestContext,
    durationMs,
    networkMs: req.networkMs,
    networkTimeRatio: `${networkTimeRatio}%`,
    cacheHitRate: `${cacheHitRate}%`,
    cacheHits: {
      l1_request: req.requestScopedHits,
      l2_persistent: req.persistentCacheHits,
      l3_filelist: req.fileListHits,
    },
    networkFetches: req.networkFetches,
    fetchesByType: req.fetchesByType,
    missReasons: req.missReasons,
    uniqueFiles: req.filesAccessed.size,
    isPreviewMode: req.isPreviewMode,
  });

  currentRequest = null;
}

export type ContentMetricEvent =
  | "REQUEST_SCOPED_HIT"
  | "PERSISTENT_CACHE_HIT"
  | "FILE_LIST_HIT"
  | "NETWORK_FETCH"
  | "NETWORK_FETCH_COMPLETE"
  | "CACHE_MISS";

export function logContentMetric(
  event: ContentMetricEvent,
  details: {
    path?: string;
    mode?: string;
    isPreviewMode?: boolean;
    durationMs?: number;
    missReason?: MissReason;
    [key: string]: unknown;
  },
): void {
  const path = details.path ?? "";

  if (currentRequest) {
    currentRequest.filesAccessed.add(path);
    if (details.isPreviewMode !== undefined) {
      currentRequest.isPreviewMode = details.isPreviewMode;
    }

    switch (event) {
      case "REQUEST_SCOPED_HIT":
        currentRequest.requestScopedHits++;
        recordContentCacheHit("request");
        break;
      case "PERSISTENT_CACHE_HIT":
        currentRequest.persistentCacheHits++;
        recordContentCacheHit("persistent");
        break;
      case "FILE_LIST_HIT":
        currentRequest.fileListHits++;
        recordContentCacheHit("filelist");
        break;
      case "NETWORK_FETCH":
        currentRequest.networkFetches++;
        currentRequest.fetchesByType[detectFileType(path)]++;
        break;
      case "NETWORK_FETCH_COMPLETE":
        if (details.durationMs) {
          currentRequest.networkMs += details.durationMs;
        }
        break;
      case "CACHE_MISS":
        if (details.missReason) {
          currentRequest.missReasons[details.missReason]++;
        }
        break;
    }
  }

  logger.debug(`${event}`, details);
}

export function getContentMetricsSnapshot(): CumulativeMetrics & {
  avgNetworkMsPerRequest: number;
} {
  return {
    ...cumulativeMetrics,
    avgNetworkMsPerRequest: cumulativeMetrics.requestsTracked > 0
      ? Math.round(cumulativeMetrics.totalNetworkMs / cumulativeMetrics.requestsTracked)
      : 0,
  };
}

export function resetContentMetrics(): void {
  cumulativeMetrics.requestScopedHits = 0;
  cumulativeMetrics.persistentCacheHits = 0;
  cumulativeMetrics.fileListHits = 0;
  cumulativeMetrics.networkFetches = 0;
  cumulativeMetrics.totalNetworkMs = 0;
  cumulativeMetrics.requestsTracked = 0;
}
