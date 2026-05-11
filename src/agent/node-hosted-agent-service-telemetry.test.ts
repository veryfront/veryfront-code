import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveNodeHostedAgentServiceTelemetryConfig } from "./node-hosted-agent-service-telemetry.ts";

describe("agent/node-hosted-agent-service-telemetry", () => {
  it("defaults to production-enabled hosted service telemetry", () => {
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
});
