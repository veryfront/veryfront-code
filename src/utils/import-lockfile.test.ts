import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  computeIntegrity,
  createEmptyLockfile,
  createLockfileManager,
  extractImports,
  fetchWithLock,
  type FSAdapter,
  resolveImportUrl,
  verifyIntegrity,
} from "./import-lockfile.ts";

function createMockFS(files: Record<string, string> = {}): FSAdapter {
  const store = new Map<string, string>(Object.entries(files));

  return {
    readFile: (path: string) => {
      const content = store.get(path);
      if (content == null) return Promise.reject(new Error("ENOENT"));
      return Promise.resolve(content);
    },
    writeFile: (path: string, content: string) => {
      store.set(path, content);
      return Promise.resolve();
    },
    exists: (path: string) => Promise.resolve(store.has(path)),
    remove: (path: string) => {
      store.delete(path);
      return Promise.resolve();
    },
  };
}

describe("import-lockfile", () => {
  describe("createEmptyLockfile", () => {
    it("should create lockfile with version 1 and empty imports", () => {
      const lockfile = createEmptyLockfile();
      assertEquals(lockfile.version, 1);
      assertEquals(lockfile.imports, {});
    });
  });

  describe("computeIntegrity", () => {
    it("should return sha256- prefixed hash", async () => {
      const integrity = await computeIntegrity("hello world");
      assertEquals(integrity.startsWith("sha256-"), true);
      assertEquals(integrity.length, 7 + 64);
    });

    it("should produce consistent output", async () => {
      const [i1, i2] = await Promise.all([computeIntegrity("test"), computeIntegrity("test")]);
      assertEquals(i1, i2);
    });
  });

  describe("verifyIntegrity", () => {
    it("should return true for matching content", async () => {
      const integrity = await computeIntegrity("test content");
      assertEquals(await verifyIntegrity("test content", integrity), true);
    });

    it("should return false for mismatched content", async () => {
      const integrity = await computeIntegrity("original");
      assertEquals(await verifyIntegrity("modified", integrity), false);
    });
  });

  describe("extractImports", () => {
    it("should extract static imports", () => {
      const code = `import { foo } from "react";\nimport bar from "./bar.ts";`;
      const imports = extractImports(code);

      assertEquals(imports.length, 2);

      const [first, second] = imports;
      assertExists(first);
      assertExists(second);

      assertEquals(first.specifier, "react");
      assertEquals(first.type, "static");
      assertEquals(second.specifier, "./bar.ts");
    });

    it("should extract dynamic imports", () => {
      const code = `const mod = await import("./dynamic.ts");`;
      const imports = extractImports(code);

      assertEquals(imports.length, 1);

      const [first] = imports;
      assertExists(first);
      assertEquals(first.specifier, "./dynamic.ts");
      assertEquals(first.type, "dynamic");
    });

    it("should extract export-from statements", () => {
      const code = `export { foo } from "./foo.ts";`;
      const imports = extractImports(code);

      assertEquals(imports.length, 1);

      const [first] = imports;
      assertExists(first);
      assertEquals(first.specifier, "./foo.ts");
      assertEquals(first.type, "static");
    });

    it("should deduplicate specifiers", () => {
      const code = `import { a } from "react";\nimport { b } from "react";`;
      assertEquals(extractImports(code).length, 1);
    });

    it("should return empty array for no imports", () => {
      assertEquals(extractImports("const x = 1;"), []);
    });
  });

  describe("resolveImportUrl", () => {
    it("should return http URLs as-is", () => {
      assertEquals(
        resolveImportUrl("http://example.com/mod.ts", "https://base.com/"),
        "http://example.com/mod.ts",
      );
    });

    it("should return https URLs as-is", () => {
      assertEquals(
        resolveImportUrl("https://cdn.com/mod.ts", "https://base.com/"),
        "https://cdn.com/mod.ts",
      );
    });

    it("should resolve relative paths against base URL", () => {
      assertEquals(
        resolveImportUrl("./utils.ts", "https://cdn.com/dir/main.ts"),
        "https://cdn.com/dir/utils.ts",
      );
    });

    it("should resolve parent paths against base URL", () => {
      assertEquals(
        resolveImportUrl("../lib.ts", "https://cdn.com/dir/sub/main.ts"),
        "https://cdn.com/dir/lib.ts",
      );
    });

    it("should return null for bare specifiers", () => {
      assertEquals(resolveImportUrl("react", "https://base.com/"), null);
    });

    it("should return null for node: specifiers", () => {
      assertEquals(resolveImportUrl("node:fs", "https://base.com/"), null);
    });
  });

  describe("createLockfileManager", () => {
    it("should return null for read when no lockfile exists", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      assertEquals(await mgr.read(), null);
    });

    it("should read existing lockfile", async () => {
      const data = {
        version: 1,
        imports: {
          "https://cdn.com/mod.ts": {
            resolved: "https://cdn.com/mod.ts",
            integrity: "sha256-abc",
          },
        },
      };
      const fs = createMockFS({ "/project/veryfront.lock": JSON.stringify(data) });
      const mgr = createLockfileManager("/project", fs);

      const result = await mgr.read();
      assertEquals(result?.version, 1);
      assertEquals(Object.keys(result!.imports).length, 1);
    });

    it("should set and get entries", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-abc",
      });

      const entry = await mgr.get("https://cdn.com/mod.ts");
      assertEquals(entry?.resolved, "https://cdn.com/mod.ts");
      assertEquals(entry?.integrity, "sha256-abc");
    });

    it("should report has correctly", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const specifier = "https://cdn.com/mod.ts";

      assertEquals(await mgr.has(specifier), false);

      await mgr.set(specifier, { resolved: specifier, integrity: "sha256-abc" });
      assertEquals(await mgr.has(specifier), true);
    });

    it("should clear lockfile data", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const specifier = "https://cdn.com/mod.ts";

      await mgr.set(specifier, { resolved: specifier, integrity: "sha256-abc" });
      await mgr.clear();

      assertEquals(await mgr.has(specifier), false);
    });

    it("should flush dirty data to disk", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);

      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-abc",
      });
      await mgr.flush();

      assertEquals(await fs.exists("/project/veryfront.lock"), true);
    });

    it("should not flush when not dirty", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);

      await mgr.flush();
      assertEquals(await fs.exists("/project/veryfront.lock"), false);
    });

    it("should reset to empty lockfile on version mismatch", async () => {
      const data = { version: 99, imports: { x: { resolved: "x", integrity: "y" } } };
      const fs = createMockFS({ "/project/veryfront.lock": JSON.stringify(data) });
      const mgr = createLockfileManager("/project", fs);

      const result = await mgr.read();
      assertEquals(result?.version, 1);
      assertEquals(Object.keys(result!.imports).length, 0);
    });
  });

  describe("fetchWithLock", () => {
    it("should return cached content when integrity matches", async () => {
      const url = "https://cdn.com/mod.ts";
      const resolved = "https://esm.sh/mod.ts";
      const content = "export const value = 1;";
      const integrity = await computeIntegrity(content);
      const mgr = createLockfileManager("/project", createMockFS());

      await mgr.set(url, { resolved, integrity });

      const result = await fetchWithLock({
        lockfile: mgr,
        url,
        fetchFn: (input: string | URL | Request) => {
          assertEquals(String(input), resolved);
          return Promise.resolve(new Response(content, { status: 200 }));
        },
      });

      assertEquals(result.fromCache, true);
      assertEquals(result.resolvedUrl, resolved);
      assertEquals(result.content, content);
      assertEquals(result.integrity, integrity);
    });

    it("should fetch fresh content and persist the resolved entry on cache miss", async () => {
      const url = "https://cdn.com/mod.ts";
      const content = "export const value = 2;";
      const mgr = createLockfileManager("/project", createMockFS());

      const result = await fetchWithLock({
        lockfile: mgr,
        url,
        fetchFn: (input: string | URL | Request) => {
          assertEquals(String(input), url);
          return Promise.resolve(new Response(content, { status: 200 }));
        },
      });

      const saved = await mgr.get(url);
      assertExists(saved);
      assertEquals(result.fromCache, false);
      assertEquals(result.resolvedUrl, url);
      assertEquals(result.content, content);
      assertEquals(saved.resolved, url);
      assertEquals(saved.integrity, result.integrity);
    });

    it("should throw in strict mode when cached integrity mismatches", async () => {
      const url = "https://cdn.com/mod.ts";
      const mgr = createLockfileManager("/project", createMockFS());

      await mgr.set(url, {
        resolved: url,
        integrity: await computeIntegrity("old"),
      });

      await assertRejects(
        () =>
          fetchWithLock({
            lockfile: mgr,
            url,
            strict: true,
            fetchFn: () => Promise.resolve(new Response("new", { status: 200 })),
          }),
        Error,
        "Integrity mismatch",
      );
    });
  });
});
