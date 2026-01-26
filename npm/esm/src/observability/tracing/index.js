import { tracingManager } from "./manager.js";
export { loadConfig } from "./config.js";
export { SpanOperations } from "./span-operations.js";
export { ContextPropagation } from "./context-propagation.js";
export { SpanNames } from "./span-names.js";
export async function initTracing(config = {}, adapter) {
    await tracingManager.initialize(config, adapter);
}
export function isTracingEnabled() {
    return tracingManager.isEnabled();
}
export function isTracingDegraded() {
    return tracingManager.isDegraded();
}
export function shutdownTracing() {
    tracingManager.shutdown();
}
export function getTracingState() {
    return tracingManager.getState();
}
function getSpanOps() {
    return tracingManager.getSpanOperations();
}
function getContextProp() {
    return tracingManager.getContextPropagation();
}
export function startSpan(name, options = {}) {
    return getSpanOps()?.startSpan(name, options) ?? null;
}
export function endSpan(span, error) {
    getSpanOps()?.endSpan(span, error);
}
export function setSpanAttributes(span, attributes) {
    getSpanOps()?.setAttributes(span, attributes);
}
export function addSpanEvent(span, name, attributes) {
    getSpanOps()?.addEvent(span, name, attributes);
}
export function createChildSpan(parentSpan, name, options = {}) {
    return getSpanOps()?.createChildSpan(parentSpan, name, options) ?? null;
}
export function extractContext(headers) {
    return getContextProp()?.extractContext(headers);
}
export function injectContext(context, headers) {
    getContextProp()?.injectContext(context, headers);
}
export function getActiveContext() {
    return getContextProp()?.getActiveContext();
}
export async function withActiveSpan(span, fn) {
    const contextProp = getContextProp();
    if (!contextProp)
        return await fn();
    return await contextProp.withActiveSpan(span, fn);
}
export async function withSpan(name, fn, options = {}) {
    const contextProp = getContextProp();
    const spanOps = getSpanOps();
    if (!contextProp || !spanOps)
        return await fn(null);
    return await contextProp.withSpanAsync(name, fn, (n) => spanOps.startSpan(n, options), (s, e) => spanOps.endSpan(s, e));
}
export function withSpanSync(name, fn, options = {}) {
    const contextProp = getContextProp();
    const spanOps = getSpanOps();
    if (!contextProp || !spanOps)
        return fn(null);
    return contextProp.withSpan(name, fn, (n) => spanOps.startSpan(n, options), (s, e) => spanOps.endSpan(s, e));
}
export { tracingManager } from "./manager.js";
export { TracingManager } from "./manager.js";
