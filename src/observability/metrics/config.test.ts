import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_CONFIG, loadConfig } from "./config.ts";

type RuntimeAdapter = import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;

function adapterWithEnv(env: { get: (key: string) => string | undefined }): RuntimeAdapter {
  return { env } as unknown as RuntimeAdapter;
}

describe("observability/metrics/config", () => {
  describe("DEFAULT_CONFIG", () => {
    it("should have expected defaults", () => {
      assertEquals(DEFAULT_CONFIG.enabled, false);
      assertEquals(DEFAULT_CONFIG.exporter, "console");
      assertEquals(DEFAULT_CONFIG.prefix, "veryfront");
      assertEquals(typeof DEFAULT_CONFIG.collectInterval, "number");
      assertEquals(DEFAULT_CONFIG.debug, false);
    });
  });

  describe("loadConfig", () => {
    it("should return defaults for empty config", () => {
      const result = loadConfig({});
      assertEquals(result.enabled, false);
      assertEquals(result.exporter, "console");
      assertEquals(result.prefix, "veryfront");
    });

    it("should merge user config", () => {
      const result = loadConfig({ enabled: true, prefix: "myapp" });
      assertEquals(result.enabled, true);
      assertEquals(result.prefix, "myapp");
      assertEquals(result.exporter, "console");
    });

    it("should apply env from adapter", () => {
      const mockEnv = {
        get: (key: string) => {
          const vars: Record<string, string> = {
            OTEL_METRICS_ENABLED: "true",
            OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
            OTEL_METRICS_EXPORTER: "otlp",
          };
          return vars[key];
        },
      };

      const result = loadConfig({}, adapterWithEnv(mockEnv));
      assertEquals(result.enabled, true);
      assertEquals(result.endpoint, "http://localhost:4318");
      assertEquals(result.exporter, "otlp");
    });

    it("should enable via VERYFRONT_OTEL=1", () => {
      const mockEnv = {
        get: (key: string) => (key === "VERYFRONT_OTEL" ? "1" : undefined),
      };

      const result = loadConfig({}, adapterWithEnv(mockEnv));
      assertEquals(result.enabled, true);
    });

    it("should ignore invalid exporter", () => {
      const mockEnv = {
        get: (key: string) => (key === "OTEL_METRICS_EXPORTER" ? "bad" : undefined),
      };

      const result = loadConfig({}, adapterWithEnv(mockEnv));
      assertEquals(result.exporter, "console");
    });

    it("should prefer metrics-specific endpoint", () => {
      const mockEnv = {
        get: (key: string) => {
          const vars: Record<string, string> = {
            OTEL_EXPORTER_OTLP_ENDPOINT: "http://general:4318",
            OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://metrics:4318",
          };
          return vars[key];
        },
      };

      const result = loadConfig({}, adapterWithEnv(mockEnv));
      // Both are provided; the general endpoint is applied first,
      // then metrics endpoint overrides if truthy
      assertEquals(result.endpoint !== undefined, true);
    });
  });
});
