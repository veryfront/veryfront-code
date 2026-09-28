import { AsyncLocalStorage } from "node:async_hooks";
import type { ProjectTraceProvider } from "#veryfront/extensions/observability/tracing-exporter.ts";
import {
  type Context,
  context,
  type Span,
  type SpanStartOptions,
  type Tracer,
} from "./api-shim.ts";
import { formatTraceparent, parseTraceparent } from "./traceparent.ts";
import { runWithProjectTraceProvider } from "./project-trace-scope.ts";
import { sanitizeTelemetryAttributes, sanitizeTelemetryText } from "../telemetry-error.ts";

const now = Date.now;
const randomUUID = crypto.randomUUID.bind(crypto);
const stringify = JSON.stringify;
const MAX_SPANS = 128;
const MAX_JSON_CHARS = 256 * 1024;

/** A request-local recorder. It has no exporter, destination or credentials. */
export function createWorkerTraceRecorder(traceparent: string | undefined) {
  const parent = parseTraceparent(traceparent);
  if (!parent) return undefined;
  const storage = new AsyncLocalStorage<Context>();
  const spanKey = Symbol("worker.request.span");
  const inheritedSpan: Span = {
    spanContext: () => ({ ...parent }),
    setAttribute: () => inheritedSpan,
    setAttributes: () => inheritedSpan,
    setStatus: () => inheritedSpan,
    addEvent: () => inheritedSpan,
    recordException() {},
    updateName() {},
    end() {},
  };
  const root = context.active().setValue(spanKey, inheritedSpan);
  const owners = new WeakSet<Span>();
  owners.add(inheritedSpan);
  const records: Record<string, unknown>[] = [];
  let retainedChars = 2;
  let closed = false;
  let started = 0;
  const active = () => storage.getStore() ?? root;
  const getSpan = (ctx: Context) => ctx.getValue(spanKey) as Span | undefined;
  const createTracer = (scopeName: string, scopeVersion?: string): Tracer => {
    const tracer: Tracer = {
      startSpan(name: string, options: SpanStartOptions = {}, ctx = active()): Span {
        const inherited = getSpan(ctx)?.spanContext() ?? parent;
        const ids = {
          ...inherited,
          traceId: options.root ? randomUUID().replaceAll("-", "") : inherited.traceId,
          spanId: randomUUID().replaceAll("-", "").slice(0, 16),
        };
        const record = {
          scopeName: sanitizeTelemetryText(scopeName, 256),
          scopeVersion: scopeVersion && sanitizeTelemetryText(scopeVersion, 128),
          name: sanitizeTelemetryText(name, 256),
          spanId: ids.spanId,
          traceId: ids.traceId,
          root: options.root === true,
          parentSpanId: options.root ? undefined : inherited.spanId,
          kind: options.kind ?? 0,
          links: (options.links ?? []).slice(0, 8).flatMap((link) => {
            const context = parseTraceparent(formatTraceparent(link.context));
            return context
              ? [{ context, attributes: sanitizeTelemetryAttributes(link.attributes) ?? {} }]
              : [];
          }),
          startTime: now(),
          endTime: 0,
          attributes: sanitizeTelemetryAttributes(options.attributes) ?? {},
          events: [] as {
            name: string;
            time: number;
            attributes: ReturnType<typeof sanitizeTelemetryAttributes>;
          }[],
          status: { code: 0 } as { code: number; message?: string },
        };
        const admitted = !closed && started++ < MAX_SPANS;
        let ended = false;
        const span: Span = {
          spanContext: () => ({ ...ids }),
          setAttribute(key, value) {
            return span.setAttributes({ [key]: value });
          },
          setAttributes(values) {
            if (!ended && !closed) {
              record.attributes =
                sanitizeTelemetryAttributes({ ...record.attributes, ...values }) ??
                  {};
            }
            return span;
          },
          setStatus(status) {
            if (!ended && !closed) {
              record.status = {
                code: status.code,
                message: status.message && sanitizeTelemetryText(status.message, 512),
              };
            }
            return span;
          },
          updateName(value) {
            if (!ended && !closed) record.name = sanitizeTelemetryText(value, 256);
          },
          addEvent(value, attributes) {
            if (!ended && !closed && record.events.length < 8) {
              record.events.push({
                name: sanitizeTelemetryText(value, 256),
                time: now(),
                attributes: sanitizeTelemetryAttributes(attributes),
              });
            }
            return span;
          },
          recordException(error) {
            span.addEvent("exception", {
              "exception.message": error instanceof Error ? error.message : String(error),
            });
          },
          end(endTime?: number) {
            if (ended) return;
            ended = true;
            if (!admitted || closed) return;
            record.endTime = endTime === undefined ? now() : endTime;
            const encoded = stringify(record);
            if (encoded.length > 64 * 1024 || retainedChars + encoded.length + 1 > MAX_JSON_CHARS) {
              return;
            }
            retainedChars += encoded.length + 1;
            records.push(JSON.parse(encoded));
          },
        };
        owners.add(span);
        return span;
      },
      startActiveSpan: ((name: string, second: unknown, third?: unknown, fourth?: unknown) => {
        const fn = typeof second === "function"
          ? second
          : typeof third === "function"
          ? third
          : fourth;
        const ctx = fourth === undefined ? active() : third as Context;
        const span = tracer.startSpan(
          name,
          typeof second === "function" ? undefined : second as SpanStartOptions,
          ctx,
        );
        return storage.run(
          ctx.setValue(spanKey, span),
          () => (fn as (span: Span) => unknown)(span),
        );
      }) as Tracer["startActiveSpan"],
    };
    return tracer;
  };
  const provider: ProjectTraceProvider = {
    ownsSpan: (span) => typeof span === "object" && span !== null && owners.has(span as Span),
    hasActiveSpans: () => !closed,
    getProvider: () => ({ getTracer: (name, version) => createTracer(name, version) }),
    getTraceAPI: () => ({
      getActiveSpan: () => getSpan(active()),
      getSpan: (ctx) => getSpan(ctx as Context),
      setSpan: (ctx, span) => (ctx as Context).setValue(spanKey, span),
    }),
    getContextAPI: () => ({ active, with: (ctx, fn) => storage.run(ctx as Context, fn) }),
    getPropagator: () => ({
      fields: () => ["traceparent"],
      extract: (
        ctx: Context,
        carrier: Record<string, string>,
        getter?: { get(carrier: unknown, key: string): string | string[] | undefined },
      ) => {
        const header = getter ? getter.get(carrier, "traceparent") : carrier.traceparent;
        const remote = parseTraceparent(Array.isArray(header) ? header[0] : header);
        if (!remote) return ctx;
        const remoteSpan: Span = { ...inheritedSpan, spanContext: () => ({ ...remote }) };
        owners.add(remoteSpan);
        return ctx.setValue(spanKey, remoteSpan);
      },
      inject: (
        ctx: Context,
        carrier: Record<string, string>,
        setter?: { set(carrier: unknown, key: string, value: string): void },
      ) => {
        const value = formatTraceparent(getSpan(ctx)?.spanContext() ?? parent)!;
        if (setter) setter.set(carrier, "traceparent", value);
        else carrier.traceparent = value;
      },
    }),
    forceFlush: () => Promise.resolve(),
    shutdown: () => {
      closed = true;
      return Promise.resolve();
    },
  };
  return {
    run: <T>(fn: () => T): T => runWithProjectTraceProvider(provider, fn),
    finish: (): string => {
      closed = true;
      try {
        return stringify(records);
      } catch {
        return "[]";
      }
    },
  };
}
