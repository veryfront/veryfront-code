/**
 * ext-observability-opentelemetry extension tests.
 *
 * @module extensions/ext-observability-opentelemetry/test
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import { VERSION } from "veryfront/utils";
import factory, {
  logAttributes,
  resolveOtlpExtensionConfig,
  resolveOtlpSignalUrl,
  unifiedServiceResourceAttributes,
} from "./index.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function env(vars: Record<string, string>): (name: string) => string | undefined {
  return (name) => vars[name];
}

async function withOtelSignalsDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const keys = [
    "OTEL_TRACES_ENABLED",
    "OTEL_METRICS_ENABLED",
    "OTEL_LOGS_ENABLED",
    "OTEL_TRACES_EXPORTER",
    "OTEL_METRICS_EXPORTER",
    "OTEL_LOGS_EXPORTER",
    "DD_LLMOBS_ENABLED",
    "OTEL_LLMOBS_ENABLED",
  ];

  let previous: Map<string, string | undefined>;
  try {
    previous = new Map(keys.map((key) => [key, Deno.env.get(key)]));
  } catch {
    return await fn();
  }

  try {
    for (const key of keys) {
      Deno.env.delete(key);
    }
    Deno.env.set("OTEL_TRACES_EXPORTER", "none");
    Deno.env.set("OTEL_METRICS_EXPORTER", "none");
    Deno.env.set("OTEL_LOGS_EXPORTER", "none");
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

describe("ext-observability-opentelemetry factory", () => {
  it("produces an Extension with name ext-observability-opentelemetry", () => {
    const ext = factory();
    assertEquals(ext.name, "ext-observability-opentelemetry");
    assertEquals(ext.version, "0.1.0");
    assertEquals(Array.isArray(ext.capabilities), true);
    assertEquals(ext.contracts?.provides, [
      "TracingExporter",
      "NodeTelemetryProvider",
    ]);
  });
});

describe("ext-observability-opentelemetry config helpers", () => {
  it("resolves trace and metric signal URLs from a base OTLP endpoint", () => {
    assertEquals(
      resolveOtlpSignalUrl("https://collector.example/otlp", "traces"),
      "https://collector.example/otlp/v1/traces",
    );
    assertEquals(
      resolveOtlpSignalUrl("https://collector.example/otlp", "metrics"),
      "https://collector.example/otlp/v1/metrics",
    );
  });

  it("preserves explicit OTLP signal URLs", () => {
    assertEquals(
      resolveOtlpSignalUrl("https://collector.example/v1/traces", "traces"),
      "https://collector.example/v1/traces",
    );
    assertEquals(
      resolveOtlpSignalUrl("https://collector.example/v1/metrics", "metrics"),
      "https://collector.example/v1/metrics",
    );
  });

  it("resolves metrics without requiring trace export", () => {
    const config = resolveOtlpExtensionConfig(env({
      OTEL_TRACES_ENABLED: "false",
      OTEL_METRICS_ENABLED: "true",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/otlp",
      OTEL_EXPORTER_OTLP_LOGS_HEADERS: "x-log-route=logs",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic platform-token",
      OTEL_SERVICE_NAME: "veryfront-server",
    }));

    assertEquals(config.tracesEnabled, false);
    assertEquals(config.llmObservabilityEnabled, false);
    assertEquals(config.metricsEnabled, true);
    assertEquals(config.logsEnabled, true);
    assertEquals(config.tracesUrl, "https://collector.example/otlp/v1/traces");
    assertEquals(config.llmObservabilityUrl, "https://collector.example/otlp/v1/traces");
    assertEquals(config.metricsUrl, "https://collector.example/otlp/v1/metrics");
    assertEquals(config.logsUrl, "https://collector.example/otlp/v1/logs");
    assertEquals(config.headers, { Authorization: "Basic platform-token" });
    assertEquals(config.logsHeaders, {
      Authorization: "Basic platform-token",
      "x-log-route": "logs",
    });
    assertEquals(config.serviceName, "veryfront-server");
    assertEquals(config.serviceVersion, VERSION);
    assertEquals(config.deploymentEnvironment, "development");
  });

  it("resolves Datadog LLM Observability OTLP routing", () => {
    const config = resolveOtlpExtensionConfig(env({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otlp.datadoghq.eu/v1/traces",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "dd-api-key=redacted",
      DD_LLMOBS_ENABLED: "true",
      DD_LLMOBS_ML_APP: "veryfront-ops-agent",
    }));

    assertEquals(config.llmObservabilityEnabled, true);
    assertEquals(config.llmObservabilityUrl, "https://otlp.datadoghq.eu/v1/traces");
    assertEquals(config.llmObservabilityHeaders, {
      "dd-api-key": "redacted",
      "dd-otlp-source": "llmobs",
      "dd-ml-app": "veryfront-ops-agent",
    });
  });

  it("resolves Datadog unified service tags from OTel resource attributes", () => {
    const config = resolveOtlpExtensionConfig(env({
      OTEL_RESOURCE_ATTRIBUTES:
        "service.name=resource-service,service.version=7.8.9,deployment.environment=production",
      OTEL_TRACES_ENABLED: "true",
    }));

    assertEquals(config.serviceName, "resource-service");
    assertEquals(config.serviceVersion, "7.8.9");
    assertEquals(config.deploymentEnvironment, "production");
  });

  it("emits Datadog reserved tag aliases with OTel resource attributes", () => {
    assertEquals(
      unifiedServiceResourceAttributes({
        serviceName: "veryfront-ops-agent",
        serviceVersion: "20260709144949-fe7bf026a69d",
        deploymentEnvironment: "production",
      }),
      {
        "service.name": "veryfront-ops-agent",
        "service.version": "20260709144949-fe7bf026a69d",
        "deployment.environment": "production",
        "deployment.environment.name": "production",
        service: "veryfront-ops-agent",
        version: "20260709144949-fe7bf026a69d",
        env: "production",
      },
    );
  });

  it("does not expose a ctx.config.otel exporter-routing override", () => {
    const config = resolveOtlpExtensionConfig(env({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://platform-collector.example/otlp",
      OTEL_SERVICE_NAME: "veryfront-server",
    }));

    assertEquals(config.serviceName, "veryfront-server");
    assertEquals(config.tracesUrl, "https://platform-collector.example/otlp/v1/traces");
  });
});

describe("ext-observability-opentelemetry log attributes", () => {
  it("adds semantic run, tool, and trace correlation attributes", () => {
    const attributes = logAttributes({
      message: "Tool finished",
      trace_id: "0000000000000000000000000000002a",
      span_id: "0000000000000010",
      context: {
        runId: "run_123",
        agentId: "triage-sweeper",
        scheduleId: "sched_123",
        toolName: "query_loki",
        toolCallId: "call_123",
      },
    });

    assertEquals(attributes["run.id"], "run_123");
    assertEquals(attributes["agent.id"], "triage-sweeper");
    assertEquals(attributes["schedule.id"], "sched_123");
    assertEquals(attributes["tool.name"], "query_loki");
    assertEquals(attributes["tool.call.id"], "call_123");
    assertEquals(attributes["otel.trace_id"], "0000000000000000000000000000002a");
    assertEquals(attributes["dd.trace_id"], "42");
    assertEquals(attributes["dd.span_id"], "16");
  });
});

describe("ext-observability-opentelemetry TracingExporter", () => {
  it("registers TracingExporter on setup", async () => {
    await withOtelSignalsDisabled(async () => {
      const provided = new Map<string, unknown>();

      const ctx = {
        config: {},
        logger: noopLogger,
        provide: (name: string, impl: unknown) => provided.set(name, impl),
        get: () => undefined,
        require: () => {
          throw new Error("not used");
        },
      };

      const ext = factory();
      // deno-lint-ignore no-explicit-any
      await ext.setup?.(ctx as any);

      assertEquals(provided.has("TracingExporter"), true);
      assertEquals(provided.has("NodeTelemetryProvider"), true);

      const exporter = provided.get("TracingExporter") as {
        getProvider: () => unknown;
        shutdown: () => Promise<void>;
        export: (spans: unknown[]) => Promise<void>;
        start: (cfg: unknown) => Promise<void>;
      };

      assertExists(exporter);
      assertEquals(typeof exporter.getProvider, "function");
      assertEquals(typeof exporter.shutdown, "function");
      assertEquals(typeof exporter.export, "function");

      const nodeTelemetryProvider = provided.get("NodeTelemetryProvider") as {
        initialize: (options: unknown) => Promise<boolean>;
      };
      assertExists(nodeTelemetryProvider);
      assertEquals(typeof nodeTelemetryProvider.initialize, "function");

      // getProvider() must return a non-null TracerProvider
      const provider = exporter.getProvider();
      assertExists(provider);
      assertEquals(typeof (provider as { getTracer?: unknown }).getTracer, "function");

      await ext.teardown?.();
    });
  });

  it("export() is a no-op (BatchSpanProcessor handles export)", async () => {
    await withOtelSignalsDisabled(async () => {
      const provided = new Map<string, unknown>();
      const ctx = {
        config: {},
        logger: noopLogger,
        provide: (name: string, impl: unknown) => provided.set(name, impl),
        get: () => undefined,
        require: () => {
          throw new Error("not used");
        },
      };

      const ext = factory();
      // deno-lint-ignore no-explicit-any
      await ext.setup?.(ctx as any);

      const exporter = provided.get("TracingExporter") as {
        export: (spans: unknown[]) => Promise<void>;
        shutdown: () => Promise<void>;
      };

      // Should not throw
      await exporter.export([]);
      await exporter.shutdown();
    });
  });

  it("teardown() shuts down without error when called without setup", async () => {
    const ext = factory();
    // Should not throw
    await ext.teardown?.();
  });
});
