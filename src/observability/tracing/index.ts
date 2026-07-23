/**
 * Observability Tracing
 *
 * @module observability/tracing
 */

import type { ObservabilityRuntimeAdapter } from "../runtime-adapter.ts";
import { tracingManager } from "./manager.ts";
import type { Context, Span, SpanOptions, TracingConfig } from "./types.ts";

export type { Context, Span, SpanOptions, TracingConfig } from "./types.ts";
export { loadConfig } from "./config.ts";
export { SpanOperations } from "./span-operations.ts";
export { ContextPropagation } from "./context-propagation.ts";
export { SpanNames } from "./span-names.ts";

/** Initialize tracing for the current runtime. */
export async function initTracing(
  config: Partial<TracingConfig> = {},
  adapter?: ObservabilityRuntimeAdapter,
): Promise<void> {
  await tracingManager.initialize(config, adapter);
}

/** Check whether tracing is enabled. */
export function isTracingEnabled(): boolean {
  return tracingManager.isEnabled();
}

/** Check whether tracing initialized in degraded mode. */
export function isTracingDegraded(): boolean {
  return tracingManager.isDegraded();
}

/** Shut down the tracing runtime. */
export function shutdownTracing(): void {
  tracingManager.shutdown();
}

export function getTracingState(): ReturnType<typeof tracingManager.getState> {
  return tracingManager.getState();
}

function getSpanOps(): ReturnType<typeof tracingManager.getSpanOperations> {
  return tracingManager.getSpanOperations();
}

function getContextProp(): ReturnType<typeof tracingManager.getContextPropagation> {
  return tracingManager.getContextPropagation();
}

/** Start a bounded manual span. */
export function startSpan(name: string, options: SpanOptions = {}): Span | null {
  return getSpanOps()?.startSpan(name, options) ?? null;
}

/** End an active tracing span. */
export function endSpan(span: Span | null, error?: unknown): void {
  getSpanOps()?.endSpan(span, error);
}

/** Set bounded attributes on a span. */
export function setSpanAttributes(
  span: Span | null,
  attributes: Record<string, string | number | boolean>,
): void {
  getSpanOps()?.setAttributes(span, attributes);
}

/** Add a bounded event to a span. */
export function addSpanEvent(
  span: Span | null,
  name: string,
  attributes?: Record<string, string | number | boolean>,
): void {
  getSpanOps()?.addEvent(span, name, attributes);
}

/** Create a child span under an optional parent span. */
export function createChildSpan(
  parentSpan: Span | null,
  name: string,
  options: SpanOptions = {},
): Span | null {
  return getSpanOps()?.createChildSpan(parentSpan, name, options) ?? null;
}

/** Extract trace context from request headers. */
export function extractContext(headers: Headers): Context | undefined {
  return getContextProp()?.extractContext(headers);
}

/** Inject trace context into request headers. */
export function injectContext(context: Context, headers: Headers): void {
  getContextProp()?.injectContext(context, headers);
}

/** Return the active trace context. */
export function getActiveContext(): Context | undefined {
  return getContextProp()?.getActiveContext();
}

/** Run an asynchronous callback with a span active. */
export async function withActiveSpan<T>(span: Span | null, fn: () => Promise<T>): Promise<T> {
  const contextProp = getContextProp();
  if (!contextProp) return fn();
  return contextProp.withActiveSpan(span, fn);
}

/** Run an asynchronous callback in a new span. */
export async function withSpan<T>(
  name: string,
  fn: (span: Span | null) => Promise<T>,
  options: SpanOptions = {},
): Promise<T> {
  const contextProp = getContextProp();
  const spanOps = getSpanOps();

  if (!contextProp || !spanOps) return fn(null);

  return contextProp.withSpanAsync(
    name,
    fn,
    (n) => spanOps.startSpan(n, options),
    (s, e) => spanOps.endSpan(s, e),
  );
}

/** Run a synchronous callback in a new span. */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span | null) => T,
  options: SpanOptions = {},
): T {
  const contextProp = getContextProp();
  const spanOps = getSpanOps();

  if (!contextProp || !spanOps) return fn(null);

  return contextProp.withSpan(
    name,
    fn,
    (n) => spanOps.startSpan(n, options),
    (s, e) => spanOps.endSpan(s, e),
  );
}

export { tracingManager } from "./manager.ts";
export { TracingManager } from "./manager.ts";
