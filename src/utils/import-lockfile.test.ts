import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  computeIntegrity,
  createEmptyLockfile,
  createLockfileManager,
  extractImports,
  type FSAdapter,
  resolveImportUrl,
  verifyIntegrity,
} from "./import-lockfile.ts";

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
      assertEquals(integrity.length, 7 + 64); // "sha256-" + 64 hex chars
    });

    it("should produce consistent output", async () => {
      const i1 = await computeIntegrity("test");
      const i2 = await computeIntegrity("test");
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
      const first = imports[0];
      const second = imports[1];
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
      const first = imports[0];
      assertExists(first);
      assertEquals(first.specifier, "./dynamic.ts");
      assertEquals(first.type, "dynamic");
    });

    it("should extract export-from statements", () => {
      const code = `export { foo } from "./foo.ts";`;
      const imports = extractImports(code);
      assertEquals(imports.length, 1);
      const first = imports[0];
      assertExists(first);
      assertEquals(first.specifier, "./foo.ts");
      assertEquals(first.type, "static");
    });

    it("should deduplicate specifiers", () => {
      const code = `import { a } from "react";\nimport { b } from "react";`;
      const imports = extractImports(code);
      assertEquals(imports.length, 1);
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
      const result = resolveImportUrl("./utils.ts", "https://cdn.com/dir/main.ts");
      assertEquals(result, "https://cdn.com/dir/utils.ts");
    });

    it("should resolve parent paths against base URL", () => {
      const result = resolveImportUrl("../lib.ts", "https://cdn.com/dir/sub/main.ts");
      assertEquals(result, "https://cdn.com/dir/lib.ts");
    });

    it("should return null for bare specifiers", () => {
      assertEquals(resolveImportUrl("react", "https://base.com/"), null);
    });

    it("should return null for node: specifiers", () => {
      assertEquals(resolveImportUrl("node:fs", "https://base.com/"), null);
    });
  });

  describe("createLockfileManager", () => {
    function createMockFS(files: Record<string, string> = {}): FSAdapter {
      const store = new Map<string, string>(Object.entries(files));
      return {
        readFile: (path: string) => {
          const content = store.get(path);
          if (!content) return Promise.reject(new Error("ENOENT"));
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

    it("should return null for read when no lockfile exists", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      assertEquals(await mgr.read(), null);
    });

    it("should read existing lockfile", async () => {
      const data = {
        version: 1,
        imports: {
          "https://cdn.com/mod.ts": { resolved: "https://cdn.com/mod.ts", integrity: "sha256-abc" },
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
      assertEquals(await mgr.has("https://cdn.com/mod.ts"), false);

      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-abc",
      });
      assertEquals(await mgr.has("https://cdn.com/mod.ts"), true);
    });

    it("should clear lockfile data", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-abc",
      });
      await mgr.clear();
      assertEquals(await mgr.has("https://cdn.com/mod.ts"), false);
    });

    it("should flush dirty data to disk", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-abc",
      });
      await mgr.flush();

      // Verify file was written
      assertEquals(await fs.exists("/project/veryfront.lock"), true);
    });

    it("should not flush when not dirty", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      await mgr.flush(); // No-op
      assertEquals(await fs.exists("/project/veryfront.lock"), false);
    });

    it("should reset to empty lockfile on version mismatch", async () => {
      const data = { version: 99, imports: { "x": { resolved: "x", integrity: "y" } } };
      const fs = createMockFS({ "/project/veryfront.lock": JSON.stringify(data) });
      const mgr = createLockfileManager("/project", fs);
      const result = await mgr.read();
      assertEquals(result?.version, 1);
      assertEquals(Object.keys(result!.imports).length, 0);
    });
  });
});
