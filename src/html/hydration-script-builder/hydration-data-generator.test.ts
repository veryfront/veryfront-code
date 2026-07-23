import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateHydrationData } from "./hydration-data-generator.ts";
import type { HTMLGenerationOptions } from "../types.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { HTMLGenerationOptionsSchema, HydrationDataSchema } from "../schemas/index.ts";

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

    it("does not execute route-param accessors", () => {
      let paramAccessorCalls = 0;
      const params: Record<string, string> = {};
      Object.defineProperty(params, "id", {
        enumerable: true,
        get() {
          paramAccessorCalls++;
          return "123";
        },
      });
      assertThrows(
        () => generateHydrationData("page", params, {}, baseOptions),
        Error,
        "Hydration params cannot be inspected",
      );
      assertEquals(paramAccessorCalls, 0);

      let itemAccessorCalls = 0;
      const values = ["one"];
      Object.defineProperty(values, 0, {
        enumerable: true,
        get() {
          itemAccessorCalls++;
          return "one";
        },
      });
      assertThrows(
        () => generateHydrationData("page", { id: values }, {}, baseOptions),
        Error,
        "Hydration params cannot be inspected",
      );
      assertEquals(itemAccessorCalls, 0);
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

    it("rejects layouts without paths", () => {
      const options: HTMLGenerationOptions = {
        ...baseOptions,
        nestedLayouts: [{ kind: "tsx", path: "/project/layouts/main.tsx" }, { kind: "tsx" }],
        projectDir: "/project",
      };
      assertThrows(
        () => parseHydrationData("page", {}, {}, options),
        TypeError,
        "layout path",
      );
    });

    it("does not execute accessors in generation options or layouts", () => {
      let optionAccessorCalls = 0;
      const accessorOptions: Record<string, unknown> = { config: {} };
      Object.defineProperty(accessorOptions, "mode", {
        enumerable: true,
        get() {
          optionAccessorCalls++;
          return "development";
        },
      });
      assertThrows(
        () => generateHydrationData("page", {}, {}, accessorOptions as never),
        TypeError,
        "Hydration options must not contain accessor properties",
      );
      assertEquals(optionAccessorCalls, 0);

      let layoutAccessorCalls = 0;
      const layout: Record<string, unknown> = { kind: "tsx" };
      Object.defineProperty(layout, "path", {
        enumerable: true,
        get() {
          layoutAccessorCalls++;
          return "layouts/main.tsx";
        },
      });
      assertThrows(
        () =>
          generateHydrationData("page", {}, {}, {
            ...baseOptions,
            nestedLayouts: [layout] as never,
          }),
        TypeError,
        "Hydration layouts must not contain accessor properties",
      );
      assertEquals(layoutAccessorCalls, 0);
    });

    it("does not execute nested config or serialization-option accessors", () => {
      let configAccessorCalls = 0;
      const directories: Record<string, unknown> = {};
      Object.defineProperty(directories, "app", {
        enumerable: true,
        get() {
          configAccessorCalls++;
          return "app";
        },
      });
      assertThrows(
        () =>
          generateHydrationData("page", {}, {}, {
            ...baseOptions,
            config: { directories },
          } as never),
        TypeError,
        "Hydration config directories must not contain accessor properties",
      );
      assertEquals(configAccessorCalls, 0);

      let serializationAccessorCalls = 0;
      const serializeOptions: Record<string, unknown> = {};
      Object.defineProperty(serializeOptions, "pretty", {
        enumerable: true,
        get() {
          serializationAccessorCalls++;
          return false;
        },
      });
      assertThrows(
        () => generateHydrationData("page", {}, {}, baseOptions, serializeOptions as never),
        TypeError,
        "Hydration serialization options must not contain accessor properties",
      );
      assertEquals(serializationAccessorCalls, 0);
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

    it("rejects filesystem paths outside the project root", () => {
      for (
        const options of [
          { pagePath: "/private/tenant/page.tsx" },
          { appPath: "/private/tenant/app.tsx" },
          { nestedLayouts: [{ kind: "tsx" as const, path: "/private/tenant/layout.tsx" }] },
        ]
      ) {
        assertThrows(
          () =>
            parseHydrationData("page", {}, {}, {
              ...baseOptions,
              projectDir: "/project",
              ...options,
            }),
          TypeError,
          "path",
        );
      }
    });

    it("rejects normalized paths that traverse outside the project root", () => {
      assertThrows(
        () =>
          parseHydrationData("page", {}, {}, {
            ...baseOptions,
            projectDir: "/project",
            pagePath: "/project/pages/../../private/page.tsx",
          }),
        TypeError,
        "page path",
      );
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

    it("honors an explicit App Router root over the configured directory", () => {
      const parsed = parseHydrationData("page", {}, {}, {
        ...baseOptions,
        projectDir: "/project",
        appRouterRoot: "routes/app",
        config: { directories: { app: "src/app" } },
      }) as { appRouterRoot?: string };

      assertEquals(parsed.appRouterRoot, "routes/app");
    });

    it("rejects an explicit App Router root that escapes the project", () => {
      assertThrows(
        () =>
          parseHydrationData("page", {}, {}, {
            ...baseOptions,
            projectDir: "/project",
            appRouterRoot: "../private/app",
          }),
        TypeError,
        "App Router root",
      );
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

    it("rejects malformed release asset module entries", () => {
      const manifest = {
        modules: {
          "pages/index.tsx": {
            contentHash: 'hash"><script>alert(1)</script>',
          },
        },
      } as unknown as ReleaseAssetManifest;
      assertThrows(
        () =>
          parseHydrationData(
            "page",
            {},
            {},
            {
              ...baseOptions,
              releaseAssetManifest: manifest,
            } as HTMLGenerationOptions & { releaseAssetManifest: ReleaseAssetManifest },
          ),
        TypeError,
        "asset module",
      );
    });

    it("does not execute release-manifest accessors", () => {
      let manifestAccessorCalls = 0;
      const manifest: Record<string, unknown> = {};
      Object.defineProperty(manifest, "modules", {
        enumerable: true,
        get() {
          manifestAccessorCalls++;
          return {};
        },
      });
      assertThrows(
        () =>
          generateHydrationData("page", {}, {}, {
            ...baseOptions,
            releaseAssetManifest: manifest as never,
          } as never),
        TypeError,
        "module map must not contain accessor properties",
      );
      assertEquals(manifestAccessorCalls, 0);

      let entryAccessorCalls = 0;
      const entry: Record<string, unknown> = {};
      Object.defineProperty(entry, "contentHash", {
        enumerable: true,
        get() {
          entryAccessorCalls++;
          return "a".repeat(64);
        },
      });
      assertThrows(
        () =>
          generateHydrationData("page", {}, {}, {
            ...baseOptions,
            releaseAssetManifest: {
              modules: { "pages/index.tsx": entry },
            } as never,
          } as never),
        TypeError,
        "module entry must not contain accessor properties",
      );
      assertEquals(entryAccessorCalls, 0);
    });

    it("rejects oversized release asset module maps before serialization", () => {
      const modules: Record<string, { contentHash: string }> = {};
      for (let index = 0; index <= 10_000; index++) {
        modules[`pages/${index}.tsx`] = { contentHash: "a".repeat(64) };
      }
      const manifest = { modules } as unknown as ReleaseAssetManifest;

      assertThrows(
        () =>
          parseHydrationData(
            "page",
            {},
            {},
            {
              ...baseOptions,
              releaseAssetManifest: manifest,
            } as HTMLGenerationOptions & { releaseAssetManifest: ReleaseAssetManifest },
          ),
        TypeError,
        "entry limit",
      );
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
        projectDir: "/project",
      };
      const parsed = parseHydrationData("page", {}, {}, options) as {
        pageType?: unknown;
      };
      assertEquals(parsed.pageType, "tsx");
    });

    it("infers Markdown page type from pagePath", () => {
      const parsed = parseHydrationData("page", {}, {}, {
        ...baseOptions,
        pagePath: "/project/pages/index.md",
        projectDir: "/project",
      }) as { pageType?: unknown };

      assertEquals(parsed.pageType, "md");
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
      // not expose the dev-only `/_veryfront/fs/` handler. That surface is
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
      const parsed = HydrationDataSchema.parse(generated) as Record<string, unknown>;

      assertEquals(parsed.layoutProps, {
        "layouts/main.tsx": { theme: "dark" },
      });
    });

    it("preserves all generated optional fields when schema-parsed", () => {
      const generated = parseHydrationData("page", {}, {}, {
        ...baseOptions,
        pageType: "mdx",
        releaseId: "release-1",
        frontmatter: { title: "Page" },
        headings: [{ id: "intro", text: "Intro", level: 2 }],
        studioEmbed: true,
      });
      const parsed = HydrationDataSchema.parse(generated) as Record<string, unknown>;

      assertEquals(parsed.pageType, "mdx");
      assertEquals(parsed.releaseId, "release-1");
      assertEquals(parsed.frontmatter, { title: "Page" });
      assertEquals(parsed.dev, true);
      assertEquals(parsed.headings, [{ id: "intro", text: "Intro", level: 2 }]);
      assertEquals(parsed.studioEmbed, true);
    });

    it("rejects unsupported nested layout kinds at the schema boundary", () => {
      assertThrows(
        () =>
          HTMLGenerationOptionsSchema.parse({
            mode: "production",
            config: {},
            nestedLayouts: [{ kind: "html", path: "layouts/main.html" }],
          }),
        Error,
      );
    });

    it("rejects unsupported nested layout kinds at the runtime boundary", () => {
      assertThrows(
        () =>
          generateHydrationData("page", {}, {}, {
            ...baseOptions,
            projectDir: "/project",
            nestedLayouts: [{ kind: "html", path: "/project/layout.html" }],
          } as never),
        TypeError,
        "layout kind",
      );
    });

    it("rejects excessive nested layout counts", () => {
      assertThrows(
        () =>
          generateHydrationData("page", {}, {}, {
            ...baseOptions,
            projectDir: "/project",
            nestedLayouts: Array.from({ length: 65 }, (_, index) => ({
              kind: "tsx" as const,
              path: `/project/layouts/${index}.tsx`,
            })),
          }),
        TypeError,
        "too many layouts",
      );
    });

    it("rejects hydration fields that exceed client-side count limits", () => {
      assertThrows(
        () =>
          generateHydrationData(
            "page",
            Object.fromEntries(
              Array.from({ length: 101 }, (_, index) => [`param-${index}`, "value"]),
            ),
            {},
            baseOptions,
          ),
        Error,
        "params",
      );
      assertThrows(
        () =>
          generateHydrationData("page", {}, {}, {
            ...baseOptions,
            headings: Array.from({ length: 1_001 }, (_, index) => ({
              id: `heading-${index}`,
              text: "Heading",
              level: 2,
            })),
          }),
        TypeError,
        "headings",
      );
      assertThrows(
        () =>
          generateHydrationData("page", {}, {}, {
            ...baseOptions,
            headings: [{ id: "invalid", text: "Invalid", level: 7 }],
          }),
        TypeError,
        "headings",
      );
    });

    it("rejects object fields that would produce client-invalid page data", () => {
      assertThrows(
        () =>
          generateHydrationData("page", {}, {}, {
            ...baseOptions,
            frontmatter: [] as never,
          }),
        TypeError,
        "frontmatter",
      );
      assertThrows(
        () =>
          generateHydrationData("page", {}, {}, {
            ...baseOptions,
            layoutProps: { "layouts/main.tsx": [] as never },
          }),
        TypeError,
        "layout props",
      );
      assertThrows(
        () =>
          generateHydrationData(
            "page",
            {},
            Object.fromEntries(
              Array.from({ length: 10_001 }, (_, index) => [`prop-${index}`, true]),
            ),
            baseOptions,
          ),
        TypeError,
        "props",
      );
    });

    it("rejects unsupported JSON values instead of silently changing them", () => {
      for (const value of [undefined, () => undefined, Symbol("value"), 1n, NaN, Infinity]) {
        assertThrows(
          () => generateHydrationData("page", {}, { value }, baseOptions),
          TypeError,
          "JSON-serializable",
        );
      }
    });

    it("rejects cyclic and excessively deep hydration values", () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      assertThrows(
        () => generateHydrationData("page", {}, cyclic, baseOptions),
        TypeError,
        "cycles",
      );

      const deeplyNested: Record<string, unknown> = {};
      let cursor = deeplyNested;
      for (let depth = 0; depth < 65; depth++) {
        const next: Record<string, unknown> = {};
        cursor.next = next;
        cursor = next;
      }
      assertThrows(
        () => generateHydrationData("page", {}, deeplyNested, baseOptions),
        TypeError,
        "depth limit",
      );
    });

    it("bounds nested hydration entries before serialization", () => {
      assertThrows(
        () =>
          generateHydrationData(
            "page",
            {},
            { nested: Array.from({ length: 10_001 }, () => true) },
            baseOptions,
          ),
        TypeError,
        "entry limit",
      );
    });

    it("does not execute hydration accessors or custom serializers", () => {
      let accessorCalls = 0;
      const accessorProps: Record<string, unknown> = {};
      Object.defineProperty(accessorProps, "value", {
        enumerable: true,
        get() {
          accessorCalls++;
          throw new Error("private accessor detail");
        },
      });
      assertThrows(
        () => generateHydrationData("page", {}, accessorProps, baseOptions),
        TypeError,
        "accessor properties",
      );
      assertEquals(accessorCalls, 0);

      let serializerCalls = 0;
      const customSerializer = {
        toJSON() {
          serializerCalls++;
          return "custom";
        },
      };
      assertThrows(
        () =>
          generateHydrationData(
            "page",
            {},
            { value: customSerializer },
            baseOptions,
          ),
        TypeError,
        "JSON-serializable",
      );
      assertEquals(serializerCalls, 0);
    });

    it("converts valid dates to their standard JSON representation", () => {
      const parsed = parseHydrationData(
        "page",
        {},
        { publishedAt: new Date("2026-01-02T03:04:05.000Z") },
        baseOptions,
      ) as { props: { publishedAt: string } };

      assertEquals(parsed.props.publishedAt, "2026-01-02T03:04:05.000Z");
    });

    it("converts inaccessible hydration records into typed failures", () => {
      const props = new Proxy({}, {
        ownKeys() {
          throw new Error("private proxy detail");
        },
      });
      const error = assertThrows(
        () => generateHydrationData("page", {}, props, baseOptions),
        TypeError,
        "cannot be inspected",
      );

      assertEquals(error.message.includes("private proxy detail"), false);
    });

    it("rejects module paths containing malformed or unsafe Unicode", () => {
      for (
        const options of [
          { pagePath: `pages/invalid-\ud800.tsx` },
          { appPath: `app/invalid-\udfff.tsx` },
          { nestedLayouts: [{ kind: "tsx" as const, path: "layouts/%e2%80%ae.tsx" }] },
        ]
      ) {
        assertThrows(
          () => parseHydrationData("page", {}, {}, { ...baseOptions, ...options }),
          TypeError,
          "path",
        );
      }
    });

    it("rejects hydration payloads larger than the client limit", () => {
      assertThrows(
        () =>
          generateHydrationData(
            "page",
            {},
            { value: "x".repeat(4 * 1024 * 1024) },
            baseOptions,
            { pretty: false },
          ),
        TypeError,
        "size limit",
      );
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
