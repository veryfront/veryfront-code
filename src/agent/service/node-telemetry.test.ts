import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  initializeNodeAgentServiceOpenTelemetry,
  resolveNodeAgentServiceTelemetryConfig,
  resolveNodeHostedAgentServiceTelemetryConfig,
} from "./node-telemetry.ts";
import { VERSION } from "#veryfront/utils/version.ts";

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
      serviceVersion: VERSION,
      deploymentEnvironment: "production",
      samplingRatio: 1,
      exporterHeaders: undefined,
      tracesEnabled: true,
      llmObservabilityEnabled: false,
      metricsEnabled: false,
      logsEnabled: false,
      tracesEndpoint: undefined,
      llmObservabilityEndpoint: undefined,
      metricsEndpoint: undefined,
      logsEndpoint: undefined,
      tracesHeaders: undefined,
      llmObservabilityHeaders: undefined,
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

  it("uses OpenTelemetry resource attributes for Datadog service tags", () => {
    const config = resolveNodeHostedAgentServiceTelemetryConfig({
      env: {
        NODE_ENV: "test",
        OTEL_RESOURCE_ATTRIBUTES:
          "service.name=resource-agent,service.version=9.9.9,deployment.environment.name=staging-eu",
      },
      defaultServiceName: "agent-service",
    });

    assertEquals(config.serviceName, "resource-agent");
    assertEquals(config.serviceVersion, "9.9.9");
    assertEquals(config.deploymentEnvironment, "staging-eu");
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
      llmObservabilityEnabled: false,
      metricsEnabled: true,
      logsEnabled: true,
      tracesEndpoint: "https://collector.example/otlp/v1/traces",
      llmObservabilityEndpoint: "https://collector.example/otlp/v1/traces",
      metricsEndpoint: "https://collector.example/otlp/v1/metrics",
      logsEndpoint: "https://collector.example/otlp/v1/logs",
      tracesHeaders: { "x-api-key": "secret", "x-tenant": "myorg" },
      llmObservabilityHeaders: undefined,
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
    assertEquals(config.llmObservabilityEnabled, false);
    assertEquals(config.metricsEnabled, true);
    assertEquals(config.logsEnabled, true);
    assertEquals(config.metricsEndpoint, "https://metrics.example/v1/metrics");
    assertEquals(config.logsEndpoint, "https://logs.example/v1/logs");
    assertEquals(config.llmObservabilityEndpoint, "https://collector.example/base/v1/traces");
    assertEquals(config.llmObservabilityHeaders, {
      "dd-api-key": "global",
      "dd-otlp-source": "llmobs",
    });
    assertEquals(config.metricsHeaders, { "dd-api-key": "metrics" });
    assertEquals(config.logsHeaders, { "dd-api-key": "global" });
    assertEquals(config.metricsTemporalityPreference, "cumulative");
  });

  it("builds Datadog LLM Observability OTLP headers from customer OTEL config", () => {
    const config = resolveNodeHostedAgentServiceTelemetryConfig({
      env: {
        OTEL_TRACES_ENABLED: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otlp.datadoghq.eu/v1/traces",
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: "dd-api-key=redacted",
        DD_LLMOBS_ENABLED: "true",
        DD_LLMOBS_ML_APP: "veryfront-ops-agent",
      },
      defaultServiceName: "veryfront-ops-agent",
    });

    assertEquals(config.llmObservabilityEnabled, true);
    assertEquals(config.llmObservabilityEndpoint, "https://otlp.datadoghq.eu/v1/traces");
    assertEquals(config.llmObservabilityHeaders, {
      "dd-api-key": "redacted",
      "dd-otlp-source": "llmobs",
      "dd-ml-app": "veryfront-ops-agent",
    });
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
      llmObservabilityEnabled: true,
      metricsEnabled: true,
      logsEnabled: true,
      tracesEndpoint: "https://collector.example/v1/traces",
      llmObservabilityEndpoint: "https://collector.example/v1/traces",
      metricsEndpoint: "https://collector.example/v1/metrics",
      logsEndpoint: "https://collector.example/v1/logs",
      llmObservabilityHeaders: {
        "dd-api-key": "redacted",
        "dd-otlp-source": "llmobs",
      },
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
        llmObservabilityEnabled: true,
        metricsEnabled: true,
        logsEnabled: true,
        tracesEndpoint: "https://collector.example/v1/traces",
        llmObservabilityEndpoint: "https://collector.example/v1/traces",
        metricsEndpoint: "https://collector.example/v1/metrics",
        logsEndpoint: "https://collector.example/v1/logs",
        tracesHeaders: undefined,
        llmObservabilityHeaders: {
          "dd-api-key": "redacted",
          "dd-otlp-source": "llmobs",
        },
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
