import { metricsManager } from "./manager.js";
export { getMemoryUsage, loadConfig } from "./config.js";
export { MetricsRecorder } from "./recorder.js";
export async function initMetrics(config = {}, adapter) {
    await metricsManager.initialize(config, adapter);
}
export function isMetricsEnabled() {
    return metricsManager.isEnabled();
}
export async function shutdownMetrics() {
    await metricsManager.shutdown();
}
export function getMetricsState() {
    return metricsManager.getState();
}
function getRecorder() {
    return metricsManager.getRecorder();
}
export function recordHttpRequest(attributes) {
    getRecorder()?.recordHttpRequest(attributes);
}
export function recordHttpRequestComplete(durationMs, attributes) {
    getRecorder()?.recordHttpRequestComplete(durationMs, attributes);
}
export function recordCacheGet(hit, attributes) {
    getRecorder()?.recordCacheGet(hit, attributes);
}
export function recordCacheSet(attributes) {
    getRecorder()?.recordCacheSet(attributes);
}
export function recordCacheInvalidate(count, attributes) {
    getRecorder()?.recordCacheInvalidate(count, attributes);
}
export function setCacheSize(size) {
    getRecorder()?.setCacheSize(size);
}
export function recordRender(durationMs, attributes) {
    getRecorder()?.recordRender(durationMs, attributes);
}
export function recordRenderError(attributes) {
    getRecorder()?.recordRenderError(attributes);
}
export function recordRSCRender(durationMs, attributes) {
    getRecorder()?.recordRSCRender(durationMs, attributes);
}
export function recordRSCStream(durationMs, attributes) {
    getRecorder()?.recordRSCStream(durationMs, attributes);
}
export function recordRSCRequest(type, attributes) {
    getRecorder()?.recordRSCRequest(type, attributes);
}
export function recordRSCError(attributes) {
    getRecorder()?.recordRSCError(attributes);
}
export function recordBuild(durationMs, attributes) {
    getRecorder()?.recordBuild(durationMs, attributes);
}
export function recordBundle(sizeKb, attributes) {
    getRecorder()?.recordBundle(sizeKb, attributes);
}
export function recordDataFetch(durationMs, attributes) {
    getRecorder()?.recordDataFetch(durationMs, attributes);
}
export function recordDataFetchError(attributes) {
    getRecorder()?.recordDataFetchError(attributes);
}
export function recordCorsRejection(attributes) {
    getRecorder()?.recordCorsRejection?.(attributes);
}
export function recordSecurityHeaders(attributes) {
    getRecorder()?.recordSecurityHeaders?.(attributes);
}
export { metricsManager } from "./manager.js";
export { MetricsManager } from "./manager.js";
