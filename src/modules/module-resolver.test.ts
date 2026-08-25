import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors/error-registry/general.ts";
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

    it("should block relative imports that escape the project root", async () => {
      const resolver = createResolver({
        projectDir: "/project",
        files: { "/outside.ts": "export const secret = true;" },
      });

      const result = await resolver.resolve("../../outside.ts", "/project/src/index.ts");

      assertEquals(result, null);
    });

    it("should block relative imports that escape through a symlink", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Linked.tsx",
        "export default function Linked() {}",
      );
      Reflect.deleteProperty(adapter.fs, "symlinkSemantics");
      adapter.fs.realPath = (path: string) => {
        if (path === "/project") return Promise.resolve("/canonical/project");
        if (path === "/project/components/Linked.tsx") {
          return Promise.resolve("/canonical/outside/Linked.tsx");
        }
        return Promise.resolve(path);
      };
      const resolver = new ModuleResolver({ projectDir: "/project", adapter });

      const result = await resolver.resolve(
        "./components/Linked.tsx",
        "/project/index.ts",
      );

      assertEquals(result, null);
    });

    it("should cache the canonical file path instead of a retargetable symlink path", async () => {
      const adapter = createMockAdapter();
      const linkedPath = "/project/components/Linked.tsx";
      const canonicalPath = "/canonical/project/components/Linked.tsx";
      adapter.fs.files.set(linkedPath, "export default function Linked() {}");
      Reflect.deleteProperty(adapter.fs, "symlinkSemantics");
      let canonicalCandidate = canonicalPath;
      adapter.fs.realPath = (path: string) => {
        if (path === "/project") return Promise.resolve("/canonical/project");
        if (path === linkedPath) return Promise.resolve(canonicalCandidate);
        return Promise.resolve(path);
      };
      const resolver = new ModuleResolver({ projectDir: "/project", adapter });

      const first = await resolver.resolve("./components/Linked.tsx", "/project/index.ts");
      canonicalCandidate = "/canonical/outside/Secret.tsx";
      const cached = await resolver.resolve("./components/Linked.tsx", "/project/index.ts");

      assertEquals(first?.path, canonicalPath);
      assertStrictEquals(
        cached,
        first,
        "the cached result must retain the verified canonical path",
      );
    });

    it("should normalize native Windows canonical paths before returning them", async () => {
      const adapter = createMockAdapter();
      const projectDir = "C:/project";
      const componentPath = `${projectDir}/components/Button.tsx`;
      adapter.fs.files.set(componentPath, "export default function Button() {}");
      Reflect.deleteProperty(adapter.fs, "symlinkSemantics");
      adapter.fs.realPath = (path: string) => {
        if (path === projectDir) return Promise.resolve("C:\\project");
        if (path === componentPath) {
          return Promise.resolve("C:\\project\\components\\Button.tsx");
        }
        return Promise.resolve(path);
      };
      const resolver = new ModuleResolver({ projectDir, adapter });

      const result = await resolver.resolve("./components/Button.tsx", `${projectDir}/index.ts`);

      assertEquals(result?.path, componentPath);
    });

    it("should propagate canonicalization failures", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/project/components/Button.tsx", "export default function Button() {}");
      Reflect.deleteProperty(adapter.fs, "symlinkSemantics");
      const failure = {
        code: "ENOENT",
        message: "canonical path backend unavailable",
      };
      adapter.fs.realPath = () => Promise.reject(failure);
      const resolver = new ModuleResolver({ projectDir: "/project", adapter });

      const error = await assertRejects(() =>
        resolver.resolve("./components/Button.tsx", "/project/index.ts")
      );

      assertEquals(error, failure);
    });

    it("should propagate an operational canonicalization failure masked by a concurrent not-found", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/project/components/Button.tsx", "export default function Button() {}");
      Reflect.deleteProperty(adapter.fs, "symlinkSemantics");
      const failure = new Error("canonical path backend unavailable");
      adapter.fs.realPath = (path: string) => {
        if (path === "/project") {
          return Promise.resolve().then(() => Promise.reject(failure));
        }
        return Promise.reject(
          FILE_NOT_FOUND.create({
            detail: "File not found during canonicalization",
            context: { operation: "realPath" },
          }),
        );
      };
      const resolver = new ModuleResolver({ projectDir: "/project", adapter });

      const error = await assertRejects(() =>
        resolver.resolve("./components/Button.tsx", "/project/index.ts")
      );

      assertEquals(
        error,
        failure,
        "an operational realPath failure must surface even when the other realPath call rejects with not-found first",
      );
    });

    it("should return null when a file disappears during canonicalization", async () => {
      const adapter = createMockAdapter();
      const componentPath = "/project/components/Button.tsx";
      adapter.fs.files.set(componentPath, "export default function Button() {}");
      Reflect.deleteProperty(adapter.fs, "symlinkSemantics");
      adapter.fs.realPath = (path: string) => {
        if (path === "/project") return Promise.resolve(path);
        return Promise.reject(
          FILE_NOT_FOUND.create({
            detail: "File not found during canonicalization",
            context: { operation: "realPath" },
          }),
        );
      };
      const resolver = new ModuleResolver({ projectDir: "/project", adapter });

      const result = await resolver.resolve(
        "./components/Button.tsx",
        "/project/index.ts",
      );

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
      const resolver = createResolver({
        projectDir: "/project",
        files: {
          "/etc/passwd": "root:x:0:0",
          "/project/components/Button.tsx": "export default () => null;",
        },
      });

      assertEquals(
        await resolver.resolve("/../../etc/passwd"),
        null,
        "traversal guard must reject an escaping absolute specifier even when the target exists",
      );
      assertEquals(
        (await resolver.resolve("/components/Button.tsx"))?.path,
        "/project/components/Button.tsx",
        "in-project absolute specifier still resolves",
      );
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
      assertStrictEquals(result1, result2, "second resolve must return the cached instance");
    });

    it("should clear entire cache", async () => {
      const virtualModules = new Map([["virtual:a", "a"]]);
      const resolver = createResolver({ virtualModules });

      const first = await resolver.resolve("virtual:a");
      assertEquals(first?.content, "a", "first resolve serves the original virtual module");

      virtualModules.set("virtual:a", "b");
      resolver.clearCache();

      const result = await resolver.resolve("virtual:a");
      assertEquals(
        result?.content,
        "b",
        "clearCache() with no pattern must drop every cached entry",
      );
    });

    it("should clear cache by pattern", async () => {
      const resolver = createResolver({
        virtualModules: new Map([
          ["virtual:theme", "theme"],
          ["virtual:utils", "utils"],
        ]),
      });

      await resolver.resolve("virtual:theme");
      await resolver.resolve("virtual:utils");

      resolver.clearCache("theme");

      const theme = await resolver.resolve("virtual:theme");
      const utils = await resolver.resolve("virtual:utils");
      assertEquals(theme?.content, "theme");
      assertEquals(utils?.content, "utils");
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

      resolver.removeVirtualModule("virtual:removable");

      const result = await resolver.resolve("virtual:removable");
      assertEquals(result?.type, "npm");
    });

    it("should invalidate cache when adding virtual module", async () => {
      const resolver = createResolver({
        virtualModules: new Map([["virtual:mutable", "old"]]),
      });

      await resolver.resolve("virtual:mutable");
      resolver.addVirtualModule("virtual:mutable", "new");

      const result = await resolver.resolve("virtual:mutable");
      assertEquals(result?.content, "new");
    });
  });
});
