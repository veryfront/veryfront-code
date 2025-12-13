import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { getDevScripts } from "./dev-scripts.ts";
import type { VeryfrontConfig } from "@veryfront/config";

describe("dev-scripts", () => {
  describe("getDevScripts", () => {
    const config: VeryfrontConfig = {
      dev: {
        components: ["Button", "Card"],
      },
    } as VeryfrontConfig;

    it("should return combined dev scripts", () => {
      const scripts = getDevScripts("test-slug", config);

      assert(scripts.length > 0);
      assert(scripts.includes("<script"));
    });

    it("should include error logger script", () => {
      const scripts = getDevScripts("test-slug", config);

      assert(scripts.includes("Client-side error logger"));
      assert(scripts.includes("/_veryfront/log"));
    });

    it("should include dev indicator script", () => {
      const scripts = getDevScripts("test-slug", config);

      assert(scripts.includes("Development Mode"));
      assert(scripts.includes("dev-indicator"));
    });

    it("should include component manifest script", () => {
      const scripts = getDevScripts("test-slug", config);

      assert(scripts.includes("window.__veryfrontComponents"));
    });

    it("should include client renderer script", () => {
      const scripts = getDevScripts("test-slug", config);

      assert(scripts.includes("import * as React from 'react'"));
      assert(scripts.includes("createRoot"));
    });

    it("should join scripts with newlines", () => {
      const scripts = getDevScripts("test-slug", config);

      const scriptTags = scripts.match(/<script/g);
      assert(scriptTags !== null);
      assert(scriptTags.length >= 4, "Should have at least 4 script blocks");
    });

    it("should pass nonce to all scripts", () => {
      const nonce = "test-nonce-all";
      const scripts = getDevScripts("test-slug", config, undefined, undefined, nonce);

      const nonceMatches = scripts.match(new RegExp(`nonce="${nonce}"`, 'g'));
      assert(nonceMatches !== null);
      assert(nonceMatches.length >= 4, "Should have nonce on all script tags");
    });

    it("should handle empty config", () => {
      const emptyConfig: VeryfrontConfig = {} as VeryfrontConfig;
      const scripts = getDevScripts("test-slug", emptyConfig);

      assert(scripts.length > 0);
      assert(scripts.includes("window.__veryfrontComponents"));
    });

    it("should handle params parameter", () => {
      const params = { id: "123", name: "test" };
      const scripts = getDevScripts("test-slug", config, params);

      assert(scripts.length > 0);
    });

    it("should handle props parameter", () => {
      const props = { title: "Test Title" };
      const scripts = getDevScripts("test-slug", config, undefined, props);

      assert(scripts.length > 0);
    });

    it("should work with all parameters", () => {
      const params = { id: "123" };
      const props = { title: "Test" };
      const nonce = "test-nonce";
      const scripts = getDevScripts("test-slug", config, params, props, nonce);

      assert(scripts.length > 0);
      assert(scripts.includes(`nonce="${nonce}"`));
    });
  });
});
