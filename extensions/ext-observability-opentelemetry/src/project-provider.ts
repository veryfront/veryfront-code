import * as api from "@opentelemetry/api";
import { suppressTracing, W3CTraceContextPropagator } from "@opentelemetry/core";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  AlwaysOnSampler,
  BasicTracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import { clearTimeout, setTimeout } from "node:timers";
import type {
  ProjectTraceProvider,
  ProjectTraceProviderOptions,
} from "veryfront/extensions/observability";

type Transport = ReturnType<ProjectTraceProviderOptions["createTransport"]>;
const MAX_QUEUE_BYTES = 1024 * 1024;
const MAX_SPAN_BYTES = 64 * 1024;

/** The byte budget is measured with the SDK serializer before retaining ended spans. */
class ProjectSpanProcessor implements SpanProcessor {
  private queue: { span: ReadableSpan; bytes: number }[] = [];
  private bytes = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private flushing?: Promise<void>;
  private closed = false;
  private discarded = false;
  private activeSpans = 0;

  constructor(
    private readonly transport: Transport,
    private readonly resource: Readonly<Record<string, string>>,
  ) {}

  private snapshot(span: ReadableSpan): ReadableSpan {
    const context = span.spanContext();
    const attributes = { ...span.attributes };
    for (const key of ["project.id", "environment.id"]) {
      if (this.resource[key] !== undefined) attributes[key] = this.resource[key];
    }
    // Do not retain the mutable SDK span or let caller attributes replace ownership.
    return {
      name: span.name.slice(0, 256),
      kind: span.kind,
      spanContext: () => context,
      parentSpanContext: span.parentSpanContext,
      startTime: span.startTime,
      endTime: span.endTime,
      duration: span.duration,
      ended: span.ended,
      status: { ...span.status },
      attributes,
      events: [...span.events],
      links: [...span.links],
      resource: span.resource,
      instrumentationScope: span.instrumentationScope,
      droppedAttributesCount: span.droppedAttributesCount,
      droppedEventsCount: span.droppedEventsCount,
      droppedLinksCount: span.droppedLinksCount,
    };
  }

  onStart(): void {
    this.activeSpans++;
  }

  hasActiveSpans(): boolean {
    return this.activeSpans > 0;
  }

  onEnd(span: ReadableSpan): void {
    this.activeSpans = Math.max(0, this.activeSpans - 1);
    if (this.closed) return;
    try {
      span = this.snapshot(span);
      const bytes = JsonTraceSerializer.serializeRequest([span])?.byteLength ?? 0;
      if (
        !bytes || bytes > MAX_SPAN_BYTES || this.queue.length >= 512 ||
        this.bytes + bytes > MAX_QUEUE_BYTES
      ) return;
      this.queue.push({ span, bytes });
      this.bytes += bytes;
      if (this.queue.length >= 32) void this.pump();
      else if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.pump();
        }, 500);
        this.timer.unref();
      }
    } catch { /* Invalid telemetry must not fail application execution. */ }
  }

  private pump(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.flushing ??= this.drain().catch(() => {}).finally(() => {
      this.flushing = undefined;
      if (this.queue.length && !this.discarded) void this.pump();
    });
    return this.flushing;
  }

  async forceFlush(): Promise<void> {
    do {
      await this.pump();
    } while ((this.queue.length || this.flushing) && !this.discarded);
  }

  private async drain(): Promise<void> {
    while (this.queue.length && !this.discarded) {
      const batch: ReadableSpan[] = [];
      let bytes = 0;
      while (
        this.queue.length && batch.length < 32 &&
        bytes + this.queue[0]!.bytes <= MAX_QUEUE_BYTES / 2
      ) {
        const item = this.queue.shift()!;
        this.bytes -= item.bytes;
        bytes += item.bytes;
        batch.push(item.span);
      }
      const data = JsonTraceSerializer.serializeRequest(batch);
      if (!data) continue;
      // At most one retry; the transport bounds each attempt and revocation aborts it.
      for (let attempt = 0; attempt < 2 && !this.discarded; attempt++) {
        if ((await this.transport.send(data, 5000)).status === "success") break;
      }
    }
  }

  discard(): void {
    this.closed = true;
    this.discarded = true;
    this.queue = [];
    this.bytes = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.transport.shutdown();
  }

  shutdown(): Promise<void> {
    this.closed = true;
    return this.forceFlush();
  }
}

/** Create private tracing APIs without installing a global provider or context manager. */
export function createProjectTraceProvider(
  options: ProjectTraceProviderOptions,
): ProjectTraceProvider {
  const manager = new AsyncLocalStorageContextManager().enable();
  const transport = options.createTransport((operation) =>
    manager.with(
      suppressTracing(manager.active()),
      () => api.context.with(suppressTracing(api.context.active()), operation),
    )
  );
  const processor = new ProjectSpanProcessor(transport, options.resource);
  const sdk = new BasicTracerProvider({
    resource: resourceFromAttributes(options.resource),
    // Project collection is independent of a sampled-out platform parent.
    sampler: new AlwaysOnSampler(),
    spanLimits: {
      attributeCountLimit: 32,
      attributeValueLengthLimit: 512,
      eventCountLimit: 8,
      linkCountLimit: 8,
      attributePerEventCountLimit: 8,
      attributePerLinkCountLimit: 8,
    },
    spanProcessors: [processor],
  });
  const propagator = new W3CTraceContextPropagator();
  let closed = false;
  let shutdown: Promise<void> | undefined;
  const scopes = new Map<string, api.Tracer>();
  const fallback = sdk.getTracer("application");
  const provider = Object.freeze({
    getTracer(name: string, version?: string): api.Tracer {
      const boundedName = name.slice(0, 256);
      const boundedVersion = version?.slice(0, 128);
      const key = `${boundedName.length}:${boundedName}${boundedVersion ?? ""}`;
      let tracer = scopes.get(key);
      if (!tracer) {
        tracer = scopes.size < 64 ? sdk.getTracer(boundedName, boundedVersion) : fallback;
        if (scopes.size < 64) scopes.set(key, tracer);
      }
      const captured = tracer;
      const startSpan = (
        spanName: string,
        spanOptions?: api.SpanOptions,
        parent?: api.Context,
      ): api.Span =>
        closed
          ? api.trace.wrapSpanContext(api.INVALID_SPAN_CONTEXT)
          : captured.startSpan(spanName.slice(0, 256), spanOptions, parent ?? manager.active());
      const startActiveSpan =
        ((spanName: string, second: unknown, third?: unknown, fourth?: unknown): unknown => {
          const fn = typeof second === "function"
            ? second
            : typeof third === "function"
            ? third
            : fourth;
          const spanOptions = typeof second === "function" ? undefined : second as api.SpanOptions;
          const parent = fourth === undefined ? manager.active() : third as api.Context;
          const span = startSpan(spanName, spanOptions, parent);
          return manager.with(
            api.trace.setSpan(parent, span),
            () => (fn as (span: api.Span) => unknown)(span),
          );
        }) as api.Tracer["startActiveSpan"];
      return Object.freeze({ startSpan, startActiveSpan });
    },
  });
  return Object.freeze({
    hasActiveSpans: () => processor.hasActiveSpans(),
    getProvider: () => provider,
    getContextAPI: () => ({
      active: () => manager.active(),
      with: <T>(ctx: unknown, fn: () => T): T => manager.with(ctx as api.Context, fn),
    }),
    getTraceAPI: () => ({
      getActiveSpan: () => api.trace.getSpan(manager.active()),
      getSpan: (ctx: unknown) => api.trace.getSpan(ctx as api.Context),
      setSpan: (ctx: unknown, span: unknown) =>
        api.trace.setSpan(ctx as api.Context, span as api.Span),
    }),
    getPropagator: () => propagator,
    forceFlush: () => sdk.forceFlush(),
    shutdown(discard: boolean): Promise<void> {
      closed = true;
      if (discard) processor.discard();
      shutdown ??= sdk.shutdown().finally(() => {
        transport.shutdown();
        manager.disable();
        scopes.clear();
      });
      return shutdown;
    },
  });
}
