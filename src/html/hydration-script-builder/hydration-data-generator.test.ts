import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { generateHydrationData } from "./hydration-data-generator.ts";
import type { HTMLGenerationOptions } from "../types.ts";
import type { VeryfrontConfig } from "@veryfront/config";

describe("hydration-data-generator", () => {
  const baseOptions: HTMLGenerationOptions = {
    mode: "production",
    config: {} as VeryfrontConfig,
  };

  describe("generateHydrationData", () => {
    it("should generate JSON string", () => {
      const result = generateHydrationData("test-slug", {}, {}, baseOptions);

      assert(result.length > 0);
      const parsed = JSON.parse(result);
      assert(typeof parsed === "object");
    });

    it("should include slug", () => {
      const result = generateHydrationData("my-page", {}, {}, baseOptions);
      const parsed = JSON.parse(result);

      assertEquals(parsed.slug, "my-page");
    });

    it("should include params", () => {
      const params = { id: "123", name: "test" };
      const result = generateHydrationData("slug", params, {}, baseOptions);
      const parsed = JSON.parse(result);

      assertEquals(parsed.params, params);
    });

    it("should include props", () => {
      const props = { title: "Test Title", count: 42 };
      const result = generateHydrationData("slug", {}, props, baseOptions);
      const parsed = JSON.parse(result);

      assertEquals(parsed.props, props);
    });

    it("should include layouts from options", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        nestedLayouts: [
          { kind: "layout", path: "/layouts/main.tsx" },
          { kind: "layout", path: "/layouts/sidebar.tsx" },
        ],
      };
      const result = generateHydrationData("slug", {}, {}, options);
      const parsed = JSON.parse(result);

      assertEquals(parsed.layouts.length, 2);
      assertEquals(parsed.layouts[0].kind, "layout");
      assertEquals(parsed.layouts[0].path, "/layouts/main.tsx");
    });

    it("should use componentPath if path is not available", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        nestedLayouts: [
          { kind: "layout", componentPath: "/components/layout.tsx" },
        ],
      };
      const result = generateHydrationData("slug", {}, {}, options);
      const parsed = JSON.parse(result);

      assertEquals(parsed.layouts[0].path, "/components/layout.tsx");
    });

    it("should filter out layouts with empty paths", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        nestedLayouts: [
          { kind: "layout", path: "/layouts/main.tsx" },
          { kind: "layout", path: "" },
          { kind: "layout" },
        ],
      };
      const result = generateHydrationData("slug", {}, {}, options);
      const parsed = JSON.parse(result);

      assertEquals(parsed.layouts.length, 1);
      assertEquals(parsed.layouts[0].path, "/layouts/main.tsx");
    });

    it("should include providers from options", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        providerPaths: ["/providers/theme.tsx", "/providers/auth.tsx"],
      };
      const result = generateHydrationData("slug", {}, {}, options);
      const parsed = JSON.parse(result);

      assertEquals(parsed.providers, options.providerPaths);
    });

    it("should include appPath from options", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        appPath: "/app/root.tsx",
      };
      const result = generateHydrationData("slug", {}, {}, options);
      const parsed = JSON.parse(result);

      assertEquals(parsed.appPath, "/app/root.tsx");
    });

    it("should include pagePath from options", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        pagePath: "/pages/index.tsx",
      };
      const result = generateHydrationData("slug", {}, {}, options);
      const parsed = JSON.parse(result);

      assertEquals(parsed.pagePath, "/pages/index.tsx");
    });

    it("should handle empty slug", () => {
      const result = generateHydrationData("", {}, {}, baseOptions);
      const parsed = JSON.parse(result);

      assertEquals(parsed.slug, "");
    });

    it("should handle empty params", () => {
      const result = generateHydrationData("slug", {}, {}, baseOptions);
      const parsed = JSON.parse(result);

      assertEquals(parsed.params, {});
    });

    it("should handle empty props", () => {
      const result = generateHydrationData("slug", {}, {}, baseOptions);
      const parsed = JSON.parse(result);

      assertEquals(parsed.props, {});
    });

    it("should handle empty options", () => {
      const result = generateHydrationData("slug", {}, {}, baseOptions);
      const parsed = JSON.parse(result);

      assertEquals(parsed.layouts, []);
      assertEquals(parsed.providers, []);
    });

    it("should format JSON with 2 space indentation", () => {
      const result = generateHydrationData("slug", {}, {}, baseOptions);

      // Check if properly formatted
      assert(result.includes("\n"));
      assert(result.includes("  "));
    });

    it("should handle complex props", () => {
      const props = {
        nested: { value: 123 },
        array: [1, 2, 3],
        string: "test",
      };
      const result = generateHydrationData("slug", {}, props, baseOptions);
      const parsed = JSON.parse(result);

      assertEquals(parsed.props, props);
    });

    it("should handle array params", () => {
      const params = {
        ids: ["1", "2", "3"],
        tags: ["a", "b"],
      };
      const result = generateHydrationData("slug", params, {}, baseOptions);
      const parsed = JSON.parse(result);

      assertEquals(parsed.params, params);
    });

    it("should handle all options together", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        nestedLayouts: [{ kind: "layout", path: "/layout.tsx" }],
        providerPaths: ["/provider.tsx"],
        appPath: "/app.tsx",
        pagePath: "/page.tsx",
      };
      const result = generateHydrationData(
        "slug",
        { id: "123" },
        { title: "Test" },
        options
      );
      const parsed = JSON.parse(result);

      assertEquals(parsed.slug, "slug");
      assertEquals(parsed.params, { id: "123" });
      assertEquals(parsed.props, { title: "Test" });
      assertEquals(parsed.layouts.length, 1);
      assertEquals(parsed.providers.length, 1);
      assertEquals(parsed.appPath, "/app.tsx");
      assertEquals(parsed.pagePath, "/page.tsx");
    });
  });
});
