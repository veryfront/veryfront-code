import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { DEFAULT_CONFIG, loadConfig, getMemoryUsage } from "./config.ts";

describe("metrics/config", () => {
  describe("DEFAULT_CONFIG", () => {
    it("should have default values", () => {
      assertEquals(DEFAULT_CONFIG.enabled, false);
      assertEquals(DEFAULT_CONFIG.exporter, "console");
      assertEquals(DEFAULT_CONFIG.prefix, "veryfront");
      assertExists(DEFAULT_CONFIG.collectInterval);
      assertEquals(DEFAULT_CONFIG.debug, false);
    });
  });

  describe("loadConfig", () => {
    it("should return default config when no config provided", () => {
      const result = loadConfig({});
      assertEquals(result.enabled, false);
      assertEquals(result.exporter, "console");
      assertEquals(result.prefix, "veryfront");
    });

    it("should merge custom config with defaults", () => {
      const result = loadConfig({ enabled: true });
      assertEquals(result.enabled, true);
      assertEquals(result.exporter, "console");
      assertEquals(result.prefix, "veryfront");
    });

    it("should override exporter from config", () => {
      const result = loadConfig({ exporter: "otlp" });
      assertEquals(result.exporter, "otlp");
    });

    it("should override prefix from config", () => {
      const result = loadConfig({ prefix: "custom" });
      assertEquals(result.prefix, "custom");
    });

    it("should override collect interval from config", () => {
      const result = loadConfig({ collectInterval: 30000 });
      assertEquals(result.collectInterval, 30000);
    });

    it("should override debug from config", () => {
      const result = loadConfig({ debug: true });
      assertEquals(result.debug, true);
    });

    it("should handle adapter with env", () => {
      const mockAdapter = {
        env: {
          get: (key: string) => {
            if (key === "OTEL_METRICS_ENABLED") return "true";
            if (key === "OTEL_METRICS_EXPORTER") return "prometheus";
            return undefined;
          },
        },
      };

      const result = loadConfig({}, mockAdapter as any);
      assertEquals(result.enabled, true);
      assertEquals(result.exporter, "prometheus");
    });

    it("should handle VERYFRONT_OTEL env variable", () => {
      const mockAdapter = {
        env: {
          get: (key: string) => {
            if (key === "VERYFRONT_OTEL") return "1";
            return undefined;
          },
        },
      };

      const result = loadConfig({}, mockAdapter as any);
      assertEquals(result.enabled, true);
    });

    it("should handle OTLP endpoint from env", () => {
      const mockAdapter = {
        env: {
          get: (key: string) => {
            if (key === "OTEL_EXPORTER_OTLP_ENDPOINT") return "http://localhost:4318";
            return undefined;
          },
        },
      };

      const result = loadConfig({}, mockAdapter as any);
      assertEquals(result.endpoint, "http://localhost:4318");
    });

    it("should prefer metrics-specific endpoint", () => {
      const mockAdapter = {
        env: {
          get: (key: string) => {
            if (key === "OTEL_EXPORTER_OTLP_ENDPOINT") return "http://localhost:4318";
            if (key === "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") return "http://localhost:4319";
            return undefined;
          },
        },
      };

      const result = loadConfig({}, mockAdapter as any);
      assertEquals(result.endpoint, "http://localhost:4318");
    });

    it("should handle exporter types from env", () => {
      const exporters = ["prometheus", "otlp", "console"] as const;

      for (const exporter of exporters) {
        const mockAdapter = {
          env: {
            get: (key: string) => {
              if (key === "OTEL_METRICS_EXPORTER") return exporter;
              return undefined;
            },
          },
        };

        const result = loadConfig({}, mockAdapter as any);
        assertEquals(result.exporter, exporter);
      }
    });

    it("should ignore invalid exporter types", () => {
      const mockAdapter = {
        env: {
          get: (key: string) => {
            if (key === "OTEL_METRICS_EXPORTER") return "invalid";
            return undefined;
          },
        },
      };

      const result = loadConfig({}, mockAdapter as any);
      assertEquals(result.exporter, "console");
    });

    it("should handle adapter without env", () => {
      const mockAdapter = {};
      const result = loadConfig({ enabled: true }, mockAdapter as any);
      assertEquals(result.enabled, true);
    });
  });

  describe("getMemoryUsage", () => {
    it("should return memory usage or null", () => {
      const result = getMemoryUsage();
      // Should either be an object with memory info or null
      if (result !== null) {
        assertExists(result.rss);
        assertExists(result.heapUsed);
        assertExists(result.heapTotal);
        assertEquals(typeof result.rss, "number");
        assertEquals(typeof result.heapUsed, "number");
        assertEquals(typeof result.heapTotal, "number");
      }
    });
  });
});
