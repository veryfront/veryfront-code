/**
 * ext-observability-opentelemetry extension tests.
 *
 * @module extensions/ext-observability-opentelemetry/test
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import factory, { resolveOtlpExtensionConfig, resolveOtlpSignalUrl } from "./index.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function env(vars: Record<string, string>): (name: string) => string | undefined {
  return (name) => vars[name];
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
    assertEquals(config.metricsEnabled, true);
    assertEquals(config.logsEnabled, true);
    assertEquals(config.tracesUrl, "https://collector.example/otlp/v1/traces");
    assertEquals(config.metricsUrl, "https://collector.example/otlp/v1/metrics");
    assertEquals(config.logsUrl, "https://collector.example/otlp/v1/logs");
    assertEquals(config.headers, { Authorization: "Basic platform-token" });
    assertEquals(config.logsHeaders, {
      Authorization: "Basic platform-token",
      "x-log-route": "logs",
    });
    assertEquals(config.serviceName, "veryfront-server");
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

describe("ext-observability-opentelemetry TracingExporter", () => {
  it("registers TracingExporter on setup", async () => {
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

  it("export() is a no-op (BatchSpanProcessor handles export)", async () => {
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

  it("teardown() shuts down without error when called without setup", async () => {
    const ext = factory();
    // Should not throw
    await ext.teardown?.();
  });
});
