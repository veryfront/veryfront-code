import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import type { ProjectTraceProvider } from "#veryfront/extensions/observability/tracing-exporter.ts";
import {
  type Context,
  type ContextAccessor,
  type Span,
  SpanKind,
  SpanStatusCode,
  type TextMapPropagator,
  type Tracer,
} from "./api-shim.ts";
import { getProjectTraceProvider } from "./project-trace-scope.ts";
import { ContextPropagation } from "./context-propagation.ts";
import { SpanOperations } from "./span-operations.ts";
import type { OpenTelemetryAPI } from "./types.ts";

const helpers = createPrivateWeakStore<
  ProjectTraceProvider,
  { spans: SpanOperations; context: ContextPropagation }
>();

/** Public application helpers reuse the existing sanitization/finalization behavior. */
export function getProjectTraceHelpers(provider = getProjectTraceProvider()):
  | { spans: SpanOperations; context: ContextPropagation }
  | undefined {
  if (!provider) return undefined;
  let cached = helpers.get(provider);
  if (cached) return cached;
  const trace = provider.getTraceAPI();
  const propagator = provider.getPropagator() as TextMapPropagator;
  const api: OpenTelemetryAPI = {
    trace: {
      getTracer: (name, version) =>
        provider.getProvider().getTracer(name ?? "application", version) as Tracer,
      setSpan: (ctx: Context, span: Span) => trace.setSpan(ctx, span) as Context,
    },
    context: provider.getContextAPI() as ContextAccessor,
    propagation: {
      setGlobalPropagator() {},
      extract: (ctx, carrier) =>
        propagator.extract(ctx, carrier, {
          keys: Object.keys,
          get: (record, key) => (record as Record<string, string>)[key],
        }),
      inject: (ctx, carrier) =>
        propagator.inject(ctx, carrier, {
          set: (record, key, value) => {
            (record as Record<string, string>)[key] = value;
          },
        }),
    },
    SpanKind,
    SpanStatusCode,
  };
  cached = {
    spans: new SpanOperations(api, api.trace.getTracer("veryfront.application")),
    context: new ContextPropagation(api, propagator),
  };
  helpers.set(provider, cached);
  return cached;
}
