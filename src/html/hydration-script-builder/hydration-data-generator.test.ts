import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateHydrationData } from "./hydration-data-generator.ts";
import type { HTMLGenerationOptions } from "../types.ts";

function parseHydrationData(
  slug: string,
  params: Record<string, string | string[]>,
  props: Record<string, unknown>,
  options: HTMLGenerationOptions,
): unknown {
  return JSON.parse(generateHydrationData(slug, params, props, options));
}

describe("hydration-data-generator", () => {
  const baseOptions: HTMLGenerationOptions = {
    mode: "development",
    config: {},
  };

  describe("generateHydrationData", () => {
    it("should return valid JSON string", () => {
      const parsed = parseHydrationData("test-slug", {}, {}, baseOptions) as Record<
        string,
        unknown
      >;
      assertEquals(typeof parsed, "object");
    });

    it("should include slug in output", () => {
      const parsed = parseHydrationData("my-page", {}, {}, baseOptions) as {
        slug: string;
      };
      assertEquals(parsed.slug, "my-page");
    });

    it("should include params in output", () => {
      const params = { id: "123", category: "news" };
      const parsed = parseHydrationData("page", params, {}, baseOptions) as {
        params: typeof params;
      };
      assertEquals(parsed.params, params);
    });

    it("should include props in output", () => {
      const props = { title: "Hello", count: 42 };
      const parsed = parseHydrationData("page", {}, props, baseOptions) as {
        props: typeof props;
      };
      assertEquals(parsed.props, props);
    });

    it("should handle empty slug", () => {
      const parsed = parseHydrationData("", {}, {}, baseOptions) as { slug: string };
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
      const parsed = parseHydrationData("page", {}, {}, options) as {
        layouts: unknown[];
      };
      assertEquals(parsed.layouts.length, 2);
    });

    it("should filter out layouts without paths", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        nestedLayouts: [{ kind: "tsx", path: "/project/layouts/main.tsx" }, { kind: "tsx" }],
        projectDir: "/project",
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        layouts: unknown[];
      };
      assertEquals(parsed.layouts.length, 1);
    });

    it("should include appPath when provided", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        appPath: "/project/app.tsx",
        projectDir: "/project",
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        appPath?: unknown;
      };
      assertEquals(typeof parsed.appPath, "string");
    });

    it("should include pagePath when provided", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        pagePath: "/project/pages/index.tsx",
        projectDir: "/project",
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        pagePath?: unknown;
      };
      assertEquals(typeof parsed.pagePath, "string");
    });

    it("should include pageType from options", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        pageType: "mdx",
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        pageType?: unknown;
      };
      assertEquals(parsed.pageType, "mdx");
    });

    it("should infer pageType from pagePath extension", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        pagePath: "/project/pages/index.tsx",
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        pageType?: unknown;
      };
      assertEquals(parsed.pageType, "tsx");
    });

    it("should include frontmatter when provided", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        frontmatter: { title: "My Page", draft: true },
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        frontmatter?: unknown;
      };
      assertEquals(parsed.frontmatter, { title: "My Page", draft: true });
    });

    it("should include layoutProps when provided", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        layoutProps: {
          "layouts/main.tsx": { theme: "dark" },
        },
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        layoutProps?: unknown;
      };
      assertEquals(parsed.layoutProps, { "layouts/main.tsx": { theme: "dark" } });
    });

    it("should set dev=true in development mode", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        mode: "development",
      };
      const parsed = parseHydrationData("page", {}, {}, options) as { dev?: unknown };
      assertEquals(parsed.dev, true);
    });

    it("should set dev=false in production mode", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        mode: "production",
      };
      const parsed = parseHydrationData("page", {}, {}, options) as { dev?: unknown };
      assertEquals(parsed.dev, false);
    });

    it("should format JSON with indentation", () => {
      const result = generateHydrationData("page", {}, {}, baseOptions);
      assertStringIncludes(result, "\n");
    });
  });
});
