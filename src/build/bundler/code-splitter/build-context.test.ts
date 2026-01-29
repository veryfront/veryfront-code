import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getExternalDependencies } from "./build-context.ts";

describe("build/bundler/code-splitter/build-context", () => {
  describe("getExternalDependencies", () => {
    const REACT_EXTERNALS = [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ];

    const VERYFRONT_CLIENT_MODULES = [
      "veryfront/agent/react",
      "veryfront/components/ai",
      "veryfront/primitives",
    ];

    it("should include React externals by default", () => {
      const result = getExternalDependencies();
      for (const ext of REACT_EXTERNALS) {
        assertEquals(result.includes(ext), true, `Missing React external: ${ext}`);
      }
    });

    it("should include Veryfront client modules for cdn mode (default)", () => {
      const result = getExternalDependencies([], "cdn");
      for (const mod of VERYFRONT_CLIENT_MODULES) {
        assertEquals(result.includes(mod), true, `Missing Veryfront module: ${mod}`);
      }
    });

    it("should include Veryfront client modules for self-hosted mode", () => {
      const result = getExternalDependencies([], "self-hosted");
      for (const mod of VERYFRONT_CLIENT_MODULES) {
        assertEquals(result.includes(mod), true, `Missing Veryfront module: ${mod}`);
      }
    });

    it("should exclude Veryfront client modules for bundled mode", () => {
      const result = getExternalDependencies([], "bundled");
      for (const mod of VERYFRONT_CLIENT_MODULES) {
        assertEquals(result.includes(mod), false, `Should not include: ${mod}`);
      }
    });

    it("should append custom external dependencies", () => {
      const result = getExternalDependencies(["lodash", "axios"]);
      assertEquals(result.includes("lodash"), true);
      assertEquals(result.includes("axios"), true);
    });

    it("should combine React, Veryfront, and custom externals for cdn mode", () => {
      const result = getExternalDependencies(["custom-lib"], "cdn");
      assertEquals(result.includes("react"), true);
      assertEquals(result.includes("veryfront/primitives"), true);
      assertEquals(result.includes("custom-lib"), true);
    });
  });
});
