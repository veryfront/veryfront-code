import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_CONFIG, mergeConfig } from "./configurator.ts";

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

    it("rejects malformed flags and nested configuration", () => {
      assertThrows(
        () => mergeConfig({ instrumentHttp: "yes" } as never),
        TypeError,
        "instrumentHttp",
      );
      assertThrows(
        () => mergeConfig({ tracing: { enabled: "yes" } } as never),
        TypeError,
        "tracing enabled",
      );
      assertThrows(
        () => mergeConfig({ metrics: null } as never),
        TypeError,
        "metrics config",
      );
    });

    it("returns detached nested configuration snapshots", () => {
      const tracing = { enabled: true, exporter: "console" as const };
      const merged = mergeConfig({ tracing });

      tracing.enabled = false;

      assertEquals(merged.tracing?.enabled, true);
    });
  });
});
