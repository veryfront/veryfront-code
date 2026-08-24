import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
} from "#veryfront/config/environment-config.ts";
import { loadConfig } from "./config.ts";

type RuntimeAdapter = import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;

function createAdapter(envGet: (key: string) => string | undefined): RuntimeAdapter {
  return { env: { get: envGet } } as RuntimeAdapter;
}

const emptyEnvAdapter = createAdapter(() => undefined);

describe("observability/tracing/config", () => {
  describe("loadConfig", () => {
    it("should return defaults when called with empty config", () => {
      const result = loadConfig({}, emptyEnvAdapter);
      assertEquals(result.enabled, false);
      assertEquals(result.exporter, "console");
      assertEquals(result.serviceName, "veryfront");
      assertEquals(result.sampleRate, 1.0);
      assertEquals(result.debug, false);
    });

    it("should merge user config over defaults", () => {
      const result = loadConfig({ enabled: true, serviceName: "my-service" }, emptyEnvAdapter);
      assertEquals(result.enabled, true);
      assertEquals(result.serviceName, "my-service");
      assertEquals(result.exporter, "console");
    });

    it("should apply env from adapter", () => {
      const vars: Record<string, string> = {
        OTEL_TRACES_ENABLED: "true",
        OTEL_SERVICE_NAME: "test-svc",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
        OTEL_TRACES_EXPORTER: "otlp",
      };

      const result = loadConfig({}, createAdapter((key) => vars[key]));
      assertEquals(result.enabled, true);
      assertEquals(result.serviceName, "test-svc");
      assertEquals(result.endpoint, "http://localhost:4318");
      assertEquals(result.exporter, "otlp");
    });

    it("gives the signal-specific endpoint precedence over the generic endpoint", () => {
      const vars: Record<string, string> = {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://generic:4318",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://traces:4318/v1/traces",
      };

      const result = loadConfig({}, createAdapter((key) => vars[key]));

      assertEquals(result.endpoint, "http://traces:4318/v1/traces");
    });

    it("should enable via VERYFRONT_OTEL=1", () => {
      const result = loadConfig(
        {},
        createAdapter((key) => (key === "VERYFRONT_OTEL" ? "1" : undefined)),
      );
      assertEquals(result.enabled, true);
    });

    it("should ignore invalid exporter values", () => {
      const result = loadConfig(
        {},
        createAdapter((key) => (key === "OTEL_TRACES_EXPORTER" ? "invalid" : undefined)),
      );
      assertEquals(result.exporter, "console");
    });

    it("rejects malformed caller configuration instead of enabling truthy values", () => {
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
        () => loadConfig({ sampleRate: 2 }, emptyEnvAdapter),
        RangeError,
        "sampleRate",
      );
      assertThrows(
        () => loadConfig({ serviceName: "   " }, emptyEnvAdapter),
        TypeError,
        "serviceName",
      );
    });

    it("applies the host environment when no adapter is supplied", () => {
      _setEnvironmentConfigForTesting({
        otelEnabled: true,
        otelServiceName: "host-svc",
        otelTracesEndpoint: "http://traces:4318/v1/traces",
        otelEndpoint: "http://generic:4318",
        otelTracesExporter: "otlp",
      });

      try {
        const result = loadConfig({});

        assertEquals(
          result.enabled,
          true,
          "host OTEL_TRACES_ENABLED applies when no adapter is given",
        );
        assertEquals(
          result.serviceName,
          "host-svc",
          "host OTEL_SERVICE_NAME applies when no adapter is given",
        );
        assertEquals(
          result.endpoint,
          "http://traces:4318/v1/traces",
          "tracesEndpoint must map to signalEndpoint and win over the generic endpoint",
        );
        assertEquals(
          result.exporter,
          "otlp",
          "host OTEL_TRACES_EXPORTER applies when no adapter is given",
        );
      } finally {
        _resetEnvironmentConfig();
      }
    });

    it("contains adapter environment failures without consulting another environment", () => {
      const result = loadConfig(
        { enabled: false, serviceName: "configured" },
        createAdapter(() => {
          throw new Error("environment unavailable");
        }),
      );

      assertEquals(result.enabled, false);
      assertEquals(result.serviceName, "configured");
    });
  });
});
