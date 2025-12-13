import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { getLoaderScript } from "./loader.ts";

describe("loader template", () => {
  describe("getLoaderScript", () => {
    it("should return loader script string", () => {
      const script = getLoaderScript();

      assert(typeof script === "string");
      assert(script.length > 0);
    });

    it("should define loadComponent function", () => {
      const script = getLoaderScript();

      assert(script.includes("async function loadComponent(path)"));
    });

    it("should validate component paths", () => {
      const script = getLoaderScript();

      assert(script.includes("match(/"));
      assert(script.includes("Invalid component path"));
    });

    it("should use MODULE_SERVER_URL", () => {
      const script = getLoaderScript();

      assert(script.includes("MODULE_SERVER_URL"));
    });

    it("should handle component loading errors", () => {
      const script = getLoaderScript();

      assert(script.includes("try {"));
      assert(script.includes("catch (error)"));
      assert(script.includes("Failed to load component"));
    });

    it("should support pages, components, app, and lib paths", () => {
      const script = getLoaderScript();

      assert(script.includes("pages|components|app|lib"));
    });

    it("should return module default or module itself", () => {
      const script = getLoaderScript();

      assert(script.includes("module.default || module"));
    });
  });
});
