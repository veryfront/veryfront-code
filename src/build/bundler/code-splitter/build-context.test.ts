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
      "veryfront/chat",
      "veryfront/markdown",
      "veryfront/mdx",
    ];

    function assertIncludesAll(
      result: string[],
      expected: string[],
      messagePrefix: string,
    ): void {
      for (const item of expected) {
        assertEquals(result.includes(item), true, `${messagePrefix}: ${item}`);
      }
    }

    function assertExcludesAll(
      result: string[],
      expected: string[],
      messagePrefix: string,
    ): void {
      for (const item of expected) {
        assertEquals(result.includes(item), false, `${messagePrefix}: ${item}`);
      }
    }

    it("should include React externals by default", () => {
      const result = getExternalDependencies();
      assertIncludesAll(result, REACT_EXTERNALS, "Missing React external");
    });

    it("should include Veryfront client modules for cdn mode (default)", () => {
      const result = getExternalDependencies([], "cdn");
      assertIncludesAll(result, VERYFRONT_CLIENT_MODULES, "Missing Veryfront module");
    });

    it("should include Veryfront client modules for self-hosted mode", () => {
      const result = getExternalDependencies([], "self-hosted");
      assertIncludesAll(result, VERYFRONT_CLIENT_MODULES, "Missing Veryfront module");
    });

    it("should exclude Veryfront client modules for bundled mode", () => {
      const result = getExternalDependencies([], "bundled");
      assertExcludesAll(result, VERYFRONT_CLIENT_MODULES, "Should not include");
    });

    it("should append custom external dependencies", () => {
      const result = getExternalDependencies(["lodash", "axios"]);
      assertIncludesAll(result, ["lodash", "axios"], "Missing custom external");
    });

    it("should combine React, Veryfront, and custom externals for cdn mode", () => {
      const result = getExternalDependencies(["custom-lib"], "cdn");
      assertIncludesAll(
        result,
        ["react", "veryfront/chat", "custom-lib"],
        "Missing external",
      );
    });
  });
});
