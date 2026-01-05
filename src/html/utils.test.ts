import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals, assertStringIncludes } from "std/assert/mod.ts";
import {
  buildContentAttributes,
  buildImportMapJson,
  buildRootAttributes,
  shouldDisableLayout,
} from "./utils.ts";
import { getDefaultImportMap } from "../module-system/import-map/default-import-map.ts";

describe("html-generation/utils", () => {
  describe("buildRootAttributes", () => {
    it("should build root attributes with layout", () => {
      const result = buildRootAttributes("test-slug", "development", false);

      assertStringIncludes(result, 'id="root"');
      assertStringIncludes(result, 'class="vf-tailwind"');
      assertStringIncludes(result, 'data-veryfront-slug="test-slug"');
      assertStringIncludes(result, 'data-veryfront-mode="development"');
    });

    it("should build root attributes without layout", () => {
      const result = buildRootAttributes("test-slug", "production", true);

      assertStringIncludes(result, 'id="root"');
      assert(!result.includes('class="vf-tailwind"'));
      assertStringIncludes(result, 'data-veryfront-slug="test-slug"');
      assertStringIncludes(result, 'data-veryfront-mode="production"');
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

  describe("buildContentAttributes", () => {
    it("should build content attributes with layout", () => {
      const result = buildContentAttributes("test-slug", false, "abc123");

      assertStringIncludes(result, 'id="veryfront-content"');
      assertStringIncludes(result, 'data-slug="test-slug"');
      assertStringIncludes(result, 'data-layout="default"');
      assertStringIncludes(result, 'data-ssr-hash="abc123"');
    });

    it("should build content attributes without layout", () => {
      const result = buildContentAttributes("test-slug", true);

      assertStringIncludes(result, 'id="veryfront-content"');
      assertStringIncludes(result, 'data-slug="test-slug"');
      assertStringIncludes(result, 'data-layout="none"');
      assert(!result.includes("data-ssr-hash"));
    });

    it("should handle missing SSR hash", () => {
      const result = buildContentAttributes("test-slug", false);

      assert(!result.includes("data-ssr-hash"));
    });
  });

  describe("getDefaultImportMap", () => {
    it("should return veryfront exports for SSR", () => {
      const config = getDefaultImportMap();
      const map = config.imports;

      assert(map !== undefined);
      // Veryfront exports are included for SSR transforms
      assert(map["veryfront/head"] !== undefined);
      assert(map["veryfront/router"] !== undefined);
      assert(map["veryfront/context"] !== undefined);
      assert(map["veryfront/fonts"] !== undefined);
    });

    it("should return context packages as npm: specifiers for SSR", () => {
      const config = getDefaultImportMap();
      const map = config.imports;

      assert(map !== undefined);
      // Context packages use npm: specifiers for SSR so Deno resolves them locally
      // This ensures they share the same React instance from deno.json's npm:react
      assert(map["@tanstack/react-query"] !== undefined);
      assert(map["@tanstack/react-query"]?.startsWith("npm:"));
    });

    it("should NOT include React directly (resolved via deno.json)", () => {
      const config = getDefaultImportMap();
      const map = config.imports;

      assert(map !== undefined);
      // React is NOT in getDefaultImportMap - it's resolved via deno.json import map
      // This ensures SSR user code uses the same React instance as react-dom/server
      assertEquals(map.react, undefined);
      assertEquals(map["react-dom"], undefined);
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
      // In Deno, uses npm: specifiers; in true Node, uses esm.sh CDN
      assert(result.includes("npm:") || result.includes("esm.sh"));
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
