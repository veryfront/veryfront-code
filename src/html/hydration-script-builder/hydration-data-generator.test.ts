import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateHydrationData } from "./hydration-data-generator.ts";
import type { HTMLGenerationOptions } from "../types.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";

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

    it("includes release asset module URLs for hydration when a manifest is provided", () => {
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 1,
        projectId: "project-id",
        releaseId: "release-id",
        releaseVersion: 1,
        manifestVersion: 5,
        builderVersion: "0.1.784",
        sourceContentHash: "",
        createdAt: "2026-06-13T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {
          "pages/index.mdx": {
            contentHash: "a".repeat(64),
            size: 100,
            contentType: "text/javascript",
          },
          "components/layouts/DefaultLayout.mdx": {
            contentHash: "b".repeat(64),
            size: 100,
            contentType: "text/javascript",
          },
        },
        css: [],
        routes: {},
        dependencies: {},
        fallback: { mode: "jit", gaps: [] },
      };
      const parsed = parseHydrationData(
        "page",
        {},
        {},
        {
          ...baseOptions,
          mode: "production",
          pagePath: "/project/pages/index.mdx",
          nestedLayouts: [{ kind: "mdx", path: "/project/components/layouts/DefaultLayout.mdx" }],
          projectDir: "/project",
          releaseAssetManifest: manifest,
        } as HTMLGenerationOptions & { releaseAssetManifest: ReleaseAssetManifest },
      ) as {
        releaseAssetModules?: Record<string, string>;
      };

      assertEquals(
        parsed.releaseAssetModules?.["pages/index.mdx"],
        `/_vf/assets/${"a".repeat(64)}.js`,
      );
      assertEquals(
        parsed.releaseAssetModules?.["components/layouts/DefaultLayout.mdx"],
        `/_vf/assets/${"b".repeat(64)}.js`,
      );
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

    it("should choose fs client modules for local projects", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        isLocalProject: true,
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        clientModuleStrategy?: unknown;
      };
      assertEquals(parsed.clientModuleStrategy, "fs");
    });

    it("should choose rsc module client loading for remote preview pages", () => {
      // Preview pods (accessed via trusted proxy with environment=preview) do
      // not expose the dev-only `/_veryfront/fs/` handler — that surface is
      // gated on `isLocalProject` under VULN-SRV-1/2. Preview clients load
      // compiled modules via the RSC module endpoint, the same as production.
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        mode: "production",
        environment: "preview",
        isLocalProject: false,
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        clientModuleStrategy?: unknown;
      };
      assertEquals(parsed.clientModuleStrategy, "rsc-module");
    });

    it("should choose rsc module client loading for remote production pages", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        mode: "production",
        environment: "production",
        isLocalProject: false,
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        clientModuleStrategy?: unknown;
      };
      assertEquals(parsed.clientModuleStrategy, "rsc-module");
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

    it("should support compact JSON output", () => {
      const result = generateHydrationData("page", {}, {}, baseOptions, { pretty: false });
      assertEquals(result.includes("\n"), false);
    });

    it("escapes JSON for inline script contexts", () => {
      const scriptBreakout = "</script><script>alert(1)</script>";
      const lineSeparators = "\u2028\u2029";
      const result = generateHydrationData(
        "page",
        {},
        { title: scriptBreakout, lineSeparators },
        {
          ...baseOptions,
          frontmatter: { description: scriptBreakout },
          layoutProps: {
            "layouts/main.tsx": { lineSeparators },
          },
        },
      );

      assertEquals(result.includes("</script>"), false);
      assertEquals(result.includes("<script>"), false);
      assertEquals(result.includes("\u2028"), false);
      assertEquals(result.includes("\u2029"), false);
      assertStringIncludes(result, "\\u003c/script\\u003e");
      assertStringIncludes(result, "\\u2028");
      assertStringIncludes(result, "\\u2029");

      const parsed = JSON.parse(result) as {
        props: { title: string; lineSeparators: string };
        frontmatter: { description: string };
        layoutProps: Record<string, { lineSeparators: string }>;
      };
      assertEquals(parsed.props.title, scriptBreakout);
      assertEquals(parsed.props.lineSeparators, lineSeparators);
      assertEquals(parsed.frontmatter.description, scriptBreakout);
      assertEquals(parsed.layoutProps["layouts/main.tsx"]?.lineSeparators, lineSeparators);
    });
  });
});
