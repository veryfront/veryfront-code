import { serverLogger as logger } from "@veryfront/utils";
import type { Context, OpenTelemetryAPI, Span, TextMapPropagator } from "./types.ts";

export class ContextPropagation {
  constructor(
    private api: OpenTelemetryAPI,
    private propagator: TextMapPropagator,
  ) {}

  extractContext(headers: Headers): Context | undefined {
    try {
      const carrier: Record<string, string> = {};
      headers.forEach((value, key) => {
        carrier[key] = value;
      });

      return this.api.propagation.extract(this.api.context.active(), carrier);
    } catch (error) {
      logger.debug("[tracing] Failed to extract context from headers", error);
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
      logger.debug("[tracing] Failed to inject context into headers", error);
    }
  }

  getActiveContext(): Context | undefined {
    try {
      return this.api.context.active();
    } catch (error) {
      logger.debug("[tracing] Failed to get active context", error);
      return undefined;
    }
  }

  async withActiveSpan<T>(span: Span | null, fn: () => Promise<T>): Promise<T> {
    if (!span) return await fn();

    try {
      return await this.api.context.with(
        this.api.trace.setSpan(this.api.context.active(), span),
        fn,
      );
    } catch (error) {
      throw error;
    }
  }

  withSpan<T>(
    name: string,
    fn: (span: Span | null) => T,
    startSpan: (name: string) => Span | null,
    endSpan: (span: Span | null, error?: Error) => void,
  ): T {
    const span = startSpan(name);

    try {
      const result = fn(span);
      endSpan(span);
      return result;
    } catch (error) {
      endSpan(span, error as Error);
      throw error;
    }
  }

  async withSpanAsync<T>(
    name: string,
    fn: (span: Span | null) => Promise<T>,
    startSpan: (name: string) => Span | null,
    endSpan: (span: Span | null, error?: Error) => void,
  ): Promise<T> {
    const span = startSpan(name);

    try {
      const result = await fn(span);
      endSpan(span);
      return result;
    } catch (error) {
      endSpan(span, error as Error);
      throw error;
    }
  }
}
