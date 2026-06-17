import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import {
  buildImportMapJson,
  buildRootAttributes,
  clearImportMapCache,
  shouldDisableLayout,
} from "./utils.ts";
import { getDefaultImportMap } from "#veryfront/modules/import-map/default-import-map.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { VERYFRONT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";

describe("html-generation/utils", () => {
  const originalDependencyFlag = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);

  afterEach(() => {
    setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalDependencyFlag ?? "");
    clearImportMapCache();
  });

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

    it("should use one SSR module for head/router/context", () => {
      const map = getDefaultImportMap().imports;
      assert(map);

      assertEquals(
        map["veryfront/head"],
        "/_vf_modules/_veryfront/react/runtime/core.js?ssr=true",
      );
      assertEquals(map["veryfront/router"], map["veryfront/head"]);
      assertEquals(map["veryfront/context"], map["veryfront/head"]);
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

    it("should collapse head/router/context onto one core runtime module", async () => {
      const result = await buildImportMapJson();
      const imports = JSON.parse(result).imports as Record<string, string>;

      assertEquals(imports["veryfront/head"], "/_vf_modules/_veryfront/react/runtime/core.js");
      assertEquals(imports["veryfront/router"], imports["veryfront/head"]);
      assertEquals(imports["veryfront/context"], imports["veryfront/head"]);
    });

    it("should map workflow client imports to the React hooks submodule", async () => {
      const result = await buildImportMapJson();
      const imports = JSON.parse(result).imports as Record<string, string>;

      assertEquals(
        imports["veryfront/workflow"],
        "/_vf_modules/_veryfront/workflow/react/index.js",
      );
    });

    it("should map self-hosted workflow imports to the local lib handler", async () => {
      const result = await buildImportMapJson({
        config: { client: { moduleResolution: "self-hosted" } },
      });
      const imports = JSON.parse(result).imports as Record<string, string>;

      assertEquals(imports["veryfront/chat"], "/_veryfront/lib/chat.js");
      assertEquals(imports["veryfront/markdown"], "/_veryfront/lib/markdown.js");
      assertEquals(imports["veryfront/mdx"], "/_veryfront/lib/mdx.js");
      assertEquals(imports["veryfront/workflow"], "/_veryfront/lib/workflow.js");
    });

    it("should map non-default CDN providers to published npm ESM files", async () => {
      const result = await buildImportMapJson({
        config: { client: { cdn: { provider: "unpkg" } } },
      });
      const imports = JSON.parse(result).imports as Record<string, string>;

      assertStringIncludes(imports["veryfront/chat"]!, "/esm/src/chat/index.js");
      assertStringIncludes(imports["veryfront/markdown"]!, "/esm/src/markdown/index.js");
      assertStringIncludes(imports["veryfront/mdx"]!, "/esm/src/mdx/index.js");
      assertStringIncludes(imports["veryfront/workflow"]!, "/esm/src/workflow/react/index.js");
    });

    it("should format JSON with proper indentation", async () => {
      const result = await buildImportMapJson();

      assertStringIncludes(result, "\n");
      assertStringIncludes(result, "  ");
    });

    it("should support compact JSON output", async () => {
      const result = await buildImportMapJson({ pretty: false });

      assertEquals(result.includes("\n"), false);
    });

    it("keeps React import-map aliases on CDN URLs by default", async () => {
      const dependencies = Object.fromEntries(
        [
          "react",
          "react-dom",
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
        ].map((specifier, index) => [
          specifier,
          {
            contentHash: `${index + 1}`.repeat(64),
            size: 10,
            contentType: "text/javascript",
          },
        ]),
      );
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 1,
        projectId: "project-id",
        releaseId: "release-id",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "0.1.802",
        sourceContentHash: "source",
        createdAt: "2026-06-14T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {},
        css: [],
        routes: {},
        dependencies,
        fallback: { mode: "jit", gaps: [] },
      };

      const result = await buildImportMapJson({
        pretty: false,
        releaseAssetManifest: manifest,
      });
      const imports = JSON.parse(result).imports as Record<string, string>;

      assertStringIncludes(imports.react!, "https://esm.sh/react@");
      assertStringIncludes(imports["react-dom"]!, "https://esm.sh/react-dom@");
      assertStringIncludes(imports["react-dom/client"]!, "https://esm.sh/react-dom@");
      assertStringIncludes(imports["react/jsx-runtime"]!, "https://esm.sh/react@");
      assertStringIncludes(imports["react/jsx-dev-runtime"]!, "https://esm.sh/react@");
    });

    it("rewrites React import-map aliases from manifest dependency keys when explicitly enabled", async () => {
      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
      const dependencies = Object.fromEntries(
        [
          "react",
          "react-dom",
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
        ].map((specifier, index) => [
          specifier,
          {
            contentHash: `${index + 1}`.repeat(64),
            size: 10,
            contentType: "text/javascript",
          },
        ]),
      );
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 1,
        projectId: "project-id",
        releaseId: "release-id",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "0.1.802",
        sourceContentHash: "source",
        createdAt: "2026-06-14T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {},
        css: [],
        routes: {},
        dependencies,
        fallback: { mode: "jit", gaps: [] },
      };

      const result = await buildImportMapJson({
        pretty: false,
        releaseAssetManifest: manifest,
      });
      const imports = JSON.parse(result).imports as Record<string, string>;

      assertEquals(imports.react, `/_vf/assets/${"1".repeat(64)}.js`);
      assertEquals(imports["react-dom"], `/_vf/assets/${"2".repeat(64)}.js`);
      assertEquals(imports["react-dom/client"], `/_vf/assets/${"3".repeat(64)}.js`);
      assertEquals(imports["react/jsx-runtime"], `/_vf/assets/${"4".repeat(64)}.js`);
      assertEquals(imports["react/jsx-dev-runtime"], `/_vf/assets/${"5".repeat(64)}.js`);
    });

    it("rewrites local Veryfront import-map aliases from manifest dependency keys", async () => {
      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
      const headHash = "a".repeat(64);
      const workflowHash = "b".repeat(64);
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 1,
        projectId: "project-id",
        releaseId: "release-id",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "0.1.810",
        sourceContentHash: "source",
        createdAt: "2026-06-15T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {},
        css: [],
        routes: {},
        dependencies: {
          "veryfront/head": {
            contentHash: headHash,
            size: 10,
            contentType: "text/javascript",
          },
          "veryfront/react/head": {
            contentHash: headHash,
            size: 10,
            contentType: "text/javascript",
          },
          "veryfront/workflow": {
            contentHash: workflowHash,
            size: 10,
            contentType: "text/javascript",
          },
        },
        fallback: { mode: "jit", gaps: [] },
      };

      const result = await buildImportMapJson({
        pretty: false,
        releaseAssetManifest: manifest,
      });
      const imports = JSON.parse(result).imports as Record<string, string>;

      assertEquals(imports["veryfront/head"], `/_vf/assets/${headHash}.js`);
      assertEquals(imports["veryfront/react/head"], `/_vf/assets/${headHash}.js`);
      assertEquals(imports["veryfront/workflow"], `/_vf/assets/${workflowHash}.js`);
    });

    it("versions local module-server import-map aliases in release manifest context", async () => {
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 1,
        projectId: "project-id",
        releaseId: "release-id",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "0.1.810",
        sourceContentHash: "source",
        createdAt: "2026-06-15T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {},
        css: [],
        routes: {},
        dependencies: {},
        fallback: { mode: "jit", gaps: [] },
      };

      const result = await buildImportMapJson({
        pretty: false,
        releaseAssetManifest: manifest,
      });
      const imports = JSON.parse(result).imports as Record<string, string>;

      assertEquals(
        imports["veryfront/router"],
        `/_vf_modules/_veryfront/react/runtime/core.js?vf_release=release-id&vf_runtime=${VERYFRONT_VERSION}`,
      );
      assertEquals(imports["@/"], "/_vf_modules/");
    });

    it("refreshes cached import maps when project package versions change", async () => {
      const dir = await Deno.makeTempDir({ prefix: "vf-import-map-cache-" });

      try {
        const packageJsonPath = `${dir}/package.json`;
        await Deno.writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { react: "^18.3.1", veryfront: "^0.1.10" } }),
        );

        const first = JSON.parse(
          await buildImportMapJson({
            projectDir: dir,
            pretty: false,
            config: { client: { cdn: { provider: "unpkg" } } },
          }),
        ) as {
          imports: Record<string, string>;
        };
        assertStringIncludes(first.imports.react!, "18.3.1");
        assertStringIncludes(first.imports["veryfront/chat"]!, "0.1.10");

        await new Promise((resolve) => setTimeout(resolve, 5));
        await Deno.writeTextFile(
          packageJsonPath,
          JSON.stringify({ dependencies: { react: "^19.0.0", veryfront: "^0.2.0" } }),
        );

        const second = JSON.parse(
          await buildImportMapJson({
            projectDir: dir,
            pretty: false,
            config: { client: { cdn: { provider: "unpkg" } } },
          }),
        ) as {
          imports: Record<string, string>;
        };
        assertStringIncludes(second.imports.react!, "19.0.0");
        assertStringIncludes(second.imports["veryfront/chat"]!, "0.2.0");
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
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
