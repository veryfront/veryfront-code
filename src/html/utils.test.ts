import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import {
  buildImportMap,
  buildImportMapJson,
  buildRootAttributes,
  clearImportMapCache,
  PLATFORM_UTILITIES,
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
      const result = buildRootAttributes(
        '<script>alert("xss")</script>',
        "development",
        false,
      );

      assert(!result.includes("<script>"));
      assertStringIncludes(result, "&lt;script&gt;");
    });

    it("should handle empty slug", () => {
      const result = buildRootAttributes("", "development", false);

      assertStringIncludes(result, 'data-veryfront-slug=""');
    });

    it("rejects unsupported runtime modes", () => {
      assertThrows(
        () => buildRootAttributes("test", "preview" as never, false),
        TypeError,
        "mode",
      );
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
    it("rejects unsupported module-resolution modes", async () => {
      await assertRejects(
        () =>
          buildImportMapJson({
            config: { client: { moduleResolution: "fallback" } },
          } as never),
        Error,
        "module resolution mode",
      );
    });

    it("rejects unsupported CDN providers instead of silently using esm.sh", async () => {
      await assertRejects(
        () =>
          buildImportMapJson({
            config: { client: { cdn: { provider: "unknown" } } },
          } as never),
        Error,
        "CDN provider",
      );
    });

    it("rejects malformed custom import-map values", async () => {
      await assertRejects(
        () => buildImportMapJson({ invalid: 42 } as never),
        Error,
        "import-map value",
      );
    });

    it("enforces per-entry import-map limits in UTF-8 bytes", async () => {
      await assertRejects(
        () => buildImportMapJson({ ["é".repeat(4_096)]: "/module.js" }),
        Error,
        "specifier",
      );
      await assertRejects(
        () => buildImportMapJson({ module: "é".repeat(4_096) }),
        Error,
        "value",
      );
    });

    it("converts inaccessible custom import maps into typed validation failures", async () => {
      const inaccessibleMap = new Proxy({}, {
        ownKeys() {
          throw new Error("private implementation detail");
        },
      });
      await assertRejects(
        () => buildImportMapJson(inaccessibleMap as Record<string, string>),
        Error,
        "cannot be inspected",
      );

      const inaccessibleEntry = {} as Record<string, string>;
      Object.defineProperty(inaccessibleEntry, "module", {
        enumerable: true,
        get() {
          throw new Error("private implementation detail");
        },
      });
      await assertRejects(
        () => buildImportMapJson(inaccessibleEntry),
        Error,
        "entry cannot be inspected",
      );
    });

    it("rejects excessive custom import-map entries", async () => {
      const imports = Object.fromEntries(
        Array.from(
          { length: 1025 },
          (_, index) => [`package-${index}`, `/modules/package-${index}.js`],
        ),
      );

      await assertRejects(
        () => buildImportMapJson(imports),
        Error,
        "entry limit",
      );
    });

    it("rejects custom import maps beyond the aggregate byte budget", async () => {
      const imports = Object.fromEntries(
        Array.from(
          { length: 300 },
          (_, index) => [`package-${index}`, `/${"x".repeat(4090)}${index}`],
        ),
      );

      await assertRejects(
        () => buildImportMapJson(imports),
        Error,
        "byte budget",
      );
    });

    it("does not let callers mutate cached import maps", async () => {
      const first = await buildImportMap({ pretty: false });
      const originalReact = first.imports.react;
      first.imports.react = "https://attacker.invalid/react.js";

      const second = await buildImportMap({ pretty: false });

      assertEquals(second.imports.react, originalReact);
    });

    it("does not expose internal cache keys in public results", async () => {
      const result = await buildImportMap({ pretty: false });

      assertEquals(Object.hasOwn(result, "cacheKey"), false);
    });

    it("publishes an immutable platform utility map", () => {
      assertEquals(Object.isFrozen(PLATFORM_UTILITIES), true);
    });

    it("should build import map JSON with custom imports", async () => {
      const customMap = { "custom-lib": "https://cdn.example.com/lib.js" };
      const result = await buildImportMapJson(customMap);

      assertStringIncludes(result, '"imports"');
      assertStringIncludes(result, '"custom-lib"');
      assertStringIncludes(result, "https://cdn.example.com/lib.js");
    });

    it("should escape script-closing sequences without changing import values", async () => {
      const hostileImport =
        "</script><script>globalThis.__veryfrontImportMapBreakout = true</script>";
      const result = await buildImportMapJson({ hostile: hostileImport });

      assertEquals(result.toLowerCase().includes("</script"), false);
      assertStringIncludes(result, "\\u003c/script");
      assertEquals(JSON.parse(result).imports.hostile, hostileImport);
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

    it("does not execute release manifest accessors", async () => {
      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
      let dependencyReads = 0;
      const changingManifest = {
        releaseId: "release-id",
        get dependencies() {
          dependencyReads++;
          return {};
        },
      } as never;

      await assertRejects(
        () =>
          buildImportMap({
            pretty: false,
            releaseAssetManifest: changingManifest,
          }),
        TypeError,
        "Release manifest must not contain accessor properties",
      );
      assertEquals(dependencyReads, 0);
    });

    it("rejects manifest dependency entries with invalid content hashes", async () => {
      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
      const manifest = {
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
        dependencies: {
          react: {
            contentHash: "../invalid",
            size: 10,
            contentType: "text/javascript",
          },
        },
        fallback: { mode: "jit", gaps: [] },
      } as ReleaseAssetManifest;

      await assertRejects(
        () =>
          buildImportMapJson({
            pretty: false,
            releaseAssetManifest: manifest,
          }),
        Error,
        "dependency entry is invalid",
      );
    });

    it("does not execute manifest dependency entry accessors", async () => {
      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
      let accessorCalls = 0;
      const entry: Record<string, unknown> = {
        size: 1,
        contentType: "text/javascript",
      };
      Object.defineProperty(entry, "contentHash", {
        enumerable: true,
        get() {
          accessorCalls++;
          return "a".repeat(64);
        },
      });

      await assertRejects(
        () =>
          buildImportMapJson({
            pretty: false,
            releaseAssetManifest: {
              releaseId: "release-id",
              dependencies: { react: entry },
            } as never,
          }),
        TypeError,
        "dependency entry must not contain accessor properties",
      );
      assertEquals(accessorCalls, 0);
    });

    it("rejects manifest dependency collections beyond the resource limit", async () => {
      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
      const dependencies = Object.fromEntries(
        Array.from({ length: 10_001 }, (_, index) => [
          `dependency-${index}`,
          {
            contentHash: "a".repeat(64),
            size: 1,
            contentType: "text/javascript",
          },
        ]),
      );

      await assertRejects(
        () =>
          buildImportMapJson({
            pretty: false,
            releaseAssetManifest: {
              releaseId: "release-id",
              dependencies,
            } as never,
          }),
        Error,
        "dependency collection exceeds",
      );
    });

    it("rejects manifest dependency collections that cannot be inspected", async () => {
      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
      const dependencies = new Proxy({}, {
        ownKeys() {
          throw new Error("private implementation detail");
        },
      });

      await assertRejects(
        () =>
          buildImportMapJson({
            pretty: false,
            releaseAssetManifest: {
              releaseId: "release-id",
              dependencies,
            } as never,
          }),
        Error,
        "dependency collection cannot be inspected",
      );
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

    it("rejects oversized release IDs before import-map URL construction", async () => {
      await assertRejects(
        () =>
          buildImportMapJson({
            pretty: false,
            releaseAssetManifest: {
              releaseId: "r".repeat(257),
              dependencies: {},
            } as never,
          }),
        Error,
        "release ID",
      );
    });

    it("rejects oversized release IDs even when no local import needs versioning", async () => {
      await assertRejects(
        () =>
          buildImportMapJson({
            pretty: false,
            config: { client: { moduleResolution: "bundled" } },
            releaseAssetManifest: {
              releaseId: "r".repeat(257),
              dependencies: {},
            } as never,
          }),
        Error,
        "release ID",
      );
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

    it("prefers the public React version config over package detection", async () => {
      const dir = await Deno.makeTempDir({ prefix: "vf-import-map-react-config-" });

      try {
        await Deno.writeTextFile(
          `${dir}/package.json`,
          JSON.stringify({ dependencies: { react: "^19.1.0" } }),
        );

        const result = await buildImportMapJson({
          projectDir: dir,
          pretty: false,
          config: {
            react: { version: "18.3.1" },
            client: { cdn: { provider: "unpkg" } },
          },
        });
        const imports = JSON.parse(result).imports as Record<string, string>;

        assertStringIncludes(imports.react!, "react@18.3.1");
        assertStringIncludes(imports["react-dom"]!, "react-dom@18.3.1");
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });

    it("honors the public React version config without a project directory", async () => {
      const result = await buildImportMapJson({
        pretty: false,
        config: {
          react: { version: "18.3.1" },
          client: { cdn: { provider: "unpkg" } },
        },
      });
      const imports = JSON.parse(result).imports as Record<string, string>;

      assertStringIncludes(imports.react!, "react@18.3.1");
      assertStringIncludes(imports["react-dom"]!, "react-dom@18.3.1");
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

    it("does not execute frontmatter accessors", () => {
      let accessorCalls = 0;
      const frontmatter: Record<string, unknown> = {};
      Object.defineProperty(frontmatter, "layout", {
        enumerable: true,
        get() {
          accessorCalls++;
          return false;
        },
      });

      assertThrows(
        () => shouldDisableLayout(frontmatter),
        TypeError,
        "frontmatter must not contain accessor properties",
      );
      assertEquals(accessorCalls, 0);
    });
  });
});
