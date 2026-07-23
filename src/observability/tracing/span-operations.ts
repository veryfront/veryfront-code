import { serverLogger } from "#veryfront/utils";
import { sanitizeErrorForTelemetry, sanitizeTelemetryAttributes } from "../telemetry-error.ts";
import type { Context, OpenTelemetryAPI, Span, SpanKind, SpanOptions, Tracer } from "./types.ts";

const logger = serverLogger.component("tracing");

function reportTelemetryFailure(message: string, error: unknown): void {
  try {
    logger.debug(message, error);
  } catch (_) {
    /* expected: telemetry and logging failures must not affect application work */
  }
}

export class SpanOperations {
  constructor(
    private api: OpenTelemetryAPI,
    private tracer: Tracer,
  ) {}

  startSpan(name: string, options: SpanOptions = {}): Span | null {
    try {
      const parent = this.resolveParent(options.parent);
      return this.tracer.startSpan(
        name,
        {
          kind: this.mapSpanKind(options.kind),
          attributes: sanitizeTelemetryAttributes(options.attributes) ?? {},
        },
        parent,
      );
    } catch (error) {
      reportTelemetryFailure("Failed to start span", error);
      return null;
    }
  }

  endSpan(span: Span | null, ...failure: [] | [error: unknown]): void {
    if (!span) return;

    if (failure.length > 0) {
      const error = failure[0];
      const telemetryError = sanitizeErrorForTelemetry(error);
      try {
        span.recordException(telemetryError);
      } catch (recordError) {
        reportTelemetryFailure("Failed to record span exception", recordError);
      }
      try {
        span.setStatus({
          code: this.api.SpanStatusCode.ERROR,
          message: telemetryError.message,
        });
      } catch (statusError) {
        reportTelemetryFailure("Failed to set span error status", statusError);
      }
    } else {
      try {
        span.setStatus({ code: this.api.SpanStatusCode.OK });
      } catch (statusError) {
        reportTelemetryFailure("Failed to set span status", statusError);
      }
    }

    try {
      span.end();
    } catch (endError) {
      reportTelemetryFailure("Failed to end span", endError);
    }
  }

  setAttributes(span: Span | null, attributes: Record<string, string | number | boolean>): void {
    if (!span) return;

    try {
      span.setAttributes(sanitizeTelemetryAttributes(attributes));
    } catch (error) {
      reportTelemetryFailure("Failed to set span attributes", error);
    }
  }

  addEvent(
    span: Span | null,
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    if (!span) return;

    try {
      span.addEvent(name, sanitizeTelemetryAttributes(attributes));
    } catch (error) {
      reportTelemetryFailure("Failed to add span event", error);
    }
  }

  createChildSpan(parentSpan: Span | null, name: string, options: SpanOptions = {}): Span | null {
    if (!parentSpan) return this.startSpan(name, options);

    try {
      const parentContext = this.api.trace.setSpan(this.api.context.active(), parentSpan);
      return this.startSpan(name, { ...options, parent: parentContext });
    } catch (error) {
      reportTelemetryFailure("Failed to create child span", error);
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

  private resolveParent(parent: SpanOptions["parent"]): Context | undefined {
    if (!parent) return undefined;
    if (typeof (parent as Span).spanContext !== "function") return parent as Context;
    return this.api.trace.setSpan(this.api.context.active(), parent as Span);
  }
}
