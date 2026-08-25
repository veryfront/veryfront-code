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
  });

  it("returns the original project env values for non-reserved keys", () => {
    assertEquals(filterSharedRuntimeProjectEnv({ DATABASE_URL: "postgres://project-db" }), {
      DATABASE_URL: "postgres://project-db",
    });
  });

  it("strips telemetry exporter routing on a shared runtime", async () => {
    // withEnv can only set, never unset; an empty value is falsy to isDedicatedRuntime.
    await withEnv({ SERVER_ID: "", ENVIRONMENT_IDS: "" }, async () => {
      const filtered = filterRuntimeProjectEnv({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://tenant-collector.example/otlp",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic tenant-token",
        OPENAI_API_KEY: "project-openai-key",
      });

      assertEquals(
        filtered,
        { OPENAI_API_KEY: "project-openai-key" },
        "a shared runtime must not let tenant OTLP routing reach the runtime env",
      );
    });
  });

  it("still strips telemetry routing when only SERVER_ID marks the runtime", async () => {
    await withEnv({ SERVER_ID: "server-1", ENVIRONMENT_IDS: "" }, async () => {
      const filtered = filterRuntimeProjectEnv({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://tenant-collector.example/otlp",
        OPENAI_API_KEY: "project-openai-key",
      });

      assertEquals(
        filtered,
        { OPENAI_API_KEY: "project-openai-key" },
        "the dedicated check requires both SERVER_ID and ENVIRONMENT_IDS",
      );
    });
  });

  it("still strips telemetry routing when only ENVIRONMENT_IDS marks the runtime", async () => {
    await withEnv({ SERVER_ID: "", ENVIRONMENT_IDS: "env-1" }, async () => {
      const filtered = filterRuntimeProjectEnv({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://tenant-collector.example/otlp",
        OPENAI_API_KEY: "project-openai-key",
      });

      assertEquals(
        filtered,
        { OPENAI_API_KEY: "project-openai-key" },
        "the dedicated check requires both SERVER_ID and ENVIRONMENT_IDS",
      );
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
    });
  });
});
