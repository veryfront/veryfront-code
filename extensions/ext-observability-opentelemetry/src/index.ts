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

import { metrics, trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

/**
 * The TracerProvider interface as expected by the core shim.
 * Using structural typing because the real SDK provider satisfies this shape.
 */
interface ShimTracerProvider {
  getTracer(name: string, version?: string): unknown;
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
  private sdkProvider: BasicTracerProvider | null = null;
  private meterProvider: MeterProvider | null = null;
  private metricReader: PeriodicExportingMetricReader | null = null;

  async start(_ctxConfig: Record<string, unknown>): Promise<void> {
    const cfg = resolveOtlpExtensionConfig(readEnv);

    // Honor OTEL_TRACES_ENABLED: when unset/false, skip exporter wiring so
    // deployments opting out never create OTLP traffic or set globals.
    if (!cfg.tracesEnabled && !cfg.metricsEnabled) return;

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: cfg.serviceName,
      [ATTR_SERVICE_VERSION]: cfg.serviceVersion,
    });

    if (cfg.tracesEnabled) {
      if (!cfg.tracesUrl) {
        throw new Error(
          "OTEL_TRACES_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        );
      }

      const exporter = new OTLPTraceExporter({
        url: cfg.tracesUrl,
        headers: cfg.headers,
      });

      const provider = new BasicTracerProvider({
        resource,
        spanProcessors: [new BatchSpanProcessor(exporter)],
      });

      // Wire OTel SDK globals so the real API delegates to this provider.
      // The shim also gets wired separately in bootstrap.ts via getProvider().
      trace.setGlobalTracerProvider(provider);

      const contextManager = new AsyncLocalStorageContextManager();
      contextManager.enable();

      const propagator = new W3CTraceContextPropagator();

      // Set propagator via OTel API (import is available in this extension).
      const { propagation, context: otelContext } = await import("@opentelemetry/api");
      propagation.setGlobalPropagator(propagator);
      otelContext.setGlobalContextManager(contextManager);

      this.sdkProvider = provider;
    }

    if (cfg.metricsEnabled) {
      if (!cfg.metricsUrl) {
        throw new Error(
          "OTEL_METRICS_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
        );
      }

      this.metricReader = new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: cfg.metricsUrl,
          headers: cfg.headers,
        }),
        exportIntervalMillis: cfg.metricsExportIntervalMillis,
      });

      this.meterProvider = new MeterProvider({
        resource,
        readers: [this.metricReader],
      });
      metrics.setGlobalMeterProvider(this.meterProvider);
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
        this.metricReader = null;
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
    // Return a passthrough to OTel's real global provider if start() wasn't
    // called (e.g., test scaffolding without full setup).
    return trace.getTracerProvider();
  }

  getMetricsAPI(): { getMeter(name: string | undefined, version?: string): unknown } | null {
    // Return the OTel Metrics API so the core metrics subsystem can get meters.
    return metrics;
  }

  getTraceAPI(): { getActiveSpan(): unknown; getSpan(ctx: unknown): unknown } | null {
    if (!this.sdkProvider) return null;
    return {
      getActiveSpan: () => trace.getActiveSpan(),
      getSpan: (ctx) => trace.getSpan(ctx as Parameters<typeof trace.getSpan>[0]),
    };
  }
}

class OpenTelemetryNodeTelemetryProvider implements NodeTelemetryProvider {
  private sdk: NodeSDK | null = null;

  async initialize(options: NodeTelemetryInitializeOptions): Promise<boolean> {
    const resource = resourceFromAttributes({
      "service.name": options.serviceName,
      "service.version": options.serviceVersion,
      "deployment.environment": options.deploymentEnvironment,
    });
    const traceExporter = new OTLPTraceExporter({ headers: options.exporterHeaders });

    const sdk = new NodeSDK({
      resource,
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(options.samplingRatio),
      }),
      spanProcessor: new BatchSpanProcessor(traceExporter, {
        maxExportBatchSize: 100,
        scheduledDelayMillis: 500,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
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
