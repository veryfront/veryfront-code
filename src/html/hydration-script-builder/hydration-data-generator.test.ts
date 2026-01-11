import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { generateHydrationData } from "./hydration-data-generator.ts";
import type { HTMLGenerationOptions } from "../types.ts";

describe("hydration-data-generator", () => {
  const baseOptions: HTMLGenerationOptions = {
    mode: "development",
    config: {},
  };

  describe("generateHydrationData", () => {
    it("should return valid JSON string", () => {
      const result = generateHydrationData("test-slug", {}, {}, baseOptions);
      const parsed = JSON.parse(result);
      assertEquals(typeof parsed, "object");
    });

    it("should include slug in output", () => {
      const result = generateHydrationData("my-page", {}, {}, baseOptions);
      const parsed = JSON.parse(result);
      assertEquals(parsed.slug, "my-page");
    });

    it("should include params in output", () => {
      const params = { id: "123", category: "news" };
      const result = generateHydrationData("page", params, {}, baseOptions);
      const parsed = JSON.parse(result);
      assertEquals(parsed.params, params);
    });

    it("should include props in output", () => {
      const props = { title: "Hello", count: 42 };
      const result = generateHydrationData("page", {}, props, baseOptions);
      const parsed = JSON.parse(result);
      assertEquals(parsed.props, props);
    });

    it("should handle empty slug", () => {
      const result = generateHydrationData("", {}, {}, baseOptions);
      const parsed = JSON.parse(result);
      assertEquals(parsed.slug, "");
    });

    it("should include layouts when provided", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        nestedLayouts: [
          { kind: "tsx", path: "/project/layouts/main.tsx" },
          { kind: "mdx", componentPath: "/project/layouts/blog.mdx" },
        ],
        projectDir: "/project",
      };
      const result = generateHydrationData("page", {}, {}, options);
      const parsed = JSON.parse(result);
      assertEquals(parsed.layouts.length, 2);
    });

    it("should filter out layouts without paths", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        nestedLayouts: [
          { kind: "tsx", path: "/project/layouts/main.tsx" },
          { kind: "tsx" }, // No path
        ],
        projectDir: "/project",
      };
      const result = generateHydrationData("page", {}, {}, options);
      const parsed = JSON.parse(result);
      assertEquals(parsed.layouts.length, 1);
    });

    it("should include providers when provided", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        providerPaths: ["/project/providers/auth.tsx", "/project/providers/theme.tsx"],
        projectDir: "/project",
      };
      const result = generateHydrationData("page", {}, {}, options);
      const parsed = JSON.parse(result);
      assertEquals(parsed.providers.length, 2);
    });

    it("should include appPath when provided", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        appPath: "/project/app.tsx",
        projectDir: "/project",
      };
      const result = generateHydrationData("page", {}, {}, options);
      const parsed = JSON.parse(result);
      assertEquals(typeof parsed.appPath, "string");
    });

    it("should include pagePath when provided", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        pagePath: "/project/pages/index.tsx",
        projectDir: "/project",
      };
      const result = generateHydrationData("page", {}, {}, options);
      const parsed = JSON.parse(result);
      assertEquals(typeof parsed.pagePath, "string");
    });

    it("should include pageType from options", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        pageType: "mdx",
      };
      const result = generateHydrationData("page", {}, {}, options);
      const parsed = JSON.parse(result);
      assertEquals(parsed.pageType, "mdx");
    });

    it("should infer pageType from pagePath extension", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        pagePath: "/project/pages/index.tsx",
      };
      const result = generateHydrationData("page", {}, {}, options);
      const parsed = JSON.parse(result);
      assertEquals(parsed.pageType, "tsx");
    });

    it("should include frontmatter when provided", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        frontmatter: { title: "My Page", draft: true },
      };
      const result = generateHydrationData("page", {}, {}, options);
      const parsed = JSON.parse(result);
      assertEquals(parsed.frontmatter, { title: "My Page", draft: true });
    });

    it("should include layoutProps when provided", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        layoutProps: {
          "layouts/main.tsx": { theme: "dark" },
        },
      };
      const result = generateHydrationData("page", {}, {}, options);
      const parsed = JSON.parse(result);
      assertEquals(parsed.layoutProps, { "layouts/main.tsx": { theme: "dark" } });
    });

    it("should set dev=true in development mode", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        mode: "development",
      };
      const result = generateHydrationData("page", {}, {}, options);
      const parsed = JSON.parse(result);
      assertEquals(parsed.dev, true);
    });

    it("should set dev=false in production mode", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        mode: "production",
      };
      const result = generateHydrationData("page", {}, {}, options);
      const parsed = JSON.parse(result);
      assertEquals(parsed.dev, false);
    });

    it("should format JSON with indentation", () => {
      const result = generateHydrationData("page", {}, {}, baseOptions);
      assertStringIncludes(result, "\n");
    });
  });
});
