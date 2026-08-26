/**
 * Observability Tracing
 *
 * @module observability/tracing
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  createPublicContext,
  createPublicSpan,
  unwrapPublicContext,
  unwrapPublicSpan,
} from "./api-shim.ts";
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

function exposeSpan(span: Span | null): Span | null {
  return span ? createPublicSpan(span) : null;
}

function restoreSpan(span: Span | null): Span | null {
  return span ? unwrapPublicSpan(span) : null;
}

function exposeContext(ctx: Context | undefined): Context | undefined {
  return ctx ? createPublicContext(ctx) : undefined;
}

function restoreContext(ctx: Context): Context {
  return unwrapPublicContext(ctx);
}

function restoreSpanOptions(options: SpanOptions): SpanOptions {
  if (!options.parent) return options;
  const spanParent = unwrapPublicSpan(options.parent as Span);
  const parent = spanParent === options.parent ? unwrapPublicContext(options.parent) : spanParent;
  return parent === options.parent ? options : { ...options, parent };
}

/** Starts span. */
export function startSpan(name: string, options: SpanOptions = {}): Span | null {
  return exposeSpan(getSpanOps()?.startSpan(name, restoreSpanOptions(options)) ?? null);
}

/** End an active tracing span. */
export function endSpan(span: Span | null, ...failure: [] | [error: unknown]): void {
  getSpanOps()?.endSpan(restoreSpan(span), ...failure);
}

/** Sets span attributes. */
export function setSpanAttributes(
  span: Span | null,
  attributes: Record<string, string | number | boolean>,
): void {
  getSpanOps()?.setAttributes(restoreSpan(span), attributes);
}

/** Event emitted for add span. */
export function addSpanEvent(
  span: Span | null,
  name: string,
  attributes?: Record<string, string | number | boolean>,
): void {
  getSpanOps()?.addEvent(restoreSpan(span), name, attributes);
}

/** Create child span. */
export function createChildSpan(
  parentSpan: Span | null,
  name: string,
  options: SpanOptions = {},
): Span | null {
  return exposeSpan(
    getSpanOps()?.createChildSpan(
      restoreSpan(parentSpan),
      name,
      restoreSpanOptions(options),
    ) ?? null,
  );
}

/** Context for extract. */
export function extractContext(headers: Headers): Context | undefined {
  return exposeContext(getContextProp()?.extractContext(headers));
}

/** Context for inject. */
export function injectContext(context: Context, headers: Headers): void {
  getContextProp()?.injectContext(restoreContext(context), headers);
}

/** Context for get active. */
export function getActiveContext(): Context | undefined {
  return exposeContext(getContextProp()?.getActiveContext());
}

/** Applies active span. */
export async function withActiveSpan<T>(span: Span | null, fn: () => Promise<T>): Promise<T> {
  const contextProp = getContextProp();
  if (!contextProp) return fn();
  return contextProp.withActiveSpan(restoreSpan(span), fn);
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
    (span) => fn(exposeSpan(span)),
    (n) => spanOps.startSpan(n, restoreSpanOptions(options)),
    (s: Span | null, ...failure: [] | [error: unknown]) => {
      if (failure.length > 0) spanOps.endSpanWithFailure(s, failure[0]);
      else spanOps.endSpan(s);
    },
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
    (span) => fn(exposeSpan(span)),
    (n) => spanOps.startSpan(n, restoreSpanOptions(options)),
    (s: Span | null, ...failure: [] | [error: unknown]) => {
      if (failure.length > 0) spanOps.endSpanWithFailure(s, failure[0]);
      else spanOps.endSpan(s);
    },
  );
}

export { tracingManager } from "./manager.ts";
export { TracingManager } from "./manager.ts";
