import { serverLogger } from "#veryfront/utils";
import { runAsyncWithContextFallback, runSyncWithContextFallback } from "./context-callback.ts";
import type { Context, OpenTelemetryAPI, Span, TextMapPropagator } from "./types.ts";

const logger = serverLogger.component("tracing");
type SpanFailure = [] | [error: unknown];
type SpanFinalizer = {
  bivarianceHack(span: Span | null, error?: unknown): void;
}["bivarianceHack"];

export class ContextPropagation {
  constructor(
    private api: OpenTelemetryAPI,
    private propagator: TextMapPropagator,
  ) {}

  extractContext(headers: Headers): Context | undefined {
    try {
      const carrier: Record<string, string> = Object.fromEntries(headers);
      return this.api.propagation.extract(this.api.context.active(), carrier);
    } catch (error) {
      this.debug("Failed to extract context from headers", error);
      return undefined;
    }
  }

  injectContext(context: Context, headers: Headers): void {
    try {
      const carrier: Record<string, string> = {};
      this.api.propagation.inject(context, carrier);

      for (const [key, value] of Object.entries(carrier)) {
        headers.set(key, value);
      }
    } catch (error) {
      this.debug("Failed to inject context into headers", error);
    }
  }

  getActiveContext(): Context | undefined {
    try {
      return this.api.context.active();
    } catch (error) {
      this.debug("Failed to get active context", error);
      return undefined;
    }
  }

  withActiveSpan<T>(span: Span | null, fn: () => Promise<T>): Promise<T> {
    if (!span) return fn();

    const spanContext = this.resolveSpanContext(span);
    if (!spanContext) return fn();

    return runAsyncWithContextFallback(
      (callback) => this.api.context.with(spanContext, callback),
      fn,
      (error) => this.debug("Failed to activate span context", error),
    );
  }

  withSpan<T>(
    name: string,
    fn: (span: Span | null) => T,
    startSpan: (name: string) => Span | null,
    endSpan: SpanFinalizer,
  ): T {
    const span = this.startSpanSafely(name, startSpan);
    const spanContext = this.resolveSpanContext(span);

    try {
      const result = spanContext
        ? runSyncWithContextFallback(
          (callback) => this.api.context.with(spanContext, callback),
          () => fn(span),
          (error) => this.debug("Failed to activate span context", error),
        )
        : fn(span);
      this.endSpanSafely(span, endSpan);
      return result;
    } catch (error) {
      this.endSpanSafely(span, endSpan, [error]);
      throw error;
    }
  }

  async withSpanAsync<T>(
    name: string,
    fn: (span: Span | null) => Promise<T>,
    startSpan: (name: string) => Span | null,
    endSpan: SpanFinalizer,
  ): Promise<T> {
    const span = this.startSpanSafely(name, startSpan);
    const spanContext = this.resolveSpanContext(span);

    try {
      const result = spanContext
        ? await runAsyncWithContextFallback(
          (callback) => this.api.context.with(spanContext, callback),
          () => fn(span),
          (error) => this.debug("Failed to activate span context", error),
        )
        : await fn(span);
      this.endSpanSafely(span, endSpan);
      return result;
    } catch (error) {
      this.endSpanSafely(span, endSpan, [error]);
      throw error;
    }
  }

  private resolveSpanContext(span: Span | null): Context | undefined {
    const activeContext = this.getActiveContext();
    if (!activeContext || !span) return activeContext;

    try {
      return this.api.trace.setSpan(activeContext, span);
    } catch (error) {
      this.debug("Failed to associate span with context", error);
      return activeContext;
    }
  }

  private startSpanSafely(
    name: string,
    startSpan: (name: string) => Span | null,
  ): Span | null {
    try {
      return startSpan(name);
    } catch (error) {
      this.debug("Failed to start span", error);
      return null;
    }
  }

  private endSpanSafely(
    span: Span | null,
    endSpan: SpanFinalizer,
    failure: SpanFailure = [],
  ): void {
    try {
      if (failure.length > 0) endSpan(span, failure[0]);
      else endSpan(span);
    } catch (endError) {
      this.debug("Failed to end span", endError);
    }
  }

  private debug(message: string, error: unknown): void {
    try {
      logger.debug(message, error);
    } catch (_) {
      /* expected: logging failures must not affect application work */
    }
  }
}
