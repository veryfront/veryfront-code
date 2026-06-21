import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { filterSharedRuntimeProjectEnv } from "./reserved-env.ts";

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
  });

  it("returns the original project env values for non-reserved keys", () => {
    assertEquals(filterSharedRuntimeProjectEnv({ DATABASE_URL: "postgres://project-db" }), {
      DATABASE_URL: "postgres://project-db",
    });
  });
});
