import { serverLogger as logger } from "#veryfront/utils";
import type { Context, OpenTelemetryAPI, Span, SpanKind, SpanOptions, Tracer } from "./types.ts";

const log = logger.component("tracing");

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
      log.debug("Failed to start span", { name, error });
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
      log.debug("Failed to end span", error);
    }
  }

  setAttributes(span: Span | null, attributes: Record<string, string | number | boolean>): void {
    if (!span) return;

    try {
      span.setAttributes(attributes);
    } catch (error) {
      log.debug("Failed to set span attributes", error);
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
      log.debug("Failed to add span event", error);
    }
  }

  createChildSpan(parentSpan: Span | null, name: string, options: SpanOptions = {}): Span | null {
    if (!parentSpan) return this.startSpan(name, options);

    try {
      const parentContext = this.api.trace.setSpan(this.api.context.active(), parentSpan);
      return this.startSpan(name, { ...options, parent: parentContext });
    } catch (error) {
      log.debug("Failed to create child span", error);
      return null;
    }
  }

  private mapSpanKind(kind?: SpanOptions["kind"]): SpanKind {
    if (!kind) return this.api.SpanKind.INTERNAL;

    const kindMap: Record<string, SpanKind> = {
      internal: this.api.SpanKind.INTERNAL,
      server: this.api.SpanKind.SERVER,
      client: this.api.SpanKind.CLIENT,
      producer: this.api.SpanKind.PRODUCER,
      consumer: this.api.SpanKind.CONSUMER,
    };

    return kindMap[kind.toLowerCase()] ?? this.api.SpanKind.INTERNAL;
  }
}
