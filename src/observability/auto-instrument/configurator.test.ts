import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_CONFIG, mergeConfig } from "./configurator.ts";
import type { AutoInstrumentConfig } from "./types.ts";

describe("observability/auto-instrument/configurator", () => {
  describe("DEFAULT_CONFIG", () => {
    it("should enable all instrumentation by default", () => {
      assertEquals(DEFAULT_CONFIG, {
        instrumentHttp: true,
        instrumentFetch: true,
        instrumentReact: true,
        captureErrors: true,
      });
    });
  });

  describe("mergeConfig", () => {
    it("should return defaults when called with no args", () => {
      assertEquals(mergeConfig(), DEFAULT_CONFIG);
    });

    it("should return defaults when called with empty object", () => {
      assertEquals(mergeConfig({}), DEFAULT_CONFIG);
    });

    it("should override specific fields", () => {
      assertEquals(mergeConfig({ instrumentHttp: false }), {
        instrumentHttp: false,
        instrumentFetch: true,
        instrumentReact: true,
        captureErrors: true,
      });
    });

    it("should override all fields", () => {
      assertEquals(
        mergeConfig({
          instrumentHttp: false,
          instrumentFetch: false,
          instrumentReact: false,
          captureErrors: false,
        }),
        {
          instrumentHttp: false,
          instrumentFetch: false,
          instrumentReact: false,
          captureErrors: false,
        },
      );
    });

    it("rejects invalid runtime flags and snapshots nested config", () => {
      const tracing = { enabled: true, serviceName: "service" };
      const merged = mergeConfig({
        tracing,
        instrumentHttp: "false",
      } as unknown as AutoInstrumentConfig);
      tracing.serviceName = "changed";

      assertEquals(merged.instrumentHttp, true);
      assertEquals(merged.tracing?.serviceName, "service");
    });
  });
});
