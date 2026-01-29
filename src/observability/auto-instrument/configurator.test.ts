import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DEFAULT_CONFIG, mergeConfig } from "./configurator.ts";

describe("observability/auto-instrument/configurator", () => {
  describe("DEFAULT_CONFIG", () => {
    it("should enable all instrumentation by default", () => {
      assertEquals(DEFAULT_CONFIG.instrumentHttp, true);
      assertEquals(DEFAULT_CONFIG.instrumentFetch, true);
      assertEquals(DEFAULT_CONFIG.instrumentReact, true);
      assertEquals(DEFAULT_CONFIG.captureErrors, true);
    });
  });

  describe("mergeConfig", () => {
    it("should return defaults when called with no args", () => {
      const result = mergeConfig();
      assertEquals(result, DEFAULT_CONFIG);
    });

    it("should return defaults when called with empty object", () => {
      const result = mergeConfig({});
      assertEquals(result, DEFAULT_CONFIG);
    });

    it("should override specific fields", () => {
      const result = mergeConfig({ instrumentHttp: false });
      assertEquals(result.instrumentHttp, false);
      assertEquals(result.instrumentFetch, true);
      assertEquals(result.instrumentReact, true);
      assertEquals(result.captureErrors, true);
    });

    it("should override all fields", () => {
      const result = mergeConfig({
        instrumentHttp: false,
        instrumentFetch: false,
        instrumentReact: false,
        captureErrors: false,
      });
      assertEquals(result.instrumentHttp, false);
      assertEquals(result.instrumentFetch, false);
      assertEquals(result.instrumentReact, false);
      assertEquals(result.captureErrors, false);
    });
  });
});
