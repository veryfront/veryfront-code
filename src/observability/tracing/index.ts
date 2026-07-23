/**
 * Observability Tracing
 *
 * @module observability/tracing
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
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
  adapter?: RuntimeAdapter,
): Promise<void> {
  await tracingManager.initialize(config, adapter);
}

/** Check whether tracing is enabled. */
export function isTracingEnabled(): boolean {
  return tracingManager.isEnabled();
}

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

/** Starts span. */
export function startSpan(name: string, options: SpanOptions = {}): Span | null {
  return getSpanOps()?.startSpan(name, options) ?? null;
}

/** End an active tracing span. */
export function endSpan(span: Span | null, ...failure: [] | [error: unknown]): void {
  getSpanOps()?.endSpan(span, ...failure);
}

/** Sets span attributes. */
export function setSpanAttributes(
  span: Span | null,
  attributes: Record<string, string | number | boolean>,
): void {
  getSpanOps()?.setAttributes(span, attributes);
}

/** Event emitted for add span. */
export function addSpanEvent(
  span: Span | null,
  name: string,
  attributes?: Record<string, string | number | boolean>,
): void {
  getSpanOps()?.addEvent(span, name, attributes);
}

/** Create child span. */
export function createChildSpan(
  parentSpan: Span | null,
  name: string,
  options: SpanOptions = {},
): Span | null {
  return getSpanOps()?.createChildSpan(parentSpan, name, options) ?? null;
}

/** Context for extract. */
export function extractContext(headers: Headers): Context | undefined {
  return getContextProp()?.extractContext(headers);
}

/** Context for inject. */
export function injectContext(context: Context, headers: Headers): void {
  getContextProp()?.injectContext(context, headers);
}

/** Context for get active. */
export function getActiveContext(): Context | undefined {
  return getContextProp()?.getActiveContext();
}

/** Applies active span. */
export async function withActiveSpan<T>(span: Span | null, fn: () => Promise<T>): Promise<T> {
  const contextProp = getContextProp();
  if (!contextProp) return fn();
  return contextProp.withActiveSpan(span, fn);
}

/** Applies span. */
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
    (s: Span | null, ...failure: [] | [error: unknown]) => spanOps.endSpan(s, ...failure),
  );
}

/** Applies span sync. */
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
    (s: Span | null, ...failure: [] | [error: unknown]) => spanOps.endSpan(s, ...failure),
  );
}

export { tracingManager } from "./manager.ts";
export { TracingManager } from "./manager.ts";
