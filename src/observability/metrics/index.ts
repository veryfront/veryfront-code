/**
 * Observability Metrics
 *
 * @module observability/metrics
 */

import type { ObservabilityRuntimeAdapter } from "../runtime-adapter.ts";
import { metricsManager } from "./manager.ts";
import type { MetricsConfig, MetricsRuntimeState } from "./types.ts";

export type { MemoryUsage, MetricsConfig, MetricsRuntimeState } from "./types.ts";
export { getMemoryUsage, loadConfig } from "./config.ts";
export { MetricsRecorder } from "./recorder.ts";
export { MetricsManager, metricsManager } from "./manager.ts";

function getRecorder(): ReturnType<typeof metricsManager.getRecorder> {
  return metricsManager.getRecorder();
}

/** Initialize metrics collection. */
export async function initMetrics(
  config: Partial<MetricsConfig> = {},
  adapter?: ObservabilityRuntimeAdapter,
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

/** Return a metrics runtime state snapshot. */
export function getMetricsState(): MetricsRuntimeState {
  return metricsManager.getState();
}

/** Record the start of an HTTP request. */
export function recordHttpRequest(attributes?: Record<string, string>): void {
  getRecorder()?.recordHttpRequest(attributes);
}

/** Record completion of an HTTP request. */
export function recordHttpRequestComplete(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordHttpRequestComplete(durationMs, attributes);
}

/** Record a cache lookup. */
export function recordCacheGet(
  hit: boolean,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordCacheGet(hit, attributes);
}

/** Record a cache write. */
export function recordCacheSet(attributes?: Record<string, string>): void {
  getRecorder()?.recordCacheSet(attributes);
}

/** Record cache invalidation. */
export function recordCacheInvalidate(
  count: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordCacheInvalidate(count, attributes);
}

/** Set the current cache size. */
export function setCacheSize(size: number): void {
  getRecorder()?.setCacheSize(size);
}

/** Record a completed render. */
export function recordRender(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRender(durationMs, attributes);
}

/** Record a render failure. */
export function recordRenderError(attributes?: Record<string, string>): void {
  getRecorder()?.recordRenderError(attributes);
}

/** Record an RSC render duration. */
export function recordRSCRender(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRSCRender(durationMs, attributes);
}

/** Record an RSC stream duration. */
export function recordRSCStream(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRSCStream(durationMs, attributes);
}

/** Record an RSC request by kind. */
export function recordRSCRequest(
  type: "manifest" | "page" | "stream" | "action",
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRSCRequest(type, attributes);
}

/** Record an RSC failure. */
export function recordRSCError(attributes?: Record<string, string>): void {
  getRecorder()?.recordRSCError(attributes);
}

/** Record a build duration. */
export function recordBuild(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordBuild(durationMs, attributes);
}

/** Record a bundle size. */
export function recordBundle(
  sizeKb: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordBundle(sizeKb, attributes);
}

/** Record a data fetch duration. */
export function recordDataFetch(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordDataFetch(durationMs, attributes);
}

/** Record a data fetch failure. */
export function recordDataFetchError(attributes?: Record<string, string>): void {
  getRecorder()?.recordDataFetchError(attributes);
}

/** Record a CORS rejection. */
export function recordCorsRejection(attributes?: Record<string, string>): void {
  getRecorder()?.recordCorsRejection?.(attributes);
}

/** Record security-header application. */
export function recordSecurityHeaders(attributes?: Record<string, string>): void {
  getRecorder()?.recordSecurityHeaders?.(attributes);
}

/** Record a categorized error. */
export function recordErrorCount(attributes?: Record<string, string>): void {
  getRecorder()?.recordError(attributes);
}
