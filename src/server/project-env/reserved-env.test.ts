import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { filterRuntimeProjectEnv, filterSharedRuntimeProjectEnv } from "./reserved-env.ts";

describe("server/project-env/reserved-env", () => {
  it("removes telemetry exporter routing env vars from shared runtime project env", () => {
    const filtered = filterSharedRuntimeProjectEnv({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://tenant-collector.example/otlp",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic tenant-token",
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://tenant-logs.example/otlp/v1/logs",
      OTEL_RESOURCE_ATTRIBUTES: "tenant.secret=do-not-export",
      OTEL_SERVICE_NAME: "tenant-service",
      OTEL_TRACES_ENABLED: "true",
      OPENAI_API_KEY: "project-openai-key",
      FEATURE_FLAG: "enabled",
    });

    assertEquals(filtered, {
      OPENAI_API_KEY: "project-openai-key",
      FEATURE_FLAG: "enabled",
    });
    assertEquals(Object.getPrototypeOf(filtered), null);
    assertEquals(Object.isFrozen(filtered), true);
  });

  it("returns the original project env values for non-reserved keys", () => {
    assertEquals(filterSharedRuntimeProjectEnv({ DATABASE_URL: "postgres://project-db" }), {
      DATABASE_URL: "postgres://project-db",
    });
  });

  it("keeps customer telemetry env vars for dedicated runtimes", async () => {
    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-1",
    }, async () => {
      const filtered = filterRuntimeProjectEnv({
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://otlp.datadoghq.eu/v1/metrics",
        OTEL_EXPORTER_OTLP_METRICS_HEADERS: "dd-api-key=project-key",
        OTEL_SERVICE_NAME: "veryfront-ops-agent",
        OPENAI_API_KEY: "project-openai-key",
      });

      assertEquals(filtered, {
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://otlp.datadoghq.eu/v1/metrics",
        OTEL_EXPORTER_OTLP_METRICS_HEADERS: "dd-api-key=project-key",
        OTEL_SERVICE_NAME: "veryfront-ops-agent",
        OPENAI_API_KEY: "project-openai-key",
      });
      assertEquals(Object.getPrototypeOf(filtered), null);
      assertEquals(Object.isFrozen(filtered), true);
    });
  });
});
