import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { DEFAULT_CONFIG, mergeConfig } from "./configurator.ts";

describe("configurator", () => {
  describe("DEFAULT_CONFIG", () => {
    it("should have all instrument flags enabled by default", () => {
      assertEquals(DEFAULT_CONFIG.instrumentHttp, true);
      assertEquals(DEFAULT_CONFIG.instrumentFetch, true);
      assertEquals(DEFAULT_CONFIG.instrumentReact, true);
      assertEquals(DEFAULT_CONFIG.captureErrors, true);
    });
  });

  describe("mergeConfig", () => {
    it("should return DEFAULT_CONFIG when no config provided", () => {
      const result = mergeConfig();
      assertEquals(result, DEFAULT_CONFIG);
    });

    it("should return DEFAULT_CONFIG when empty config provided", () => {
      const result = mergeConfig({});
      assertEquals(result, DEFAULT_CONFIG);
    });

    it("should override individual config properties", () => {
      const result = mergeConfig({ instrumentHttp: false });
      assertEquals(result.instrumentHttp, false);
      assertEquals(result.instrumentFetch, true);
      assertEquals(result.instrumentReact, true);
      assertEquals(result.captureErrors, true);
    });

    it("should override multiple config properties", () => {
      const result = mergeConfig({
        instrumentHttp: false,
        instrumentReact: false,
      });
      assertEquals(result.instrumentHttp, false);
      assertEquals(result.instrumentFetch, true);
      assertEquals(result.instrumentReact, false);
      assertEquals(result.captureErrors, true);
    });

    it("should override all config properties", () => {
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

    it("should not mutate the DEFAULT_CONFIG", () => {
      const originalConfig = { ...DEFAULT_CONFIG };
      mergeConfig({ instrumentHttp: false });
      assertEquals(DEFAULT_CONFIG, originalConfig);
    });
  });
});
