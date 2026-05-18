/**
 * Observability Metrics
 *
 * @module observability/metrics
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { metricsManager } from "./manager.ts";

export type { MemoryUsage, MetricsConfig } from "./types.ts";
export { getMemoryUsage, loadConfig } from "./config.ts";
export { MetricsRecorder } from "./recorder.ts";
export { MetricsManager, metricsManager } from "./manager.ts";

function getRecorder(): ReturnType<typeof metricsManager.getRecorder> {
  return metricsManager.getRecorder();
}

/** Initialize metrics collection. */
export async function initMetrics(
  config: Parameters<typeof metricsManager.initialize>[0] = {},
  adapter?: RuntimeAdapter,
): Promise<void> {
  await metricsManager.initialize(config, adapter);
}

/** Check whether metrics collection is enabled. */
export function isMetricsEnabled(): boolean {
  return metricsManager.isEnabled();
}

/** Shut down metrics collection. */
export async function shutdownMetrics(): Promise<void> {
  await metricsManager.shutdown();
}

/** State for get metrics. */
export function getMetricsState(): ReturnType<typeof metricsManager.getState> {
  return metricsManager.getState();
}

/** Request payload for record HTTP. */
export function recordHttpRequest(attributes?: Record<string, string>): void {
  getRecorder()?.recordHttpRequest(attributes);
}

/** Record HTTP request complete. */
export function recordHttpRequestComplete(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordHttpRequestComplete(durationMs, attributes);
}

/** Record cache get. */
export function recordCacheGet(
  hit: boolean,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordCacheGet(hit, attributes);
}

/** Record cache set. */
export function recordCacheSet(attributes?: Record<string, string>): void {
  getRecorder()?.recordCacheSet(attributes);
}

/** Record cache invalidate. */
export function recordCacheInvalidate(
  count: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordCacheInvalidate(count, attributes);
}

/** Sets cache size. */
export function setCacheSize(size: number): void {
  getRecorder()?.setCacheSize(size);
}

/** Record render. */
export function recordRender(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRender(durationMs, attributes);
}

/** Error shape for record render. */
export function recordRenderError(attributes?: Record<string, string>): void {
  getRecorder()?.recordRenderError(attributes);
}

/** Record RSC render. */
export function recordRSCRender(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRSCRender(durationMs, attributes);
}

/** Record RSC stream. */
export function recordRSCStream(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRSCStream(durationMs, attributes);
}

/** Request payload for record rscrequest. */
export function recordRSCRequest(
  type: "manifest" | "page" | "stream" | "action",
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRSCRequest(type, attributes);
}

/** Error shape for record rscerror. */
export function recordRSCError(attributes?: Record<string, string>): void {
  getRecorder()?.recordRSCError(attributes);
}

/** Record build. */
export function recordBuild(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordBuild(durationMs, attributes);
}

/** Record bundle. */
export function recordBundle(
  sizeKb: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordBundle(sizeKb, attributes);
}

/** Record data fetch. */
export function recordDataFetch(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordDataFetch(durationMs, attributes);
}

/** Error shape for record data fetch. */
export function recordDataFetchError(attributes?: Record<string, string>): void {
  getRecorder()?.recordDataFetchError(attributes);
}

/** Record CORS rejection. */
export function recordCorsRejection(attributes?: Record<string, string>): void {
  getRecorder()?.recordCorsRejection?.(attributes);
}

/** Record security headers. */
export function recordSecurityHeaders(attributes?: Record<string, string>): void {
  getRecorder()?.recordSecurityHeaders?.(attributes);
}

export function recordErrorCount(attributes?: Record<string, string>): void {
  getRecorder()?.recordError(attributes);
}
