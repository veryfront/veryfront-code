import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { pathToModuleUrl } from "./path-utils.ts";

describe("lib/spa/path-utils", () => {
  describe("pathToModuleUrl", () => {
    it("should convert source paths to module URLs", () => {
      const result = pathToModuleUrl("pages/index.tsx", "/_vf_modules");
      assertEquals(result, "/_vf_modules/pages/index.js");
    });

    it("should handle components directory", () => {
      const result = pathToModuleUrl("components/Button.tsx", "/_vf_modules");
      assertEquals(result, "/_vf_modules/components/Button.js");
    });

    it("should handle app directory", () => {
      const result = pathToModuleUrl("app/layout.tsx", "/_vf_modules");
      assertEquals(result, "/_vf_modules/app/layout.js");
    });

    it("should handle lib directory", () => {
      const result = pathToModuleUrl("lib/utils.ts", "/_vf_modules");
      assertEquals(result, "/_vf_modules/lib/utils.js");
    });

    it("should handle layouts directory", () => {
      const result = pathToModuleUrl("layouts/main.tsx", "/_vf_modules");
      assertEquals(result, "/_vf_modules/layouts/main.js");
    });

    it("should handle .jsx extension", () => {
      const result = pathToModuleUrl("components/Card.jsx", "/_vf_modules");
      assertEquals(result, "/_vf_modules/components/Card.js");
    });

    it("should handle .mdx extension", () => {
      const result = pathToModuleUrl("pages/about.mdx", "/_vf_modules");
      assertEquals(result, "/_vf_modules/pages/about.js");
    });

    it("should handle paths without recognized source dir", () => {
      const result = pathToModuleUrl("utils/helper.ts", "/_vf_modules");
      assertEquals(result, "/_vf_modules/utils/helper.js");
    });

    it("should handle paths with no extension", () => {
      const result = pathToModuleUrl("some/module", "/_vf_modules");
      assertEquals(result, "/_vf_modules/some/module.js");
    });

    it("should handle paths already ending in .js", () => {
      const result = pathToModuleUrl("utils/helper.js", "/_vf_modules");
      assertEquals(result, "/_vf_modules/utils/helper.js");
    });

    it("should handle absolute paths with source dirs", () => {
      const result = pathToModuleUrl("/project/pages/index.tsx", "/_vf_modules");
      assertEquals(result, "/_vf_modules/pages/index.js");
    });

    it("should use custom base url", () => {
      const result = pathToModuleUrl("pages/home.tsx", "/custom");
      assertEquals(result, "/custom/pages/home.js");
    });
  });
});
