import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { resolve } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
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

function createAtomicMockFS(files: Record<string, string> = {}): {
  adapter: FSAdapter;
  failRename: { value: boolean };
  renames: Array<{ source: string; destination: string }>;
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(files));
  const failRename = { value: false };
  const renames: Array<{ source: string; destination: string }> = [];
  const adapter: FSAdapter = {
    readFile(path) {
      const content = store.get(path);
      return content === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(content);
    },
    writeFile(path, content) {
      store.set(path, content);
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(store.has(path)),
    remove(path) {
      store.delete(path);
      return Promise.resolve();
    },
    writeFileExclusive(path, content) {
      if (store.has(path)) return Promise.resolve(false);
      store.set(path, content);
      return Promise.resolve(true);
    },
    rename(source, destination) {
      if (failRename.value) return Promise.reject(new Error("rename failed"));
      const content = store.get(source);
      if (content === undefined) return Promise.reject(new Error(`ENOENT: ${source}`));
      renames.push({ source, destination });
      store.set(destination, content);
      store.delete(source);
      return Promise.resolve();
    },
  };

  return { adapter, failRename, renames, store };
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
    it("resolves relative project directories from the runtime working directory", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("relative-project", fs);
      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-abc",
      });
      await mgr.flush();

      const expectedPath = resolve(cwd(), "relative-project", "veryfront.lock");
      assertEquals(JSON.parse(await fs.readFile(expectedPath)).version, 1);
    });

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

    it("snapshots set input before a same-tick caller mutation", async () => {
      const url = "https://cdn.com/mod.ts";
      const dependency = "https://cdn.com/dependency.ts";
      const mgr = createLockfileManager("/project", createMockFS());
      const entry = {
        resolved: url,
        integrity: "sha256-original",
        dependencies: [dependency],
      };

      const pendingSet = mgr.set(url, entry);
      entry.resolved = "https://attacker.example/mutated.ts";
      entry.integrity = "sha256-mutated";
      entry.dependencies.push("https://attacker.example/injected.ts");
      await pendingSet;

      assertEquals(await mgr.get(url), {
        resolved: url,
        integrity: "sha256-original",
        dependencies: [dependency],
      });
    });

    it("snapshots write input before a same-tick caller mutation", async () => {
      const url = "https://cdn.com/mod.ts";
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const data = {
        version: 1 as const,
        imports: {
          [url]: {
            resolved: url,
            integrity: "sha256-original",
          },
        },
      };

      const pendingWrite = mgr.write(data);
      data.imports[url]!.resolved = "https://attacker.example/mutated.ts";
      data.imports[url]!.integrity = "sha256-mutated";
      Object.defineProperty(data.imports, "https://attacker.example/injected.ts", {
        enumerable: true,
        value: {
          resolved: "https://attacker.example/injected.ts",
          integrity: "sha256-injected",
        },
      });
      await pendingWrite;

      assertEquals(await mgr.read(), {
        version: 1,
        imports: {
          [url]: {
            resolved: url,
            integrity: "sha256-original",
          },
        },
      });
    });

    it("returns detached snapshots from get and read", async () => {
      const specifier = "https://cdn.com/mod.ts";
      const mgr = createLockfileManager("/project", createMockFS());
      await mgr.set(specifier, {
        resolved: specifier,
        integrity: "sha256-original",
        dependencies: ["https://cdn.com/dependency.ts"],
      });

      const entry = await mgr.get(specifier);
      assertExists(entry);
      entry.integrity = "sha256-mutated";
      entry.dependencies?.push("https://cdn.com/injected.ts");

      const snapshot = await mgr.read();
      assertExists(snapshot);
      snapshot.imports[specifier]!.resolved = "https://attacker.example/mod.ts";
      Object.defineProperty(snapshot.imports, "injected", {
        enumerable: true,
        value: {
          resolved: "https://attacker.example/injected.ts",
          integrity: "sha256-injected",
        },
      });

      assertEquals(await mgr.get(specifier), {
        resolved: specifier,
        integrity: "sha256-original",
        dependencies: ["https://cdn.com/dependency.ts"],
      });
      assertEquals(await mgr.has("injected"), false);
    });

    it("should report has correctly", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      const specifier = "https://cdn.com/mod.ts";

      assertEquals(await mgr.has(specifier), false);

      await mgr.set(specifier, { resolved: specifier, integrity: "sha256-abc" });
      assertEquals(await mgr.has(specifier), true);
    });

    it("should not treat Object.prototype properties as lockfile entries", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-abc",
      });

      assertEquals(await mgr.has("toString"), false);
      assertEquals(await mgr.get("toString"), null);
    });

    it("should persist special property names as ordinary specifiers", async () => {
      const fs = createMockFS();
      const entry = { resolved: "https://cdn.com/proto.ts", integrity: "sha256-proto" };
      const mgr = createLockfileManager("/project", fs);

      await mgr.set("__proto__", entry);
      await mgr.flush();

      const reloaded = createLockfileManager("/project", fs);
      assertEquals(await reloaded.has("__proto__"), true);
      assertEquals(await reloaded.get("__proto__"), entry);
    });

    it("should preserve concurrent first writes", async () => {
      const fs = createMockFS();
      const pendingExists: Array<(exists: boolean) => void> = [];
      fs.exists = () =>
        new Promise<boolean>((resolve) => {
          pendingExists.push(resolve);
        });
      const mgr = createLockfileManager("/project", fs);

      const first = mgr.set("https://cdn.com/a.ts", {
        resolved: "https://cdn.com/a.ts",
        integrity: "sha256-a",
      });
      const second = mgr.set("https://cdn.com/b.ts", {
        resolved: "https://cdn.com/b.ts",
        integrity: "sha256-b",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const resolve of pendingExists) resolve(false);
      await Promise.all([first, second]);
      fs.exists = () => Promise.resolve(false);
      await mgr.flush();

      const written = JSON.parse(await fs.readFile("/project/veryfront.lock"));
      assertEquals(Object.keys(written.imports), [
        "https://cdn.com/a.ts",
        "https://cdn.com/b.ts",
      ]);
    });

    it("merges flushes from independent managers for the same canonical path", async () => {
      const fs = createMockFS();
      const first = createLockfileManager("/project/./nested/..", fs);
      const second = createLockfileManager("/project", fs);

      await Promise.all([
        first.set("https://cdn.com/a.ts", {
          resolved: "https://cdn.com/a.ts",
          integrity: "sha256-a",
        }),
        second.set("https://cdn.com/b.ts", {
          resolved: "https://cdn.com/b.ts",
          integrity: "sha256-b",
        }),
      ]);
      await Promise.all([first.flush(), second.flush()]);

      const written = JSON.parse(await fs.readFile("/project/veryfront.lock"));
      assertEquals(Object.keys(written.imports), [
        "https://cdn.com/a.ts",
        "https://cdn.com/b.ts",
      ]);
    });

    it("writes through a same-directory temporary file and releases its process lock", async () => {
      const { adapter, renames, store } = createAtomicMockFS();
      const mgr = createLockfileManager("/project", adapter);
      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-mod",
      });

      await mgr.flush();

      assertEquals(renames.length, 1);
      assertEquals(renames[0]?.destination, "/project/veryfront.lock");
      assertEquals(renames[0]?.source.startsWith("/project/veryfront.lock.tmp."), true);
      assertEquals(store.has("/project/veryfront.lock.lock"), false);
      assertEquals([...store.keys()].some((path) => path.includes(".tmp.")), false);
    });

    it("cleans temporary and process-lock files after an atomic rename failure", async () => {
      const original = {
        version: 1,
        imports: {
          "https://cdn.com/original.ts": {
            resolved: "https://cdn.com/original.ts",
            integrity: "sha256-original",
          },
        },
      };
      const { adapter, failRename, store } = createAtomicMockFS({
        "/project/veryfront.lock": JSON.stringify(original),
      });
      const mgr = createLockfileManager("/project", adapter);
      await mgr.set("https://cdn.com/new.ts", {
        resolved: "https://cdn.com/new.ts",
        integrity: "sha256-new",
      });
      failRename.value = true;

      await assertRejects(() => mgr.flush(), Error, "rename failed");

      assertEquals(JSON.parse(store.get("/project/veryfront.lock")!), original);
      assertEquals(store.has("/project/veryfront.lock.lock"), false);
      assertEquals([...store.keys()].some((path) => path.includes(".tmp.")), false);

      failRename.value = false;
      await mgr.flush();
      const recovered = JSON.parse(store.get("/project/veryfront.lock")!);
      assertEquals(Object.keys(recovered.imports), [
        "https://cdn.com/new.ts",
        "https://cdn.com/original.ts",
      ]);
    });

    it("rolls back the cached replacement when write fails", async () => {
      const original = {
        version: 1 as const,
        imports: {
          "https://cdn.com/original.ts": {
            resolved: "https://cdn.com/original.ts",
            integrity: "sha256-original",
          },
        },
      };
      const { adapter, failRename } = createAtomicMockFS({
        "/project/veryfront.lock": JSON.stringify(original),
      });
      const mgr = createLockfileManager("/project", adapter);
      assertEquals(await mgr.read(), original);
      failRename.value = true;

      await assertRejects(
        () =>
          mgr.write({
            version: 1,
            imports: {
              "https://cdn.com/replacement.ts": {
                resolved: "https://cdn.com/replacement.ts",
                integrity: "sha256-replacement",
              },
            },
          }),
        Error,
        "rename failed",
      );

      assertEquals(await mgr.read(), original);
    });

    it("preserves earlier pending entries when a write fails beside a concurrent set", async () => {
      const store = new Map<string, string>();
      let releaseWrite: (() => void) | undefined;
      const writeGate = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      let notifyWriteStarted: (() => void) | undefined;
      const writeStarted = new Promise<void>((resolve) => {
        notifyWriteStarted = resolve;
      });
      let writeAttempts = 0;
      const fs: FSAdapter = {
        readFile: (path) => Promise.resolve(store.get(path)!),
        exists: (path) => Promise.resolve(store.has(path)),
        writeFile: async (path, content) => {
          writeAttempts++;
          if (writeAttempts === 1) {
            notifyWriteStarted?.();
            await writeGate;
            throw new Error("write failed");
          }
          store.set(path, content);
        },
      };
      const mgr = createLockfileManager("/project", fs);
      const firstUrl = "https://cdn.com/first.ts";
      const laterUrl = "https://cdn.com/later.ts";
      const replacementUrl = "https://cdn.com/replacement.ts";
      await mgr.set(firstUrl, {
        resolved: firstUrl,
        integrity: "sha256-first",
      });

      const failedWrite = mgr.write({
        version: 1,
        imports: {
          [replacementUrl]: {
            resolved: replacementUrl,
            integrity: "sha256-replacement",
          },
        },
      });
      await writeStarted;
      const concurrentSet = mgr.set(laterUrl, {
        resolved: laterUrl,
        integrity: "sha256-later",
      });
      await Promise.resolve();
      releaseWrite?.();

      await assertRejects(() => failedWrite, Error, "write failed");
      await concurrentSet;
      await mgr.flush();

      const written = JSON.parse(store.get("/project/veryfront.lock")!);
      assertEquals(Object.keys(written.imports), [firstUrl, laterUrl]);
      assertEquals(Object.hasOwn(written.imports, replacementUrl), false);
    });

    it("rolls back cached clearing when file removal fails", async () => {
      const original = {
        version: 1 as const,
        imports: {
          "https://cdn.com/original.ts": {
            resolved: "https://cdn.com/original.ts",
            integrity: "sha256-original",
          },
        },
      };
      const fs = createMockFS({
        "/project/veryfront.lock": JSON.stringify(original),
      });
      fs.remove = () => Promise.reject(new Error("remove failed"));
      const mgr = createLockfileManager("/project", fs);
      assertEquals(await mgr.read(), original);

      await assertRejects(() => mgr.clear(), Error, "remove failed");

      assertEquals(await mgr.read(), original);
    });

    it("preserves earlier pending entries when clear fails beside a concurrent set", async () => {
      const lockfilePath = "/project/veryfront.lock";
      const store = new Map<string, string>([
        [lockfilePath, JSON.stringify(createEmptyLockfile())],
      ]);
      let releaseRemove: (() => void) | undefined;
      const removeGate = new Promise<void>((resolve) => {
        releaseRemove = resolve;
      });
      let notifyRemoveStarted: (() => void) | undefined;
      const removeStarted = new Promise<void>((resolve) => {
        notifyRemoveStarted = resolve;
      });
      const fs: FSAdapter = {
        readFile: (path) => Promise.resolve(store.get(path)!),
        exists: (path) => Promise.resolve(store.has(path)),
        writeFile: (path, content) => {
          store.set(path, content);
          return Promise.resolve();
        },
        remove: async () => {
          notifyRemoveStarted?.();
          await removeGate;
          throw new Error("remove failed");
        },
      };
      const mgr = createLockfileManager("/project", fs);
      const firstUrl = "https://cdn.com/first.ts";
      const laterUrl = "https://cdn.com/later.ts";
      await mgr.set(firstUrl, {
        resolved: firstUrl,
        integrity: "sha256-first",
      });

      const failedClear = mgr.clear();
      await removeStarted;
      const concurrentSet = mgr.set(laterUrl, {
        resolved: laterUrl,
        integrity: "sha256-later",
      });
      await Promise.resolve();
      releaseRemove?.();

      await assertRejects(() => failedClear, Error, "remove failed");
      await concurrentSet;
      await mgr.flush();

      const written = JSON.parse(store.get(lockfilePath)!);
      assertEquals(Object.keys(written.imports), [firstUrl, laterUrl]);
    });

    it("coordinates independent managers through the production filesystem adapter", async () => {
      const systemFs = createFileSystem();
      const projectDir = await systemFs.makeTempDir({ prefix: "veryfront-lockfile-test-" });
      try {
        const first = createLockfileManager(projectDir);
        const second = createLockfileManager(`${projectDir}/.`);
        await Promise.all([
          first.set("https://cdn.com/a.ts", {
            resolved: "https://cdn.com/a.ts",
            integrity: "sha256-a",
          }),
          second.set("https://cdn.com/b.ts", {
            resolved: "https://cdn.com/b.ts",
            integrity: "sha256-b",
          }),
        ]);
        await Promise.all([first.flush(), second.flush()]);

        const reloaded = createLockfileManager(projectDir);
        assertEquals(Object.keys((await reloaded.read())?.imports ?? {}), [
          "https://cdn.com/a.ts",
          "https://cdn.com/b.ts",
        ]);
      } finally {
        await systemFs.remove(projectDir, { recursive: true });
      }
    });

    it("should reject malformed lockfile data", async () => {
      const fs = createMockFS({
        "/project/veryfront.lock": JSON.stringify({ version: 1, imports: [] }),
      });
      const mgr = createLockfileManager("/project", fs);

      await assertRejects(() => mgr.read(), Error, "Invalid lockfile");
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

    it("serializes flushes so an older write cannot overwrite newer entries", async () => {
      const store = new Map<string, string>();
      let releaseFirstWrite: (() => void) | undefined;
      const firstWriteGate = new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
      });
      let writeCount = 0;
      let activeWrites = 0;
      let maxActiveWrites = 0;
      const fs: FSAdapter = {
        readFile: (path) => Promise.resolve(store.get(path)!),
        exists: (path) => Promise.resolve(store.has(path)),
        writeFile: async (path, content) => {
          const writeNumber = ++writeCount;
          activeWrites++;
          maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
          if (writeNumber === 1) await firstWriteGate;
          store.set(path, content);
          activeWrites--;
        },
      };
      const mgr = createLockfileManager("/project", fs);

      await mgr.set("https://cdn.com/a.ts", {
        resolved: "https://cdn.com/a.ts",
        integrity: "sha256-a",
      });
      const firstFlush = mgr.flush();
      await Promise.resolve();
      await mgr.set("https://cdn.com/b.ts", {
        resolved: "https://cdn.com/b.ts",
        integrity: "sha256-b",
      });
      const secondFlush = mgr.flush();
      await Promise.resolve();
      releaseFirstWrite?.();
      await Promise.all([firstFlush, secondFlush]);

      const written = JSON.parse(store.get("/project/veryfront.lock")!);
      assertEquals(Object.keys(written.imports), [
        "https://cdn.com/a.ts",
        "https://cdn.com/b.ts",
      ]);
      assertEquals(maxActiveWrites, 1);
    });

    it("does not let an in-flight flush recreate a cleared lockfile", async () => {
      const store = new Map<string, string>();
      let releaseWrite: (() => void) | undefined;
      const writeGate = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      let notifyWriteStarted: (() => void) | undefined;
      const writeStarted = new Promise<void>((resolve) => {
        notifyWriteStarted = resolve;
      });
      const fs: FSAdapter = {
        readFile: (path) => Promise.resolve(store.get(path)!),
        exists: (path) => Promise.resolve(store.has(path)),
        writeFile: async (path, content) => {
          notifyWriteStarted?.();
          await writeGate;
          store.set(path, content);
        },
        remove: (path) => {
          store.delete(path);
          return Promise.resolve();
        },
      };
      const mgr = createLockfileManager("/project", fs);
      await mgr.set("https://cdn.com/mod.ts", {
        resolved: "https://cdn.com/mod.ts",
        integrity: "sha256-mod",
      });

      const flush = mgr.flush();
      await writeStarted;
      const clear = mgr.clear();
      releaseWrite?.();
      await Promise.all([flush, clear]);

      assertEquals(store.has("/project/veryfront.lock"), false);
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

    it("rejects non-HTTP URLs and embedded credentials before fetching", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      let fetchCalls = 0;
      const fetchFn = (() => {
        fetchCalls++;
        return Promise.resolve(new Response("unexpected"));
      }) as typeof fetch;

      for (
        const url of [
          "file:///private/module.ts",
          "https://user:secret@cdn.example/module.ts",
        ]
      ) {
        await assertRejects(
          () => fetchWithLock({ lockfile: mgr, url, fetchFn }),
          Error,
          "Remote module URL",
        );
      }

      assertEquals(fetchCalls, 0);
    });

    it("applies a caller policy to cached and final redirected URLs", async () => {
      const requestedUrl = "https://cdn.example/module.ts";
      const mgr = createLockfileManager("/project", createMockFS());
      await mgr.set(requestedUrl, {
        resolved: "http://127.0.0.1/private.ts",
        integrity: await computeIntegrity("private"),
      });
      let fetchCalls = 0;
      const isUrlAllowed = (url: URL) => url.origin === "https://cdn.example";

      await assertRejects(
        () =>
          fetchWithLock({
            lockfile: mgr,
            url: requestedUrl,
            isUrlAllowed,
            fetchFn: (() => {
              fetchCalls++;
              return Promise.resolve(new Response("unexpected"));
            }) as typeof fetch,
          }),
        Error,
        "rejected by policy",
      );
      assertEquals(fetchCalls, 0);

      await mgr.clear();
      const redirectedResponse = new Response(null, {
        status: 302,
        headers: {
          location: "https://disallowed.example/module.ts",
        },
      });
      await assertRejects(
        () =>
          fetchWithLock({
            lockfile: mgr,
            url: requestedUrl,
            isUrlAllowed,
            fetchFn: () => Promise.resolve(redirectedResponse),
          }),
        Error,
        "rejected by policy",
      );
      assertEquals(await mgr.get(requestedUrl), null);
    });

    it("does not let stalled redirect cancellation block the next fetch", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      let fetchCalls = 0;
      let cancellationStarted = false;
      const fetchFn = (() => {
        fetchCalls++;
        if (fetchCalls === 1) {
          return Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                cancel: () => {
                  cancellationStarted = true;
                  return new Promise<void>(() => {});
                },
              }),
              {
                status: 302,
                headers: { location: "https://cdn.example/resolved.ts" },
              },
            ),
          );
        }
        return Promise.resolve(new Response("export const ok = true;"));
      }) as typeof fetch;

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timed-out">((resolve) => {
        timeoutId = setTimeout(() => resolve("timed-out"), 100);
      });
      try {
        const outcome = await Promise.race([
          fetchWithLock({
            lockfile: mgr,
            url: "https://cdn.example/module.ts",
            fetchFn,
            timeoutMs: 25,
          }),
          timeout,
        ]);

        assertEquals(outcome === "timed-out", false);
        assertEquals(fetchCalls, 2);
        assertEquals(cancellationStarted, true);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    });

    it("rejects oversized remote modules without consuming the full body", async () => {
      const mgr = createLockfileManager("/project", createMockFS());

      await assertRejects(
        () =>
          fetchWithLock({
            lockfile: mgr,
            url: "https://cdn.example/module.ts",
            maxResponseBytes: 4,
            fetchFn: () => Promise.resolve(new Response("12345")),
          }),
        Error,
        "exceeded 4 bytes",
      );
    });

    it("cancels a response rejected by its oversized Content-Length", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      let cancelled = false;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
        {
          status: 200,
          headers: { "content-length": "100" },
        },
      );

      await assertRejects(
        () =>
          fetchWithLock({
            lockfile: mgr,
            url: "https://cdn.example/module.ts",
            maxResponseBytes: 4,
            fetchFn: () => Promise.resolve(response),
          }),
        Error,
        "exceeded 4 bytes",
      );
      assertEquals(cancelled, true);
    });

    it("cancels a terminal non-success response body", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      let cancelled = false;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 404 },
      );

      await assertRejects(
        () =>
          fetchWithLock({
            lockfile: mgr,
            url: "https://cdn.example/module.ts",
            fetchFn: () => Promise.resolve(response),
          }),
        Error,
        "404",
      );
      assertEquals(cancelled, true);
    });

    it("aborts remote fetches that exceed the configured timeout", async () => {
      const mgr = createLockfileManager("/project", createMockFS());

      await assertRejects(
        () =>
          fetchWithLock({
            lockfile: mgr,
            url: "https://cdn.example/module.ts",
            timeoutMs: 5,
            fetchFn: ((_input, init) => {
              const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
              return new Promise<Response>((_resolve, reject) => {
                signal?.addEventListener("abort", () => reject(signal.reason), {
                  once: true,
                });
              });
            }) as typeof fetch,
          }),
        Error,
        "timed out",
      );
    });

    it("aborts stalled response bodies within the same timeout", async () => {
      const mgr = createLockfileManager("/project", createMockFS());
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
          },
        }),
      );
      const fallbackTimer = setTimeout(() => {
        try {
          streamController?.close();
        } catch {
          // A bounded reader may already have cancelled the stream.
        }
      }, 25);

      try {
        await assertRejects(
          () =>
            fetchWithLock({
              lockfile: mgr,
              url: "https://cdn.example/module.ts",
              timeoutMs: 5,
              fetchFn: () => Promise.resolve(response),
            }),
          Error,
          "timed out",
        );
      } finally {
        clearTimeout(fallbackTimer);
        try {
          streamController?.close();
        } catch {
          // A bounded reader may already have cancelled the stream.
        }
      }
    });
  });
});
