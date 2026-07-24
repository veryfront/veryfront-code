import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { ModuleResolver } from "./module-resolver.ts";

describe("modules/module-resolver", () => {
  function createResolver(
    opts: {
      projectDir?: string;
      importMap?: Record<string, string>;
      virtualModules?: Map<string, string>;
      files?: Record<string, string>;
    } = {},
  ): ModuleResolver {
    const adapter = createMockAdapter();
    const projectDir = opts.projectDir ?? "/project";

    for (const [path, content] of Object.entries(opts.files ?? {})) {
      adapter.fs.files.set(path, content);
    }

    return new ModuleResolver({
      projectDir,
      adapter,
      importMap: opts.importMap,
      virtualModules: opts.virtualModules,
    });
  }

  describe("resolve - virtual modules", () => {
    it("should resolve virtual modules", async () => {
      const resolver = createResolver({
        virtualModules: new Map([["virtual:theme", "export const theme = {}"]]),
      });

      const result = await resolver.resolve("virtual:theme");
      assertEquals(result?.type, "virtual");
      assertEquals(result?.content, "export const theme = {}");
      assertEquals(result?.transformed, true);
      assertEquals(result?.path, "virtual:theme");
    });

    it("should return virtual module for empty string content", async () => {
      const resolver = createResolver({
        virtualModules: new Map([["virtual:empty", ""]]),
      });

      const result = await resolver.resolve("virtual:empty");
      assertEquals(result?.type, "virtual");
      assertEquals(result?.content, "");
    });
  });

  describe("resolve - import map", () => {
    it("should resolve import map entries to external URLs", async () => {
      const resolver = createResolver({
        importMap: { react: "https://esm.sh/react@18" },
      });

      const result = await resolver.resolve("react");
      assertEquals(result?.type, "external");
      assertEquals(result?.path, "https://esm.sh/react@18");
    });

    it("should resolve import map entries with http URLs", async () => {
      const resolver = createResolver({
        importMap: { "my-lib": "http://localhost:3000/my-lib.js" },
      });

      const result = await resolver.resolve("my-lib");
      assertEquals(result?.type, "external");
      assertEquals(result?.path, "http://localhost:3000/my-lib.js");
    });

    it("should resolve import map entries to file paths", async () => {
      const resolver = createResolver({
        projectDir: "/project",
        importMap: { "my-utils": "./src/utils.ts" },
        files: { "/project/src/utils.ts": "export const x = 1;" },
      });

      const result = await resolver.resolve("my-utils");
      assertEquals(result?.type, "file");
      assertEquals(result?.path, "/project/src/utils.ts");
    });
  });

  describe("resolve - relative paths", () => {
    it("should resolve relative imports from project root", async () => {
      const resolver = createResolver({
        projectDir: "/project",
        files: { "/project/utils.ts": "export const x = 1;" },
      });

      const result = await resolver.resolve("./utils.ts");
      assertEquals(result?.type, "file");
      assertEquals(result?.path, "/project/utils.ts");
    });

    it("should resolve relative imports with referrer", async () => {
      const resolver = createResolver({
        projectDir: "/project",
        files: { "/project/src/helpers.ts": "export const h = 1;" },
      });

      const result = await resolver.resolve("./helpers.ts", "/project/src/index.ts");
      assertEquals(result?.type, "file");
      assertEquals(result?.path, "/project/src/helpers.ts");
    });

    it("should resolve parent relative imports with referrer", async () => {
      const resolver = createResolver({
        projectDir: "/project",
        files: { "/project/shared/utils.ts": "export const u = 1;" },
      });

      const result = await resolver.resolve("../shared/utils.ts", "/project/src/index.ts");
      assertEquals(result?.type, "file");
      assertEquals(result?.path, "/project/shared/utils.ts");
    });

    it("should try extensions when resolving relative paths", async () => {
      const resolver = createResolver({
        projectDir: "/project",
        files: { "/project/utils.tsx": "export default () => null;" },
      });

      const result = await resolver.resolve("./utils");
      assertEquals(result?.type, "file");
      assertEquals(result?.path, "/project/utils.tsx");
    });

    it("should return null for unresolvable relative paths", async () => {
      const resolver = createResolver({ projectDir: "/project" });

      const result = await resolver.resolve("./nonexistent");
      assertEquals(result, null);
    });
  });

  describe("resolve - absolute paths", () => {
    it("should resolve absolute paths within project", async () => {
      const resolver = createResolver({
        projectDir: "/project",
        files: { "/project/components/Button.tsx": "export default () => null;" },
      });

      const result = await resolver.resolve("/components/Button.tsx");
      assertEquals(result?.type, "file");
      assertEquals(result?.path, "/project/components/Button.tsx");
    });

    it("should block path traversal attempts", async () => {
      const resolver = createResolver({ projectDir: "/project" });

      const result = await resolver.resolve("/../../etc/passwd");
      assertEquals(result, null);
    });

    it("should return null for absolute paths to nonexistent files", async () => {
      const resolver = createResolver({ projectDir: "/project" });

      const result = await resolver.resolve("/missing.ts");
      assertEquals(result, null);
    });
  });

  describe("resolve - bare specifiers (npm)", () => {
    it("should resolve bare specifiers as npm packages", async () => {
      const resolver = createResolver();

      const result = await resolver.resolve("lodash");
      assertEquals(result?.type, "npm");
      assertEquals(result?.path, "https://esm.sh/lodash");
    });

    it("should resolve scoped npm packages", async () => {
      const resolver = createResolver();

      const result = await resolver.resolve("@org/package");
      assertEquals(result?.type, "npm");
      assertEquals(result?.path, "https://esm.sh/@org/package");
    });
  });

  describe("caching", () => {
    it("should cache resolved modules", async () => {
      const resolver = createResolver({
        virtualModules: new Map([["virtual:cached", "code"]]),
      });

      const result1 = await resolver.resolve("virtual:cached");
      const result2 = await resolver.resolve("virtual:cached");
      assertEquals(result1, result2);
    });

    it("should clear entire cache", async () => {
      const resolver = createResolver({
        virtualModules: new Map([["virtual:a", "a"]]),
      });

      await resolver.resolve("virtual:a");
      resolver.clearCache();

      const result = await resolver.resolve("virtual:a");
      assertEquals(result?.content, "a");
    });

    it("should clear cache by pattern", async () => {
      const virtualModules = new Map([
        ["virtual:theme", "theme"],
        ["virtual:utils", "utils"],
      ]);
      const resolver = createResolver({
        virtualModules,
      });

      await resolver.resolve("virtual:theme");
      await resolver.resolve("virtual:utils");
      virtualModules.set("virtual:theme", "theme-updated");
      virtualModules.set("virtual:utils", "utils-updated");

      resolver.clearCache("theme");

      const theme = await resolver.resolve("virtual:theme");
      const utils = await resolver.resolve("virtual:utils");
      assertEquals(theme?.content, "theme-updated");
      assertEquals(utils?.content, "utils");
    });

    it("should clear only referrer-matched cache entries", async () => {
      const virtualModules = new Map([["virtual:shared", "old"]]);
      const resolver = createResolver({ virtualModules });

      await resolver.resolve("virtual:shared", "/project/theme.ts");
      await resolver.resolve("virtual:shared", "/project/utils.ts");
      virtualModules.set("virtual:shared", "new");

      resolver.clearCache("theme.ts");

      const theme = await resolver.resolve("virtual:shared", "/project/theme.ts");
      const utils = await resolver.resolve("virtual:shared", "/project/utils.ts");
      assertEquals(theme?.content, "new");
      assertEquals(utils?.content, "old");
    });
  });

  describe("virtual module management", () => {
    it("should add virtual modules at runtime", async () => {
      const resolver = createResolver();

      resolver.addVirtualModule("virtual:runtime", "export const x = 42;");

      const result = await resolver.resolve("virtual:runtime");
      assertEquals(result?.type, "virtual");
      assertEquals(result?.content, "export const x = 42;");
    });

    it("should remove virtual modules", async () => {
      const resolver = createResolver({
        virtualModules: new Map([["virtual:removable", "code"]]),
      });

      await resolver.resolve("virtual:removable");
      resolver.removeVirtualModule("virtual:removable");

      const result = await resolver.resolve("virtual:removable");
      assertEquals(result?.type, "npm");
    });

    it("should invalidate all referrer-specific entries when updating a virtual module", async () => {
      const resolver = createResolver({
        virtualModules: new Map([["virtual:mutable", "old"]]),
      });

      await resolver.resolve("virtual:mutable", "/project/a.ts");
      await resolver.resolve("virtual:mutable", "/project/b.ts");
      resolver.addVirtualModule("virtual:mutable", "new");

      const resultA = await resolver.resolve("virtual:mutable", "/project/a.ts");
      const resultB = await resolver.resolve("virtual:mutable", "/project/b.ts");
      assertEquals(resultA?.content, "new");
      assertEquals(resultB?.content, "new");
    });
  });
});
