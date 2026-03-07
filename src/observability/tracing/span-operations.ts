import { serverLogger } from "#veryfront/utils";
import type { Context, OpenTelemetryAPI, Span, SpanKind, SpanOptions, Tracer } from "./types.ts";

const logger = serverLogger.component("tracing");

export class SpanOperations {
  constructor(
    private api: OpenTelemetryAPI,
    private tracer: Tracer,
  ) {}

  startSpan(name: string, options: SpanOptions = {}): Span | null {
    try {
      return this.tracer.startSpan(
        name,
        {
          kind: this.mapSpanKind(options.kind),
          attributes: options.attributes ?? {},
        },
        options.parent as Context | undefined,
      );
    } catch (error) {
      logger.debug("Failed to start span", { name, error });
      return null;
    }
  }

  endSpan(span: Span | null, error?: Error): void {
    if (!span) return;

    try {
      if (error) {
        span.recordException(error);
        span.setStatus({
          code: this.api.SpanStatusCode.ERROR,
          message: error.message,
        });
      } else {
        span.setStatus({ code: this.api.SpanStatusCode.OK });
      }

      span.end();
    } catch (error) {
      logger.debug("Failed to end span", error);
    }
  }

  setAttributes(span: Span | null, attributes: Record<string, string | number | boolean>): void {
    if (!span) return;

    try {
      span.setAttributes(attributes);
    } catch (error) {
      logger.debug("Failed to set span attributes", error);
    }
  }

  addEvent(
    span: Span | null,
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    if (!span) return;

    try {
      span.addEvent(name, attributes);
    } catch (error) {
      logger.debug("Failed to add span event", error);
    }
  }

  createChildSpan(parentSpan: Span | null, name: string, options: SpanOptions = {}): Span | null {
    if (!parentSpan) return this.startSpan(name, options);

    try {
      const parentContext = this.api.trace.setSpan(this.api.context.active(), parentSpan);
      return this.startSpan(name, { ...options, parent: parentContext });
    } catch (error) {
      logger.debug("Failed to create child span", error);
      return null;
    }
  }

  private mapSpanKind(kind?: SpanOptions["kind"]): SpanKind {
    if (!kind) return this.api.SpanKind.INTERNAL;

    switch (kind) {
      case "internal":
        return this.api.SpanKind.INTERNAL;
      case "server":
        return this.api.SpanKind.SERVER;
      case "client":
        return this.api.SpanKind.CLIENT;
      case "producer":
        return this.api.SpanKind.PRODUCER;
      case "consumer":
        return this.api.SpanKind.CONSUMER;
      default:
        return this.api.SpanKind.INTERNAL;
    }
  }
}
