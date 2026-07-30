import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateHydrationData } from "./hydration-data-generator.ts";
import type { HTMLGenerationOptions } from "../types.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { type HydrationData, HydrationDataSchema } from "../schemas/index.ts";

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

    it("should omit filesystem paths outside the project root", () => {
      const parsed = parseHydrationData("page", {}, {}, {
        ...baseOptions,
        projectDir: "/project",
        pagePath: "/private/tenant/page.tsx",
        appPath: "/private/tenant/app.tsx",
        nestedLayouts: [
          { kind: "tsx", path: "/private/tenant/layout.tsx" },
          { kind: "tsx", path: "/project/app/layout.tsx" },
        ],
      }) as {
        pagePath?: string;
        appPath?: string;
        layouts: Array<{ kind: string; path: string }>;
      };

      assertEquals(parsed.pagePath, undefined);
      assertEquals(parsed.appPath, undefined);
      assertEquals(parsed.layouts, [{ kind: "tsx", path: "app/layout.tsx" }]);
    });

    it("publishes the configured App Router root", () => {
      const parsed = parseHydrationData("page", {}, {}, {
        ...baseOptions,
        projectDir: "/project",
        pagePath: "/project/src/app/page.tsx",
        config: { directories: { app: "src/app" } },
      }) as { appRouterRoot?: string };

      assertEquals(parsed.appRouterRoot, "src/app");
    });

    it("publishes isolated client-page ownership", () => {
      const parsed = parseHydrationData(
        "page",
        {},
        {},
        {
          ...baseOptions,
          isolatedClientPage: true,
        } as HTMLGenerationOptions & { isolatedClientPage: boolean },
      ) as {
        isolatedClientPage?: boolean;
      };

      assertEquals(parsed.isolatedClientPage, true);
    });

    it("includes release asset module URLs for hydration when a manifest is provided", () => {
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 2,
        projectId: "project-id",
        releaseId: "release-id",
        releaseVersion: 1,
        manifestVersion: 5,
        builderVersion: "0.1.784",
        sourceContentHash: "a".repeat(64),
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
        dependencyMode: "source",
        dependencies: {},
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

    it("includes App Router release asset module URLs for hydration", () => {
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 2,
        projectId: "project-id",
        releaseId: "release-id",
        releaseVersion: 1,
        manifestVersion: 5,
        builderVersion: "0.1.1156",
        sourceContentHash: "",
        createdAt: "2026-07-27T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {
          "app/page.tsx": {
            contentHash: "c".repeat(64),
            size: 100,
            contentType: "text/javascript",
          },
          "app/layout.tsx": {
            contentHash: "d".repeat(64),
            size: 100,
            contentType: "text/javascript",
          },
          "app/unrelated.tsx": {
            contentHash: "e".repeat(64),
            size: 100,
            contentType: "text/javascript",
          },
        },
        css: [],
        routes: {
          "/": { modules: ["app/page.tsx", "app/layout.tsx"], css: [] },
        },
        dependencyMode: "source",
        dependencies: {},
      };
      const parsed = parseHydrationData(
        "page",
        {},
        {},
        {
          ...baseOptions,
          mode: "production",
          pagePath: "/project/app/page.tsx",
          nestedLayouts: [{ kind: "tsx", path: "/project/app/layout.tsx" }],
          projectDir: "/project",
          releaseAssetManifest: manifest,
        } as HTMLGenerationOptions & { releaseAssetManifest: ReleaseAssetManifest },
      ) as {
        releaseAssetModules?: Record<string, string>;
      };

      assertEquals(
        parsed.releaseAssetModules?.["app/page.tsx"],
        `/_vf/assets/${"c".repeat(64)}.js`,
      );
      assertEquals(
        parsed.releaseAssetModules?.["app/layout.tsx"],
        `/_vf/assets/${"d".repeat(64)}.js`,
      );
      assertEquals(parsed.releaseAssetModules?.["app/unrelated.tsx"], undefined);
    });

    it("includes release id for production fallback module versioning", () => {
      const parsed = parseHydrationData(
        "page",
        {},
        {},
        {
          ...baseOptions,
          mode: "production",
          environment: "production",
          releaseId: "rel-1",
        },
      ) as {
        releaseId?: string;
      };

      assertEquals(parsed.releaseId, "rel-1");
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

    it("should preserve an explicitly authorized fs client module strategy", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        isLocalProject: true,
        clientModuleStrategy: "fs",
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        clientModuleStrategy?: unknown;
      };
      assertEquals(parsed.clientModuleStrategy, "fs");
    });

    it("should fail closed for local projects without an explicit strategy", () => {
      const parsed = parseHydrationData("page", {}, {}, {
        ...baseOptions,
        isLocalProject: true,
      }) as { clientModuleStrategy?: unknown };
      assertEquals(parsed.clientModuleStrategy, "rsc-module");
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

    it("should preserve layoutProps when hydration data is schema-parsed", () => {
      const generated = parseHydrationData("page", {}, {}, {
        ...baseOptions,
        layoutProps: {
          "layouts/main.tsx": { theme: "dark" },
        },
      });
      const parsed: HydrationData = HydrationDataSchema.parse(generated);

      assertEquals(parsed.layoutProps, {
        "layouts/main.tsx": { theme: "dark" },
      });
    });

    it("preserves every generated hydration contract field through schema parsing", () => {
      const contentHash = "e".repeat(64);
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 2,
        projectId: "project-id",
        releaseId: "release-id",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "test",
        sourceContentHash: "f".repeat(64),
        createdAt: "2026-07-27T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {
          "app/page.tsx": {
            contentHash,
            size: 100,
            contentType: "text/javascript",
          },
        },
        css: [],
        routes: {},
        dependencyMode: "source",
        dependencies: {},
      };
      const generated = parseHydrationData(
        "docs",
        { slug: ["guides", "intro"] },
        { answer: 42 },
        {
          ...baseOptions,
          mode: "development",
          projectDir: "/project",
          pagePath: "/project/app/page.tsx",
          appPath: "/project/app/app.tsx",
          errorPath: "/project/app/error.tsx",
          nestedLayouts: [{ kind: "tsx", path: "/project/app/layout.tsx" }],
          isolatedClientPage: true,
          pageType: "tsx",
          releaseId: "release-id",
          releaseAssetManifest: manifest,
          frontmatter: { title: "Guide" },
          layoutProps: { "app/layout.tsx": { theme: "dark" } },
          headings: [{ id: "intro", text: "Introduction", level: 1 }],
          studioEmbed: true,
        } as HTMLGenerationOptions & {
          releaseAssetManifest: ReleaseAssetManifest;
        },
      );

      const parsed: HydrationData = HydrationDataSchema.parse(generated);

      assertEquals(parsed.pageType, "tsx");
      assertEquals(parsed.releaseId, "release-id");
      assertEquals(parsed.releaseAssetModules, {
        "app/page.tsx": `/_vf/assets/${contentHash}.js`,
      });
      assertEquals(typeof parsed.buildVersion?.framework, "string");
      assertEquals(typeof parsed.buildVersion?.serverStart, "number");
      assertEquals(parsed.frontmatter, { title: "Guide" });
      assertEquals(parsed.dev, true);
      assertEquals(parsed.headings, [{ id: "intro", text: "Introduction", level: 1 }]);
      assertEquals(parsed.studioEmbed, true);
      assertEquals(parsed.isolatedClientPage, true);
      assertEquals(parsed.errorPath, "app/error.tsx");
    });

    it("rejects unsafe or oversized release module maps in hydration data", () => {
      const baseHydrationData = {
        slug: "page",
        props: {},
        params: {},
        layouts: [],
      };

      assertThrows(() =>
        HydrationDataSchema.parse({
          ...baseHydrationData,
          releaseAssetModules: {
            "app/page.tsx": "https://attacker.invalid/module.js",
          },
        })
      );

      const oversizedEntries = Object.fromEntries(
        Array.from(
          { length: 513 },
          (_, index) => [
            `app/generated-${index}.tsx`,
            `/_vf/assets/${index.toString(16).padStart(64, "0")}.js`,
          ],
        ),
      );
      assertThrows(() =>
        HydrationDataSchema.parse({
          ...baseHydrationData,
          releaseAssetModules: oversizedEntries,
        })
      );

      assertThrows(() =>
        HydrationDataSchema.parse({
          ...baseHydrationData,
          pagePath: "a".repeat(2_049),
        })
      );

      assertThrows(() =>
        HydrationDataSchema.parse({
          ...baseHydrationData,
          pagePath: "../app/page.tsx",
        })
      );
    });

    it("accepts every authored module extension supported by hydration loading", () => {
      const assetUrl = `/_vf/assets/${"a".repeat(64)}.js`;
      const parsed = HydrationDataSchema.parse({
        slug: "content",
        props: {},
        params: {},
        layouts: [],
        pagePath: "content/page.md",
        releaseAssetModules: {
          "content/page.md": assetUrl,
          "lib/runtime.mjs": assetUrl,
        },
      });

      assertEquals(parsed.pagePath, "content/page.md");
      assertEquals(parsed.releaseAssetModules, {
        "content/page.md": assetUrl,
        "lib/runtime.mjs": assetUrl,
      });
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
