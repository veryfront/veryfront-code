import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  initializeNodeAgentServiceOpenTelemetry,
  resolveNodeAgentServiceTelemetryConfig,
  resolveNodeHostedAgentServiceTelemetryConfig,
} from "./node-telemetry.ts";

describe("agent/node-agent-service-telemetry", () => {
  it("exposes a node agent service telemetry resolver alias without the hosted prefix", () => {
    const config = resolveNodeAgentServiceTelemetryConfig({
      env: { NODE_ENV: "production" },
      defaultServiceName: "agent-service",
      defaultEnabled: false,
    });

    assertEquals(config.enabled, false);
    assertEquals(config.serviceName, "agent-service");
  });

  it("defaults to production-enabled agent service telemetry", () => {
    const config = resolveNodeHostedAgentServiceTelemetryConfig({
      env: { NODE_ENV: "production" },
      defaultServiceName: "agent-service",
    });

    assertEquals(config, {
      enabled: true,
      serviceName: "agent-service",
      serviceVersion: "0.1.0",
      deploymentEnvironment: "production",
      samplingRatio: 1,
      exporterHeaders: undefined,
      tracesEnabled: true,
      metricsEnabled: false,
      logsEnabled: false,
      tracesEndpoint: undefined,
      metricsEndpoint: undefined,
      logsEndpoint: undefined,
      tracesHeaders: undefined,
      metricsHeaders: undefined,
      logsHeaders: undefined,
      metricsExportIntervalMillis: 60000,
      metricsTemporalityPreference: "delta",
      instrumentation: {
        http: true,
        express: true,
        fs: false,
      },
    });
  });

  it("honors explicit enable flags, headers, sampling, and instrumentation overrides", () => {
    const config = resolveNodeHostedAgentServiceTelemetryConfig({
      env: {
        NODE_ENV: "test",
        npm_package_version: "1.2.3",
        OTEL_ENABLED: "true",
        OTEL_SERVICE_NAME: "custom-agent",
        OTEL_SAMPLING_RATIO: "0.5",
        OTEL_EXPORTER_OTLP_HEADERS: "x-api-key=secret,x-tenant=myorg",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/otlp",
        OTEL_EXPORTER_OTLP_LOGS_HEADERS: "x-log-route=logs",
        OTEL_METRICS_ENABLED: "true",
        OTEL_LOGS_EXPORTER: "otlp",
        OTEL_METRIC_EXPORT_INTERVAL: "15000",
        OTEL_INSTRUMENTATION_HTTP: "false",
        OTEL_INSTRUMENTATION_EXPRESS: "false",
        OTEL_INSTRUMENTATION_FS: "true",
      },
      defaultServiceName: "agent-service",
    });

    assertEquals(config, {
      enabled: true,
      serviceName: "custom-agent",
      serviceVersion: "1.2.3",
      deploymentEnvironment: "test",
      samplingRatio: 0.5,
      exporterHeaders: { "x-api-key": "secret", "x-tenant": "myorg" },
      tracesEnabled: true,
      metricsEnabled: true,
      logsEnabled: true,
      tracesEndpoint: "https://collector.example/otlp/v1/traces",
      metricsEndpoint: "https://collector.example/otlp/v1/metrics",
      logsEndpoint: "https://collector.example/otlp/v1/logs",
      tracesHeaders: { "x-api-key": "secret", "x-tenant": "myorg" },
      metricsHeaders: { "x-api-key": "secret", "x-tenant": "myorg" },
      logsHeaders: {
        "x-api-key": "secret",
        "x-tenant": "myorg",
        "x-log-route": "logs",
      },
      metricsExportIntervalMillis: 15000,
      metricsTemporalityPreference: "delta",
      instrumentation: {
        http: false,
        express: false,
        fs: true,
      },
    });
  });

  it("prefers deployment and app environment labels over NODE_ENV", () => {
    const appConfig = resolveNodeHostedAgentServiceTelemetryConfig({
      env: {
        NODE_ENV: "production",
        APP_ENVIRONMENT: "staging",
      },
      defaultServiceName: "agent-service",
    });

    assertEquals(appConfig.deploymentEnvironment, "staging");

    const explicitConfig = resolveNodeHostedAgentServiceTelemetryConfig({
      env: {
        NODE_ENV: "production",
        APP_ENVIRONMENT: "staging",
        VERYFRONT_ENVIRONMENT: "preview",
        OTEL_DEPLOYMENT_ENVIRONMENT: "canary",
      },
      defaultServiceName: "agent-service",
    });

    assertEquals(explicitConfig.deploymentEnvironment, "canary");
  });

  it("supports Basic authorization headers and clamps sampling ratio", () => {
    const config = resolveNodeHostedAgentServiceTelemetryConfig({
      env: {
        OTEL_ENABLED: "false",
        OTEL_SAMPLING_RATIO: "2",
        OTEL_EXPORTER_OTLP_HEADERS: "Basic dXNlcjpwYXNz",
      },
      defaultServiceName: "agent-service",
    });

    assertEquals(config.enabled, false);
    assertEquals(config.samplingRatio, 1);
    assertEquals(config.exporterHeaders, { Authorization: "Basic dXNlcjpwYXNz" });
  });

  it("supports signal-specific OTLP endpoint overrides and metrics temporality", () => {
    const config = resolveNodeHostedAgentServiceTelemetryConfig({
      env: {
        OTEL_ENABLED: "false",
        OTEL_TRACES_ENABLED: "false",
        OTEL_METRICS_EXPORTER: "otlp",
        OTEL_LOGS_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/base",
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://metrics.example/v1/metrics",
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://logs.example",
        OTEL_EXPORTER_OTLP_HEADERS: "dd-api-key=global",
        OTEL_EXPORTER_OTLP_METRICS_HEADERS: "dd-api-key=metrics",
        OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: "cumulative",
      },
      defaultServiceName: "agent-service",
    });

    assertEquals(config.enabled, true);
    assertEquals(config.tracesEnabled, false);
    assertEquals(config.metricsEnabled, true);
    assertEquals(config.logsEnabled, true);
    assertEquals(config.metricsEndpoint, "https://metrics.example/v1/metrics");
    assertEquals(config.logsEndpoint, "https://logs.example/v1/logs");
    assertEquals(config.metricsHeaders, { "dd-api-key": "metrics" });
    assertEquals(config.logsHeaders, { "dd-api-key": "global" });
    assertEquals(config.metricsTemporalityPreference, "cumulative");
  });

  it("delegates enabled telemetry initialization to a NodeTelemetryProvider", async () => {
    const calls: unknown[] = [];
    const result = await initializeNodeAgentServiceOpenTelemetry({
      enabled: true,
      serviceName: "agent-service",
      serviceVersion: "1.2.3",
      deploymentEnvironment: "production",
      samplingRatio: 0.5,
      exporterHeaders: { "x-api-key": "redacted" },
      tracesEnabled: true,
      metricsEnabled: true,
      logsEnabled: true,
      tracesEndpoint: "https://collector.example/v1/traces",
      metricsEndpoint: "https://collector.example/v1/metrics",
      logsEndpoint: "https://collector.example/v1/logs",
      metricsExportIntervalMillis: 10000,
      metricsTemporalityPreference: "delta",
      instrumentation: {
        http: true,
        express: false,
        fs: true,
      },
      registerLogRecordEmitter: () => {},
      telemetryProvider: {
        initialize(options) {
          calls.push(options);
          return Promise.resolve(true);
        },
      },
    });

    assertEquals(result, true);
    assertEquals(calls, [
      {
        serviceName: "agent-service",
        serviceVersion: "1.2.3",
        deploymentEnvironment: "production",
        samplingRatio: 0.5,
        exporterHeaders: { "x-api-key": "redacted" },
        tracesEnabled: true,
        metricsEnabled: true,
        logsEnabled: true,
        tracesEndpoint: "https://collector.example/v1/traces",
        metricsEndpoint: "https://collector.example/v1/metrics",
        logsEndpoint: "https://collector.example/v1/logs",
        tracesHeaders: undefined,
        metricsHeaders: undefined,
        logsHeaders: undefined,
        metricsExportIntervalMillis: 10000,
        metricsTemporalityPreference: "delta",
        instrumentation: {
          http: true,
          express: false,
          fs: true,
        },
        logger: undefined,
        processTarget: undefined,
        registerLogRecordEmitter: calls[0] &&
          (calls[0] as { registerLogRecordEmitter?: unknown }).registerLogRecordEmitter,
      },
    ]);
  });
});
