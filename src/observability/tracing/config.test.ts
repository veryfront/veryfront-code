import "#veryfront/schemas/_test-setup.ts";
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

    it("normalizes non-object runtime config", () => {
      const result = loadConfig(null as never, emptyEnvAdapter);
      assertEquals(result.enabled, false);
      assertEquals(result.serviceName, "veryfront");
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

    it("prefers the trace-specific OTLP endpoint", () => {
      const vars: Record<string, string> = {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://general.invalid:4318",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://traces.invalid:4318/v1/traces",
      };

      const result = loadConfig({}, createAdapter((key) => vars[key]));

      assertEquals(result.endpoint, "http://traces.invalid:4318/v1/traces");
    });

    it("normalizes invalid runtime configuration to safe defaults", () => {
      const result = loadConfig(
        {
          enabled: "yes" as unknown as boolean,
          exporter: "custom" as unknown as "console",
          serviceName: "\n",
          sampleRate: Number.NaN,
          debug: "yes" as unknown as boolean,
        },
        emptyEnvAdapter,
      );

      assertEquals(result.enabled, false);
      assertEquals(result.exporter, "console");
      assertEquals(result.serviceName, "veryfront");
      assertEquals(result.sampleRate, 1);
      assertEquals(result.debug, false);
    });

    it("does not let a failing environment adapter break tracing setup", () => {
      const result = loadConfig(
        { enabled: true, serviceName: "application" },
        createAdapter(() => {
          throw new Error("adapter unavailable");
        }),
      );

      assertEquals(result.enabled, true);
      assertEquals(result.serviceName, "application");
    });
  });
});
