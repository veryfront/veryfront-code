import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  _resetEnvironmentConfig,
  getEnvironmentConfig,
  refreshEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import {
  getHostTelemetryEnv,
  isReservedSharedRuntimeTelemetryEnvKey,
} from "./telemetry-env.ts";

describe("observability/tracing/telemetry-env", () => {
  it("reads OTel exporter settings from host env instead of project env", async () => {
    await withEnv({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://platform-collector.example/otlp",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic platform-token",
      OTEL_SERVICE_NAME: "veryfront-server",
      OTEL_TRACES_ENABLED: "true",
    }, async () => {
      runWithProjectEnv({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://tenant-collector.example/otlp",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic tenant-token",
        OTEL_SERVICE_NAME: "tenant-service",
        OTEL_TRACES_ENABLED: "false",
      }, () => {
        assertEquals(
          getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
          "https://platform-collector.example/otlp",
        );
        assertEquals(
          getHostTelemetryEnv("OTEL_EXPORTER_OTLP_HEADERS"),
          "Authorization=Basic platform-token",
        );
        assertEquals(getHostTelemetryEnv("OTEL_SERVICE_NAME"), "veryfront-server");
        assertEquals(getHostTelemetryEnv("OTEL_TRACES_ENABLED"), "true");
      });
    });
  });

  it("classifies shared-runtime telemetry routing keys as reserved", () => {
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("OTEL_EXPORTER_OTLP_ENDPOINT"), true);
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("OTEL_EXPORTER_OTLP_HEADERS"), true);
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("OTEL_SERVICE_NAME"), true);
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("OTEL_TRACES_ENABLED"), true);
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("VERYFRONT_OTEL"), true);
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("OPENAI_API_KEY"), false);
  });

  it("keeps framework OTel environment config host-owned inside project env overlays", async () => {
    await withEnv({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://platform-collector.example/otlp",
      OTEL_SERVICE_NAME: "veryfront-server",
    }, async () => {
      runWithProjectEnv({
        OTEL_TRACES_ENABLED: "false",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://tenant-collector.example/otlp",
        OTEL_SERVICE_NAME: "tenant-service",
      }, () => {
        _resetEnvironmentConfig();
        const config = refreshEnvironmentConfig();
        assertEquals(config.otelEnabled, true);
        assertEquals(config.otelEndpoint, "https://platform-collector.example/otlp");
        assertEquals(config.otelServiceName, "veryfront-server");
      });
      _resetEnvironmentConfig();
      getEnvironmentConfig();
    });
  });
});
