import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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
      assertEquals(
        DEFAULT_CONFIG.collectInterval,
        60000,
        "default metrics collection interval must stay at 60s",
      );
      assertEquals(DEFAULT_CONFIG.debug, false);
    });
  });

  describe("loadConfig", () => {
    it("should return defaults for empty config", () => {
      const result = loadConfig({}, emptyEnvAdapter);
      assertEquals(result.enabled, false);
      assertEquals(result.exporter, "console");
      assertEquals(result.prefix, "veryfront");
      assertEquals(
        result.collectInterval,
        60000,
        "empty config must resolve to the 60s default interval",
      );
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

    it("treats only the literal true as an enabling value", () => {
      for (const value of ["false", "0", ""]) {
        assertEquals(
          loadConfig(
            {},
            adapterWithEnv({
              get: (key) => (key === "OTEL_METRICS_ENABLED" ? value : undefined),
            }),
          ).enabled,
          false,
          `OTEL_METRICS_ENABLED=${JSON.stringify(value)} must not enable metrics`,
        );
      }

      assertEquals(
        loadConfig(
          {},
          adapterWithEnv({
            get: (key) => (key === "OTEL_METRICS_ENABLED" ? " TRUE " : undefined),
          }),
        ).enabled,
        true,
        "OTEL_METRICS_ENABLED must be trimmed and matched case-insensitively",
      );
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

    it("rejects malformed caller configuration instead of retaining invalid values", () => {
      assertThrows(
        () => loadConfig({ enabled: "yes" } as never, emptyEnvAdapter),
        TypeError,
        "enabled",
      );
      assertThrows(
        () => loadConfig({ exporter: "invalid" } as never, emptyEnvAdapter),
        TypeError,
        "exporter",
      );
      assertThrows(
        () => loadConfig({ prefix: "   " }, emptyEnvAdapter),
        TypeError,
        "prefix",
      );
      assertThrows(
        () => loadConfig({ collectInterval: 0 }, emptyEnvAdapter),
        RangeError,
        "collectInterval",
      );
    });

    it("contains adapter environment failures without consulting another environment", () => {
      const result = loadConfig(
        { enabled: false, prefix: "configured" },
        adapterWithEnv({
          get() {
            throw new Error("environment unavailable");
          },
        }),
      );

      assertEquals(
        result.enabled,
        false,
        "an adapter env failure must leave enabled at the caller value",
      );
      assertEquals(
        result.exporter,
        "console",
        "an adapter env failure must leave the exporter at the default",
      );
      assertEquals(
        result.endpoint,
        undefined,
        "an adapter env failure must leave the endpoint unset",
      );
      assertEquals(result.prefix, "configured", "caller config is preserved");
    });
  });
});
