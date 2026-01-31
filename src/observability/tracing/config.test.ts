import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
  });
});
