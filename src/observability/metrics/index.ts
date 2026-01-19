/**
 * OpenTelemetry Metrics - Public API
 *
 * Comprehensive OpenTelemetry integration for Veryfront:
 * - Custom metrics: request count, latency, cache hits
 * - Histogram buckets for latency distribution
 * - Gauges for active connections, memory usage
 * - Export to Prometheus, CloudWatch, OTLP, etc.
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { metricsManager } from "./manager.ts";

// Re-export types
export type { MemoryUsage, MetricsConfig } from "./types.ts";

// Re-export utilities (for advanced usage)
export { getMemoryUsage, loadConfig } from "./config.ts";
// Removed: deleted module - export { initializeInstruments } from "./instruments.ts";
export { MetricsRecorder } from "./recorder.ts";

/**
 * Initialize OpenTelemetry metrics
 */
export async function initMetrics(
  config: Parameters<typeof metricsManager.initialize>[0] = {},
  adapter?: RuntimeAdapter,
): Promise<void> {
  await metricsManager.initialize(config, adapter);
}

/**
 * Check if metrics collection is enabled
 */
export function isMetricsEnabled(): boolean {
  return metricsManager.isEnabled();
}

/**
 * Shutdown metrics (for graceful shutdown)
 */
export async function shutdownMetrics(): Promise<void> {
  await metricsManager.shutdown();
}

/**
 * Export runtime state for testing/debugging
 */
export function getMetricsState() {
  return metricsManager.getState();
}

// Convenience API - delegates to recorder
const getRecorder = () => metricsManager.getRecorder();

// HTTP Metrics API
export function recordHttpRequest(attributes?: Record<string, string>): void {
  getRecorder()?.recordHttpRequest(attributes);
}

export function recordHttpRequestComplete(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordHttpRequestComplete(durationMs, attributes);
}

// Cache Metrics API
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

// Render Metrics API
export function recordRender(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordRender(durationMs, attributes);
}

export function recordRenderError(attributes?: Record<string, string>): void {
  getRecorder()?.recordRenderError(attributes);
}

// RSC Metrics API
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

// Build Metrics API
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

// Data Fetching Metrics API
export function recordDataFetch(
  durationMs: number,
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordDataFetch(durationMs, attributes);
}

export function recordDataFetchError(
  attributes?: Record<string, string>,
): void {
  getRecorder()?.recordDataFetchError(attributes);
}

// Security Metrics API
export function recordCorsRejection(attributes?: Record<string, string>): void {
  getRecorder()?.recordCorsRejection?.(attributes);
}

export function recordSecurityHeaders(attributes?: Record<string, string>): void {
  getRecorder()?.recordSecurityHeaders?.(attributes);
}

// Export singleton for production use
export { metricsManager } from "./manager.ts";

// Export class for testing - tests can create isolated instances
export { MetricsManager } from "./manager.ts";
