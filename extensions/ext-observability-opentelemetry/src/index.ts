/**
 * ext-observability-opentelemetry: OpenTelemetry observability extension backed by the
 * official OpenTelemetry JS SDK.
 *
 * Provides the `TracingExporter` and `NodeTelemetryProvider` contracts:
 *  - `start(config)`: builds the SDK provider and OTLP HTTP exporter
 *  - `export(spans)`: no-op, the SDK handles export via BatchSpanProcessor
 *  - `shutdown()`: flushes and shuts down the provider
 *  - `getProvider()`: returns the SDK TracerProvider for shim wiring
 *  - `initialize(options)`: starts NodeSDK auto-instrumentation
 *
 * Configuration is read from standard OTEL environment variables.
 *
 * @module extensions/ext-observability-opentelemetry
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type {
  NodeTelemetryInitializeOptions,
  NodeTelemetryProvider,
  SpanData,
  TracingExporter,
} from "veryfront/extensions/observability";

/**
 * The TracerProvider interface as expected by the core shim.
 * Using structural typing because the real SDK provider satisfies this shape.
 */
interface ShimTracerProvider {
  getTracer(name: string, version?: string): unknown;
}

type OpenTelemetryRuntime = {
  api: typeof import("@opentelemetry/api");
  autoInstrumentations: typeof import("@opentelemetry/auto-instrumentations-node");
  core: typeof import("@opentelemetry/core");
  contextAsyncHooks: typeof import("@opentelemetry/context-async-hooks");
  sdkNode: typeof import("@opentelemetry/sdk-node");
  metricsExporter: typeof import("@opentelemetry/exporter-metrics-otlp-http");
  sdkMetrics: typeof import("@opentelemetry/sdk-metrics");
  sdkTraceBase: typeof import("@opentelemetry/sdk-trace-base");
  traceExporter: typeof import("@opentelemetry/exporter-trace-otlp-http");
  resources: typeof import("@opentelemetry/resources");
  semanticConventions: typeof import("@opentelemetry/semantic-conventions");
};

type SdkMeterProvider = InstanceType<
  typeof import("@opentelemetry/sdk-metrics").MeterProvider
>;
type SdkTracerProvider = InstanceType<
  typeof import("@opentelemetry/sdk-trace-base").BasicTracerProvider
>;
type MetricsAPI = { getMeter(name: string | undefined, version?: string): unknown };
type TraceAPI = { getActiveSpan(): unknown; getSpan(ctx: unknown): unknown };

const NOOP_SPAN = {
  setAttribute() {
    return NOOP_SPAN;
  },
  setAttributes() {
    return NOOP_SPAN;
  },
  setStatus() {
    return NOOP_SPAN;
  },
  recordException() {},
  addEvent() {
    return NOOP_SPAN;
  },
  end() {},
  spanContext() {
    return {
      traceId: "00000000000000000000000000000000",
      spanId: "0000000000000000",
      traceFlags: 0,
    };
  },
  updateName() {},
};

const NOOP_TRACER = {
  startSpan() {
    return NOOP_SPAN;
  },
  startActiveSpan(
    _name: string,
    optionsOrFn:
      | { kind?: number; attributes?: Record<string, string | number | boolean | undefined> }
      | ((span: typeof NOOP_SPAN) => unknown),
    contextOrFn?: unknown,
    fn?: (span: typeof NOOP_SPAN) => unknown,
  ) {
    const callback = typeof optionsOrFn === "function"
      ? optionsOrFn
      : typeof contextOrFn === "function"
      ? contextOrFn
      : fn;
    return callback?.(NOOP_SPAN);
  },
};

const NOOP_TRACER_PROVIDER: ShimTracerProvider = {
  getTracer() {
    return NOOP_TRACER;
  },
};

async function loadOpenTelemetryRuntime(): Promise<OpenTelemetryRuntime> {
  try {
    const [
      api,
      autoInstrumentations,
      core,
      contextAsyncHooks,
      sdkNode,
      metricsExporter,
      sdkMetrics,
      sdkTraceBase,
      traceExporter,
      resources,
      semanticConventions,
    ] = await Promise.all([
      import("@opentelemetry/api"),
      import("@opentelemetry/auto-instrumentations-node"),
      import("@opentelemetry/core"),
      import("@opentelemetry/context-async-hooks"),
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/exporter-metrics-otlp-http"),
      import("@opentelemetry/sdk-metrics"),
      import("@opentelemetry/sdk-trace-base"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/semantic-conventions"),
    ]);

    return {
      api,
      autoInstrumentations,
      core,
      contextAsyncHooks,
      sdkNode,
      metricsExporter,
      sdkMetrics,
      sdkTraceBase,
      traceExporter,
      resources,
      semanticConventions,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `OpenTelemetry observability requires the optional @opentelemetry packages to be installed. ${detail}`,
    );
  }
}

type EnvReader = (name: string) => string | undefined;

export interface ResolvedOtlpExtensionConfig {
  serviceName: string;
  serviceVersion: string;
  headers: Record<string, string>;
  tracesEnabled: boolean;
  metricsEnabled: boolean;
  tracesUrl: string | undefined;
  metricsUrl: string | undefined;
  metricsExportIntervalMillis: number;
}

function readEnv(name: string): string | undefined {
  try {
    return (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env
      .get(name);
  } catch {
    return undefined;
  }
}

function parseHeaders(headerInput: string | Record<string, string> | undefined): Record<
  string,
  string
> {
  if (!headerInput) return {};
  if (typeof headerInput !== "string") return headerInput;

  // "Basic xxx" or "Authorization=Basic xxx"
  if (headerInput.startsWith("Basic ")) return { Authorization: headerInput };
  if (headerInput.startsWith("Authorization=")) {
    return { Authorization: headerInput.slice("Authorization=".length) };
  }

  const result: Record<string, string> = {};
  for (const part of headerInput.split(",")) {
    const [key, ...valueParts] = part.split("=");
    if (key && valueParts.length > 0) result[key.trim()] = valueParts.join("=").trim();
  }
  return result;
}

export function resolveOtlpSignalUrl(
  endpoint: string | undefined,
  signal: "traces" | "metrics",
): string | undefined {
  if (!endpoint) return undefined;
  const trimmed = endpoint.replace(/\/$/, "");
  const suffix = `/v1/${signal}`;
  return trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
}

export function resolveOtlpExtensionConfig(
  read: EnvReader = readEnv,
): ResolvedOtlpExtensionConfig {
  const endpoint = read("OTEL_EXPORTER_OTLP_ENDPOINT");
  const tracesEndpoint = read("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") ?? endpoint;
  const metricsEndpoint = read("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") ?? endpoint;
  const metricsExportIntervalMillis = Number.parseInt(
    read("OTEL_METRIC_EXPORT_INTERVAL") ?? "60000",
    10,
  );

  return {
    serviceName: read("OTEL_SERVICE_NAME") ?? "veryfront",
    serviceVersion: "0.1.0",
    headers: parseHeaders(read("OTEL_EXPORTER_OTLP_HEADERS")),
    tracesEnabled: read("OTEL_TRACES_ENABLED") === "true",
    metricsEnabled: read("OTEL_METRICS_ENABLED") === "true",
    tracesUrl: resolveOtlpSignalUrl(tracesEndpoint, "traces"),
    metricsUrl: resolveOtlpSignalUrl(metricsEndpoint, "metrics"),
    metricsExportIntervalMillis: Number.isFinite(metricsExportIntervalMillis)
      ? metricsExportIntervalMillis
      : 60_000,
  };
}

class OtlpTracingExporter implements TracingExporter {
  private sdkProvider: SdkTracerProvider | null = null;
  private meterProvider: SdkMeterProvider | null = null;
  private metricsApi: MetricsAPI | null = null;
  private traceApi: TraceAPI | null = null;

  async start(_ctxConfig: Record<string, unknown>): Promise<void> {
    const cfg = resolveOtlpExtensionConfig(readEnv);

    // Honor OTEL_TRACES_ENABLED: when unset/false, skip exporter wiring so
    // deployments opting out never create OTLP traffic or set globals.
    if (!cfg.tracesEnabled && !cfg.metricsEnabled) return;

    const otel = await loadOpenTelemetryRuntime();
    const resource = otel.resources.resourceFromAttributes({
      [otel.semanticConventions.ATTR_SERVICE_NAME]: cfg.serviceName,
      [otel.semanticConventions.ATTR_SERVICE_VERSION]: cfg.serviceVersion,
    });

    if (cfg.tracesEnabled) {
      if (!cfg.tracesUrl) {
        throw new Error(
          "OTEL_TRACES_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        );
      }

      const exporter = new otel.traceExporter.OTLPTraceExporter({
        url: cfg.tracesUrl,
        headers: cfg.headers,
      });

      const provider = new otel.sdkTraceBase.BasicTracerProvider({
        resource,
        spanProcessors: [new otel.sdkTraceBase.BatchSpanProcessor(exporter)],
      });

      // Wire OTel SDK globals so the real API delegates to this provider.
      // The shim also gets wired separately in bootstrap.ts via getProvider().
      otel.api.trace.setGlobalTracerProvider(provider);

      const contextManager = new otel.contextAsyncHooks.AsyncLocalStorageContextManager();
      contextManager.enable();

      const propagator = new otel.core.W3CTraceContextPropagator();

      otel.api.propagation.setGlobalPropagator(propagator);
      otel.api.context.setGlobalContextManager(contextManager);

      this.sdkProvider = provider;
      this.traceApi = {
        getActiveSpan: () => otel.api.trace.getActiveSpan(),
        getSpan: (ctx) =>
          otel.api.trace.getSpan(ctx as Parameters<typeof otel.api.trace.getSpan>[0]),
      };
    }

    if (cfg.metricsEnabled) {
      if (!cfg.metricsUrl) {
        throw new Error(
          "OTEL_METRICS_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
        );
      }

      const metricReader = new otel.sdkMetrics.PeriodicExportingMetricReader({
        exporter: new otel.metricsExporter.OTLPMetricExporter({
          url: cfg.metricsUrl,
          headers: cfg.headers,
        }),
        exportIntervalMillis: cfg.metricsExportIntervalMillis,
      });

      this.meterProvider = new otel.sdkMetrics.MeterProvider({
        resource,
        readers: [metricReader],
      });
      otel.api.metrics.setGlobalMeterProvider(this.meterProvider);
      this.metricsApi = otel.api.metrics;
    }
  }

  // eslint-disable-next-line require-await
  async export(_spans: SpanData[]): Promise<void> {
    // BatchSpanProcessor handles export automatically; this method is a no-op.
    // Callers that want to push custom SpanData batches can extend this.
  }

  async shutdown(): Promise<void> {
    if (this.meterProvider) {
      try {
        await this.meterProvider.shutdown();
      } finally {
        this.meterProvider = null;
      }
    }

    if (this.sdkProvider) {
      try {
        await this.sdkProvider.shutdown();
      } finally {
        this.sdkProvider = null;
      }
    }
  }

  getProvider(): ShimTracerProvider {
    if (this.sdkProvider) return this.sdkProvider;
    return NOOP_TRACER_PROVIDER;
  }

  getMetricsAPI(): MetricsAPI | null {
    return this.metricsApi;
  }

  getTraceAPI(): TraceAPI | null {
    return this.traceApi;
  }
}

class OpenTelemetryNodeTelemetryProvider implements NodeTelemetryProvider {
  private sdk: { shutdown(): Promise<void> } | null = null;

  async initialize(options: NodeTelemetryInitializeOptions): Promise<boolean> {
    const otel = await loadOpenTelemetryRuntime();
    const resource = otel.resources.resourceFromAttributes({
      "service.name": options.serviceName,
      "service.version": options.serviceVersion,
      "deployment.environment": options.deploymentEnvironment,
    });
    const traceExporter = new otel.traceExporter.OTLPTraceExporter({
      headers: options.exporterHeaders,
    });

    const sdk = new otel.sdkNode.NodeSDK({
      resource,
      sampler: new otel.sdkTraceBase.ParentBasedSampler({
        root: new otel.sdkTraceBase.TraceIdRatioBasedSampler(options.samplingRatio),
      }),
      spanProcessor: new otel.sdkTraceBase.BatchSpanProcessor(traceExporter, {
        maxExportBatchSize: 100,
        scheduledDelayMillis: 500,
      }),
      instrumentations: [
        otel.autoInstrumentations.getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: options.instrumentation.fs },
          "@opentelemetry/instrumentation-http": { enabled: options.instrumentation.http },
          "@opentelemetry/instrumentation-express": { enabled: options.instrumentation.express },
        }),
      ],
    });

    sdk.start();
    this.sdk = sdk;

    options.logger?.info("OpenTelemetry initialized", {
      serviceName: options.serviceName,
      samplingRatio: options.samplingRatio,
    });

    options.processTarget?.on("SIGTERM", async () => {
      await this.shutdown();
      options.logger?.info("OpenTelemetry shutdown complete");
    });

    return true;
  }

  async shutdown(): Promise<void> {
    if (!this.sdk) return;
    try {
      await this.sdk.shutdown();
    } finally {
      this.sdk = null;
    }
  }
}

/**
 * Default export for the ext-observability-opentelemetry extension factory.
 *
 * Produces an extension that registers a `TracingExporter` contract
 * implementation backed by the OpenTelemetry JS SDK.
 */
const extOpenTelemetry: ExtensionFactory = () => {
  const exporterImpl = new OtlpTracingExporter();
  const nodeTelemetryProvider = new OpenTelemetryNodeTelemetryProvider();

  return {
    name: "ext-observability-opentelemetry",
    version: "0.1.0",
    contracts: {
      provides: ["TracingExporter", "NodeTelemetryProvider"],
    },
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: [
          "OTEL_EXPORTER_OTLP_ENDPOINT",
          "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
          "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
          "OTEL_EXPORTER_OTLP_HEADERS",
          "OTEL_SERVICE_NAME",
          "OTEL_TRACES_ENABLED",
          "OTEL_METRICS_ENABLED",
          "OTEL_METRIC_EXPORT_INTERVAL",
        ],
      },
    ],
    async setup(ctx) {
      await exporterImpl.start(ctx.config);
      ctx.provide("TracingExporter", exporterImpl);
      ctx.provide("NodeTelemetryProvider", nodeTelemetryProvider);
      ctx.logger.info("[ext-observability-opentelemetry] TracingExporter registered");
    },
    async teardown() {
      await nodeTelemetryProvider.shutdown();
      await exporterImpl.shutdown();
    },
  };
};

export default extOpenTelemetry;
export { OpenTelemetryNodeTelemetryProvider, OtlpTracingExporter };
