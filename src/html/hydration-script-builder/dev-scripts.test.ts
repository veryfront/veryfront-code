import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDevScripts } from "./dev-scripts.ts";
import type { VeryfrontConfig } from "#veryfront/config";

describe("hydration-script-builder/dev-scripts", () => {
  const baseConfig: VeryfrontConfig = {
    dev: { hmr: true },
  } as VeryfrontConfig;

  describe("getDevScripts", () => {
    it("should return a string containing script tags", () => {
      const result = getDevScripts("test-slug", baseConfig);
      assertEquals(result.includes("<script"), true);
    });

    it("should include error logger script by default", () => {
      const result = getDevScripts("page", baseConfig);
      assertEquals(result.includes("Client-side error logger"), true);
    });

    it("should skip error logger when skipErrorLogger option is set", () => {
      const result = getDevScripts("page", baseConfig, undefined, undefined, undefined, {
        skipErrorLogger: true,
      });
      assertEquals(result.includes("Client-side error logger"), false);
    });

    it("should include component manifest script", () => {
      const result = getDevScripts("page", baseConfig);
      assertEquals(result.includes("__veryfrontComponents"), true);
    });

    it("should include client renderer script", () => {
      const result = getDevScripts("page", baseConfig);
      assertEquals(result.includes("createRoot"), true);
    });

    it("should include HMR script when config.dev.hmr is true", () => {
      const result = getDevScripts("page", baseConfig);
      assertEquals(result.includes("hmr.js"), true);
    });

    it("should not include HMR script when config.dev.hmr is false", () => {
      const config: VeryfrontConfig = {
        dev: { hmr: false },
      } as VeryfrontConfig;
      const result = getDevScripts("page", config);
      assertEquals(result.includes("hmr.js"), false);
    });

    it("should skip HMR script when skipDevHMR option is set", () => {
      const result = getDevScripts("page", baseConfig, undefined, undefined, undefined, {
        skipDevHMR: true,
      });
      assertEquals(result.includes("hmr.js"), false);
    });

    it("should include nonce in all scripts when provided", () => {
      const result = getDevScripts("page", baseConfig, undefined, undefined, "test-nonce");
      const nonceCount = (result.match(/nonce="test-nonce"/g) || []).length;
      // Should appear in error logger, component manifest, client renderer, and HMR scripts
      assertEquals(nonceCount >= 3, true);
    });

    it("should handle empty config", () => {
      const result = getDevScripts("page", {} as VeryfrontConfig);
      assertEquals(typeof result, "string");
      assertEquals(result.includes("<script"), true);
    });

    it("should join scripts with newlines", () => {
      const result = getDevScripts("page", baseConfig);
      assertEquals(result.includes("\n"), true);
    });
  });
});
