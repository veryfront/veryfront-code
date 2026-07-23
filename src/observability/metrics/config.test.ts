import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_CONFIG, loadConfig } from "./config.ts";

type RuntimeAdapter = import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;

function adapterWithEnv(env: { get: (key: string) => string | undefined }): RuntimeAdapter {
  return { env } as unknown as RuntimeAdapter;
}

const emptyEnvAdapter = adapterWithEnv({ get: () => undefined });

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
      const result = loadConfig({}, emptyEnvAdapter);
      assertEquals(result.enabled, false);
      assertEquals(result.exporter, "console");
      assertEquals(result.prefix, "veryfront");
    });

    it("normalizes missing and non-object runtime config", () => {
      assertEquals(loadConfig(undefined, emptyEnvAdapter), DEFAULT_CONFIG);
      assertEquals(loadConfig(null as never, emptyEnvAdapter), DEFAULT_CONFIG);
    });

    it("should merge user config", () => {
      const result = loadConfig({ enabled: true, prefix: "myapp" }, emptyEnvAdapter);
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
      assertEquals(result.endpoint, "http://metrics:4318");
    });

    it("normalizes invalid runtime configuration to safe defaults", () => {
      const result = loadConfig(
        {
          enabled: "yes" as unknown as boolean,
          exporter: "custom" as unknown as "console",
          prefix: "invalid prefix",
          collectInterval: Number.POSITIVE_INFINITY,
          debug: "yes" as unknown as boolean,
        },
        emptyEnvAdapter,
      );

      assertEquals(result.enabled, false);
      assertEquals(result.exporter, "console");
      assertEquals(result.prefix, "veryfront");
      assertEquals(result.collectInterval, DEFAULT_CONFIG.collectInterval);
      assertEquals(result.debug, false);
    });

    it("bounds the collection interval", () => {
      const result = loadConfig({ collectInterval: 86_400_001 }, emptyEnvAdapter);
      assertEquals(result.collectInterval, DEFAULT_CONFIG.collectInterval);
    });

    it("does not let a failing environment adapter break metrics setup", () => {
      const result = loadConfig(
        { enabled: true, prefix: "application" },
        adapterWithEnv({
          get: () => {
            throw new Error("adapter unavailable");
          },
        }),
      );

      assertEquals(result.enabled, true);
      assertEquals(result.prefix, "application");
    });
  });
});
