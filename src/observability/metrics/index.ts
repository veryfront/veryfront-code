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

export async function initMetrics(
  config: Parameters<typeof metricsManager.initialize>[0] = {},
  adapter?: RuntimeAdapter,
): Promise<void> {
  await metricsManager.initialize(config, adapter);
}

export function isMetricsEnabled(): boolean {
  return metricsManager.isEnabled();
}

export async function shutdownMetrics(): Promise<void> {
  await metricsManager.shutdown();
}

export function getMetricsState(): ReturnType<typeof metricsManager.getState> {
  return metricsManager.getState();
}

export function recordHttpRequest(attributes?: Record<string, string>): void {
  getRecorder()?.recordHttpRequest(attributes);
}

export function recordHttpRequestComplete(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordHttpRequestComplete(durationMs, attributes);
}

export function recordCacheGet(
  hit: boolean,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordCacheGet(hit, attributes);
}

export function recordCacheSet(attributes?: Record<string, string>): void {
  getRecorder()?.recordCacheSet(attributes);
}

export function recordCacheInvalidate(
  count: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordCacheInvalidate(count, attributes);
}

export function setCacheSize(size: number): void {
  getRecorder()?.setCacheSize(size);
}

export function recordRender(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRender(durationMs, attributes);
}

export function recordRenderError(attributes?: Record<string, string>): void {
  getRecorder()?.recordRenderError(attributes);
}

export function recordRSCRender(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRSCRender(durationMs, attributes);
}

export function recordRSCStream(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRSCStream(durationMs, attributes);
}

export function recordRSCRequest(
  type: "manifest" | "page" | "stream" | "action",
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRSCRequest(type, attributes);
}

export function recordRSCError(attributes?: Record<string, string>): void {
  getRecorder()?.recordRSCError(attributes);
}

export function recordBuild(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordBuild(durationMs, attributes);
}

export function recordBundle(
  sizeKb: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordBundle(sizeKb, attributes);
}

export function recordDataFetch(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordDataFetch(durationMs, attributes);
}

export function recordDataFetchError(attributes?: Record<string, string>): void {
  getRecorder()?.recordDataFetchError(attributes);
}

export function recordCorsRejection(attributes?: Record<string, string>): void {
  getRecorder()?.recordCorsRejection?.(attributes);
}

export function recordSecurityHeaders(attributes?: Record<string, string>): void {
  getRecorder()?.recordSecurityHeaders?.(attributes);
}

export function recordErrorCount(attributes?: Record<string, string>): void {
  getRecorder()?.recordError(attributes);
}
