import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { buildImportMapJson, buildRootAttributes, shouldDisableLayout } from "./utils.ts";
import { getDefaultImportMap } from "#veryfront/modules/import-map/default-import-map.ts";

describe("html-generation/utils", () => {
  describe("buildRootAttributes", () => {
    it("should build root attributes with layout", () => {
      const result = buildRootAttributes("test-slug", "development", false);

      assertStringIncludes(result, 'id="root"');
      assertStringIncludes(result, 'data-veryfront-slug="test-slug"');
      assertStringIncludes(result, 'data-veryfront-mode="development"');
      assertStringIncludes(result, 'data-layout="default"');
    });

    it("should build root attributes without layout", () => {
      const result = buildRootAttributes("test-slug", "production", true);

      assertStringIncludes(result, 'id="root"');
      assertStringIncludes(result, 'data-veryfront-slug="test-slug"');
      assertStringIncludes(result, 'data-veryfront-mode="production"');
      assertStringIncludes(result, 'data-layout="none"');
    });

    it("should include SSR hash when provided", () => {
      const result = buildRootAttributes("test-slug", "production", false, "abc123");

      assertStringIncludes(result, 'data-ssr-hash="abc123"');
    });

    it("should not include SSR hash when not provided", () => {
      const result = buildRootAttributes("test-slug", "production", false);

      assert(!result.includes("data-ssr-hash"));
    });

    it("should escape HTML in attributes", () => {
      const result = buildRootAttributes('<script>alert("xss")</script>', "dev", false);

      assert(!result.includes("<script>"));
      assertStringIncludes(result, "&lt;script&gt;");
    });

    it("should handle empty slug", () => {
      const result = buildRootAttributes("", "development", false);

      assertStringIncludes(result, 'data-veryfront-slug=""');
    });
  });

  describe("getDefaultImportMap", () => {
    it("should return veryfront exports only (no React)", () => {
      const map = getDefaultImportMap().imports;
      assert(map);

      assert(map["veryfront/head"] !== undefined);
      assert(map["veryfront/router"] !== undefined);
      assert(map["veryfront/context"] !== undefined);
      assert(map["veryfront/fonts"] !== undefined);
    });

    it("should include React for SSR consistency", () => {
      const map = getDefaultImportMap().imports;
      assert(map);

      // React is now included in the import map for SSR consistency
      assert(map.react !== undefined);
      assert(map["react-dom"] !== undefined);
      assert(map["react/jsx-runtime"] !== undefined);
      // Third-party packages are still not included
      assertEquals(map["@tanstack/react-query"], undefined);
      assertEquals(map["next-themes"], undefined);
    });
  });

  describe("buildImportMapJson", () => {
    it("should build import map JSON with custom imports", async () => {
      const customMap = { "custom-lib": "https://cdn.example.com/lib.js" };
      const result = await buildImportMapJson(customMap);

      assertStringIncludes(result, '"imports"');
      assertStringIncludes(result, '"custom-lib"');
      assertStringIncludes(result, "https://cdn.example.com/lib.js");
    });

    it("should use default imports when none provided", async () => {
      const result = await buildImportMapJson();

      assertStringIncludes(result, '"react"');
      assertStringIncludes(result, '"react-dom"');
      assertStringIncludes(result, "esm.sh");
    });

    it("should format JSON with proper indentation", async () => {
      const result = await buildImportMapJson();

      assertStringIncludes(result, "\n");
      assertStringIncludes(result, "  ");
    });
  });

  describe("shouldDisableLayout", () => {
    it("should return true when layout is false (boolean)", () => {
      assertEquals(shouldDisableLayout({ layout: false }), true);
    });

    it("should return true when layout is 'false' (string)", () => {
      assertEquals(shouldDisableLayout({ layout: "false" }), true);
    });

    it("should return false when layout is true", () => {
      assertEquals(shouldDisableLayout({ layout: true }), false);
    });

    it("should return false when layout is not specified", () => {
      assertEquals(shouldDisableLayout({}), false);
    });

    it("should return false when frontmatter is undefined", () => {
      assertEquals(shouldDisableLayout(undefined), false);
    });

    it("should return false when layout is a string path", () => {
      assertEquals(shouldDisableLayout({ layout: "custom-layout" }), false);
    });
  });
});
