import { serverLogger } from "#veryfront/utils";
import type { Context, OpenTelemetryAPI, Span, SpanKind, SpanOptions, Tracer } from "./types.ts";
import {
  classifyTelemetryError,
  normalizeTelemetryName,
  runSpanHook,
  sanitizeTelemetryAttributes,
  setSanitizedSpanError,
} from "../telemetry-safety.ts";

const logger = serverLogger.component("tracing");

function logTracingFailure(message: string, error: unknown): void {
  try {
    logger.debug(message, { failure_category: classifyTelemetryError(error) });
  } catch {
    // Logging must not affect application behavior.
  }
}

export class SpanOperations {
  constructor(
    private api: OpenTelemetryAPI,
    private tracer: Tracer,
  ) {}

  startSpan(name: string, options: SpanOptions = {}): Span | null {
    try {
      return this.tracer.startSpan(
        normalizeTelemetryName(name),
        {
          kind: this.mapSpanKind(options.kind),
          attributes: sanitizeTelemetryAttributes(options.attributes),
        },
        this.resolveParent(options.parent),
      );
    } catch (error) {
      logTracingFailure("Failed to start span", error);
      return null;
    }
  }

  endSpan(span: Span | null, error?: unknown): void {
    if (!span) return;

    if (error !== undefined) {
      setSanitizedSpanError(span, this.api.SpanStatusCode.ERROR, error);
    } else {
      runSpanHook(() => span.setStatus({ code: this.api.SpanStatusCode.OK }));
    }
    runSpanHook(() => span.end());
  }

  setAttributes(span: Span | null, attributes: Record<string, string | number | boolean>): void {
    if (!span) return;

    try {
      span.setAttributes(sanitizeTelemetryAttributes(attributes));
    } catch (error) {
      logTracingFailure("Failed to set span attributes", error);
    }
  }

  addEvent(
    span: Span | null,
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    if (!span) return;

    try {
      span.addEvent(
        normalizeTelemetryName(name),
        attributes ? sanitizeTelemetryAttributes(attributes) : undefined,
      );
    } catch (error) {
      logTracingFailure("Failed to add span event", error);
    }
  }

  createChildSpan(parentSpan: Span | null, name: string, options: SpanOptions = {}): Span | null {
    if (!parentSpan) return this.startSpan(name, options);

    try {
      const parentContext = this.api.trace.setSpan(this.api.context.active(), parentSpan);
      return this.startSpan(name, { ...options, parent: parentContext });
    } catch (error) {
      logTracingFailure("Failed to create child span", error);
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
    try {
      if (
        typeof (parent as Span).setAttribute === "function" &&
        typeof (parent as Span).spanContext === "function"
      ) {
        return this.api.trace.setSpan(this.api.context.active(), parent as Span);
      }
    } catch {
      return undefined;
    }
    return parent as Context;
  }
}
