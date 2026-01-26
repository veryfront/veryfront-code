import * as dntShim from "../../../_dnt.shims.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import { tracingManager } from "./manager.js";
import type { Context, Span, SpanOptions, TracingConfig } from "./types.js";

export type { Context, Span, SpanOptions, TracingConfig } from "./types.js";
export { loadConfig } from "./config.js";
export { SpanOperations } from "./span-operations.js";
export { ContextPropagation } from "./context-propagation.js";
export { SpanNames } from "./span-names.js";

export async function initTracing(
  config: Partial<TracingConfig> = {},
  adapter?: RuntimeAdapter,
): Promise<void> {
  await tracingManager.initialize(config, adapter);
}

export function isTracingEnabled(): boolean {
  return tracingManager.isEnabled();
}

export function isTracingDegraded(): boolean {
  return tracingManager.isDegraded();
}

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

export function startSpan(name: string, options: SpanOptions = {}): Span | null {
  return getSpanOps()?.startSpan(name, options) ?? null;
}

export function endSpan(span: Span | null, error?: Error): void {
  getSpanOps()?.endSpan(span, error);
}

export function setSpanAttributes(
  span: Span | null,
  attributes: Record<string, string | number | boolean>,
): void {
  getSpanOps()?.setAttributes(span, attributes);
}

export function addSpanEvent(
  span: Span | null,
  name: string,
  attributes?: Record<string, string | number | boolean>,
): void {
  getSpanOps()?.addEvent(span, name, attributes);
}

export function createChildSpan(
  parentSpan: Span | null,
  name: string,
  options: SpanOptions = {},
): Span | null {
  return getSpanOps()?.createChildSpan(parentSpan, name, options) ?? null;
}

export function extractContext(headers: dntShim.Headers): Context | undefined {
  return getContextProp()?.extractContext(headers);
}

export function injectContext(context: Context, headers: dntShim.Headers): void {
  getContextProp()?.injectContext(context, headers);
}

export function getActiveContext(): Context | undefined {
  return getContextProp()?.getActiveContext();
}

export async function withActiveSpan<T>(span: Span | null, fn: () => Promise<T>): Promise<T> {
  const contextProp = getContextProp();
  if (!contextProp) return await fn();
  return await contextProp.withActiveSpan(span, fn);
}

export async function withSpan<T>(
  name: string,
  fn: (span: Span | null) => Promise<T>,
  options: SpanOptions = {},
): Promise<T> {
  const contextProp = getContextProp();
  const spanOps = getSpanOps();

  if (!contextProp || !spanOps) return await fn(null);

  return await contextProp.withSpanAsync(
    name,
    fn,
    (n) => spanOps.startSpan(n, options),
    (s, e) => spanOps.endSpan(s, e),
  );
}

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

export { tracingManager } from "./manager.js";
export { TracingManager } from "./manager.js";
