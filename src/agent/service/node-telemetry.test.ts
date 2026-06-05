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

  it("delegates enabled telemetry initialization to a NodeTelemetryProvider", async () => {
    const calls: unknown[] = [];
    const result = await initializeNodeAgentServiceOpenTelemetry({
      enabled: true,
      serviceName: "agent-service",
      serviceVersion: "1.2.3",
      deploymentEnvironment: "production",
      samplingRatio: 0.5,
      exporterHeaders: { "x-api-key": "redacted" },
      instrumentation: {
        http: true,
        express: false,
        fs: true,
      },
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
        instrumentation: {
          http: true,
          express: false,
          fs: true,
        },
        logger: undefined,
        processTarget: undefined,
      },
    ]);
  });
});
