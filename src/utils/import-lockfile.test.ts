import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import {
  computeIntegrity,
  createEmptyLockfile,
  createLockfileManager,
  extractImports,
  fetchWithLock,
  type FSAdapter,
  type LockfileData,
  type LockfileEntry,
  resolveImportUrl,
  verifyIntegrity,
} from "./import-lockfile.ts";

function createMockFS(
  files: Record<string, string> = {},
  coordinationKey?: string,
): FSAdapter {
  const store = new Map<string, string>(Object.entries(files));

  return {
    ...(coordinationKey === undefined ? {} : { coordinationKey }),
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

function blockNextWrite(fs: FSAdapter): {
  started: Promise<void>;
  release: () => void;
} {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const writeFile = fs.writeFile;
  let blocked = false;

  fs.writeFile = async (path: string, content: string): Promise<void> => {
    if (!blocked) {
      blocked = true;
      started.resolve();
      await release.promise;
    }
    await writeFile(path, content);
  };

  return { started: started.promise, release: release.resolve };
}

function exposePartialNextWrite(fs: FSAdapter): {
  started: Promise<void>;
  release: () => void;
} {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const writeFile = fs.writeFile;
  let blocked = false;

  fs.writeFile = async (path: string, content: string): Promise<void> => {
    if (!blocked) {
      blocked = true;
      await writeFile(path, "{");
      started.resolve();
      await release.promise;
    }
    await writeFile(path, content);
  };

  return { started: started.promise, release: release.resolve };
}

function resolvesWithin(promise: Promise<unknown>, milliseconds = 50): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), milliseconds)),
  ]);
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

    it("should fail explicitly on a format mismatch instead of substituting an empty lockfile", async () => {
      const data = { version: 99, imports: { x: { resolved: "x", integrity: "y" } } };
      const fs = createMockFS({ "/project/veryfront.lock": JSON.stringify(data) });
      const mgr = createLockfileManager("/project", fs);

      const error = await assertRejects(() => mgr.read(), VeryfrontError);
      assertExists(error);
      if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(error.slug, "lockfile-format-mismatch");
      assertEquals(error.title, "Lockfile format is not supported");
      assertExists(error.detail);
      assertStringIncludes(error.detail, "format version 99");
      assertStringIncludes(error.detail, "supports version 1");
      assertEquals(error.detail.includes("/project/veryfront.lock"), false);
      assertEquals(
        error.suggestion,
        "Upgrade Veryfront or migrate the lockfile before modifying it",
      );
      const context = error.context as { actualVersion?: number; lockfilePath?: string };
      assertEquals(context.actualVersion, 99);
      assertEquals(context.lockfilePath, "/project/veryfront.lock");
    });

    it("should treat a non-numeric lockfile version as invalid structure", async () => {
      const data = { version: "1", imports: {} };
      const fs = createMockFS({ "/project/veryfront.lock": JSON.stringify(data) });
      const mgr = createLockfileManager("/project", fs);

      const error = await assertRejects(() => mgr.read(), VeryfrontError);

      assertExists(error);
      if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(error.slug, "lockfile-read-error");
      assertExists(error.detail);
      assertStringIncludes(error.detail, "invalid structure");
      assertEquals(error.detail.includes("/project/veryfront.lock"), false);
      const context = error.context as { lockfilePath?: string; reason?: string };
      assertEquals(context.lockfilePath, "/project/veryfront.lock");
      assertEquals(context.reason, "invalid-structure");
    });

    it("should preserve a newer-format lockfile on disk after a format mismatch", async () => {
      const newerContent = JSON.stringify({
        version: 99,
        imports: { "https://cdn.com/newer.ts": { resolved: "x", integrity: "y" } },
      });
      const fs = createMockFS({ "/project/veryfront.lock": newerContent });
      const mgr = createLockfileManager("/project", fs);

      await assertRejects(() => mgr.read(), VeryfrontError);

      // A flush after the failed read must not overwrite the newer-format file.
      await assertRejects(
        () =>
          mgr.set("https://cdn.com/mod.ts", {
            resolved: "https://cdn.com/mod.ts",
            integrity: "sha256-abc",
          }).then(() => mgr.flush()),
        VeryfrontError,
      );

      assertEquals(await fs.readFile("/project/veryfront.lock"), newerContent);
    });

    it("should clear a newer-format lockfile as an explicit recovery operation", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const pendingUrl = "https://cdn.com/pending.ts";
      const pendingEntry = {
        resolved: pendingUrl,
        integrity: "sha256-pending",
      };
      await mgr.set(pendingUrl, pendingEntry);

      const newerContent = JSON.stringify({
        version: 99,
        imports: { "https://cdn.com/newer.ts": { resolved: "x", integrity: "y" } },
      });
      await fs.writeFile("/project/veryfront.lock", newerContent);

      await mgr.clear();

      assertEquals(await fs.exists("/project/veryfront.lock"), false);
      assertEquals(await mgr.get(pendingUrl), null);
    });

    it("should preserve disk and cached state when lockfile removal fails", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const url = "https://cdn.com/mod.ts";
      const entry = { resolved: url, integrity: "sha256-abc" };
      await mgr.set(url, entry);
      await mgr.flush();
      const before = await fs.readFile("/project/veryfront.lock");
      fs.remove = () => Promise.reject(new Error("remove failed"));

      await assertRejects(() => mgr.clear(), Error, "remove failed");

      assertEquals(await fs.readFile("/project/veryfront.lock"), before);
      assertEquals(await mgr.get(url), entry);
    });

    it("should preserve pending state when clear cannot inspect the lockfile path", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const url = "https://cdn.com/pending.ts";
      const entry = { resolved: url, integrity: "sha256-pending" };
      await mgr.set(url, entry);
      fs.exists = () => Promise.reject(new Error("permission denied"));

      const error = await assertRejects(() => mgr.clear(), VeryfrontError);

      assertExists(error);
      if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(error.slug, "lockfile-read-error");
      assertExists(error.detail);
      assertEquals(error.detail.includes("/project/veryfront.lock"), false);
      const context = error.context as { lockfilePath?: string; reason?: string };
      assertEquals(context.lockfilePath, "/project/veryfront.lock");
      assertEquals(context.reason, "access-failed");
      assertEquals(await mgr.get(url), entry);
    });

    it("should persist an empty lockfile when the adapter cannot remove files", async () => {
      const path = "/project/veryfront.lock";
      const url = "https://cdn.com/mod.ts";
      const backingFS = createMockFS({
        [path]: JSON.stringify({
          version: 1,
          imports: { [url]: { resolved: url, integrity: "sha256-abc" } },
        }),
      });
      const fs: FSAdapter = {
        coordinationKey: "non-removing-test-store",
        exists: backingFS.exists,
        readFile: backingFS.readFile,
        writeFile: backingFS.writeFile,
      };
      const mgr = createLockfileManager("/project", fs);

      await mgr.clear();

      assertEquals(JSON.parse(await fs.readFile(path)), createEmptyLockfile());
      const freshManager = createLockfileManager("/project", fs);
      assertEquals(await freshManager.has(url), false);
    });

    it("should keep a cold reader behind an in-flight lockfile replacement", async () => {
      const path = "/project/veryfront.lock";
      const baseUrl = "https://cdn.com/base.ts";
      const addedUrl = "https://cdn.com/added.ts";
      const fs = createMockFS({
        [path]: JSON.stringify({
          version: 1,
          imports: {
            [baseUrl]: { resolved: baseUrl, integrity: "sha256-base" },
          },
        }),
      });
      const writer = createLockfileManager("/project", fs);
      await writer.set(addedUrl, { resolved: addedUrl, integrity: "sha256-added" });

      const partialRead = Promise.withResolvers<void>();
      const readFile = fs.readFile;
      fs.readFile = async (filePath: string): Promise<string> => {
        const content = await readFile(filePath);
        if (content === "{") partialRead.resolve();
        return content;
      };
      const gate = exposePartialNextWrite(fs);
      const flush = writer.flush();
      await gate.started;

      const coldReader = createLockfileManager("/project", fs);
      const coldRead = coldReader.read().then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const observedPartialContent = await resolvesWithin(partialRead.promise);
      gate.release();
      await flush;

      assertEquals(observedPartialContent, false);
      const result = await coldRead;
      if (!result.ok) throw result.error;
      assertEquals(Object.keys(result.value?.imports ?? {}).sort(), [addedUrl, baseUrl]);
    });

    it("should keep a cold reader behind an in-flight clear fallback write", async () => {
      const path = "/project/veryfront.lock";
      const url = "https://cdn.com/mod.ts";
      const backingFS = createMockFS({
        [path]: JSON.stringify({
          version: 1,
          imports: { [url]: { resolved: url, integrity: "sha256-abc" } },
        }),
      });
      const fs: FSAdapter = {
        coordinationKey: "non-removing-clear-window-test-store",
        exists: backingFS.exists,
        readFile: backingFS.readFile,
        writeFile: backingFS.writeFile,
      };
      const partialRead = Promise.withResolvers<void>();
      const readFile = fs.readFile;
      fs.readFile = async (filePath: string): Promise<string> => {
        const content = await readFile(filePath);
        if (content === "{") partialRead.resolve();
        return content;
      };
      const gate = exposePartialNextWrite(fs);
      const clearingManager = createLockfileManager("/project", fs);
      const clear = clearingManager.clear();
      await gate.started;

      const coldReader = createLockfileManager("/project", fs);
      const coldRead = coldReader.read().then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const observedPartialContent = await resolvesWithin(partialRead.promise);
      gate.release();
      await clear;

      assertEquals(observedPartialContent, false);
      const result = await coldRead;
      if (!result.ok) throw result.error;
      assertEquals(result.value, createEmptyLockfile());
    });

    it("should fail closed on write but allow clear to remove malformed JSON", async () => {
      const malformed = "{not-json";
      const fs = createMockFS({ "/project/veryfront.lock": malformed });
      const mgr = createLockfileManager("/project", fs);

      const error = await assertRejects(
        () => mgr.write(createEmptyLockfile()),
        VeryfrontError,
      );
      assertExists(error);
      if (!(error instanceof VeryfrontError)) throw new Error("expected VeryfrontError");
      assertEquals(error.slug, "lockfile-read-error");
      assertEquals(error.title, "Lockfile could not be read safely");
      assertEquals(await fs.readFile("/project/veryfront.lock"), malformed);

      await mgr.clear();

      assertEquals(await fs.exists("/project/veryfront.lock"), false);
    });

    it("should fail closed on write but allow clear to remove an unreadable lockfile", async () => {
      let writes = 0;
      let removals = 0;
      const fs: FSAdapter = {
        coordinationKey: "unreadable-test-store",
        exists: () => Promise.resolve(true),
        readFile: () => Promise.reject(new Error("permission denied")),
        writeFile: () => {
          writes++;
          return Promise.resolve();
        },
        remove: () => {
          removals++;
          return Promise.resolve();
        },
      };
      const mgr = createLockfileManager("/project", fs);

      await assertRejects(() => mgr.write(createEmptyLockfile()), VeryfrontError);
      assertEquals(writes, 0);
      assertEquals(removals, 0);

      await mgr.clear();

      assertEquals(writes, 0);
      assertEquals(removals, 1);
    });

    it("should serialize path aliases across adapters with a shared coordination identity", async () => {
      const backingFS = createMockFS({
        "/project/veryfront.lock": JSON.stringify({
          version: 1,
          imports: {
            "https://cdn.com/base.ts": {
              resolved: "https://cdn.com/base.ts",
              integrity: "sha256-base",
            },
          },
        }),
      });
      const coordinationKey = "shared-test-store";
      const fsA: FSAdapter = { ...backingFS, coordinationKey };
      const fsB: FSAdapter = { ...backingFS, coordinationKey };
      const mgrA = createLockfileManager("/project", fsA);
      const mgrB = createLockfileManager("/project/.", fsB);

      // Both managers warm their caches from the same on-disk state.
      assertEquals(await mgrA.has("https://cdn.com/base.ts"), true);
      assertEquals(await mgrB.has("https://cdn.com/base.ts"), true);

      await mgrA.set("https://cdn.com/a.ts", {
        resolved: "https://cdn.com/a.ts",
        integrity: "sha256-a",
      });
      await mgrB.set("https://cdn.com/b.ts", {
        resolved: "https://cdn.com/b.ts",
        integrity: "sha256-b",
      });

      await Promise.all([mgrA.flush(), mgrB.flush()]);

      const onDisk = JSON.parse(await backingFS.readFile("/project/veryfront.lock")) as {
        imports: Record<string, unknown>;
      };
      assertEquals(Object.keys(onDisk.imports).sort(), [
        "https://cdn.com/a.ts",
        "https://cdn.com/b.ts",
        "https://cdn.com/base.ts",
      ]);
    });

    it("should use coordinationKey across adapters with mixed realPath support", async () => {
      const path = "/project/veryfront.lock";
      const baseUrl = "https://cdn.com/base.ts";
      const aUrl = "https://cdn.com/a.ts";
      const bUrl = "https://cdn.com/b.ts";
      const backingFS = createMockFS({
        [path]: JSON.stringify({
          version: 1,
          imports: {
            [baseUrl]: { resolved: baseUrl, integrity: "sha256-base" },
          },
        }),
      });
      const firstWriteStarted = Promise.withResolvers<void>();
      const secondWriteStarted = Promise.withResolvers<void>();
      const releaseFirstWrite = Promise.withResolvers<void>();
      const writeFile = backingFS.writeFile;
      let writes = 0;
      const coordinatedWrite = async (filePath: string, content: string): Promise<void> => {
        writes++;
        if (writes === 1) {
          firstWriteStarted.resolve();
          await releaseFirstWrite.promise;
        } else if (writes === 2) {
          secondWriteStarted.resolve();
        }
        await writeFile(filePath, content);
      };
      const coordinationKey = "mixed-realpath-test-store";
      const fsWithoutRealPath: FSAdapter = {
        ...backingFS,
        coordinationKey,
        writeFile: coordinatedWrite,
      };
      const fsWithRealPath: FSAdapter = {
        ...backingFS,
        coordinationKey,
        writeFile: coordinatedWrite,
        realPath: (filePath: string) => Promise.resolve(filePath),
      };
      const managerA = createLockfileManager("/project", fsWithoutRealPath);
      const managerB = createLockfileManager("/project", fsWithRealPath);
      await managerA.set(aUrl, { resolved: aUrl, integrity: "sha256-a" });
      await managerB.set(bUrl, { resolved: bUrl, integrity: "sha256-b" });

      const flushA = managerA.flush();
      await firstWriteStarted.promise;
      const flushB = managerB.flush();
      const secondWriteBeforeRelease = await resolvesWithin(secondWriteStarted.promise);
      releaseFirstWrite.resolve();
      await Promise.all([flushA, flushB]);

      assertEquals(secondWriteBeforeRelease, false);
      const onDisk = JSON.parse(await backingFS.readFile(path)) as {
        imports: Record<string, unknown>;
      };
      assertEquals(Object.keys(onDisk.imports).sort(), [aUrl, bUrl, baseUrl]);
    });

    it("should serialize real symlink aliases by canonical backing path", async () => {
      const root = await Deno.makeTempDir({ prefix: "veryfront-lockfile-alias-" });
      const projectDir = `${root}/project`;
      const aliasDir = `${root}/project-alias`;
      const lockfilePath = `${projectDir}/veryfront.lock`;
      const aliasLockfilePath = `${aliasDir}/veryfront.lock`;
      const baseUrl = "https://cdn.com/base.ts";
      const aUrl = "https://cdn.com/a.ts";
      const bUrl = "https://cdn.com/b.ts";

      try {
        await Deno.mkdir(projectDir);
        await Deno.writeTextFile(
          lockfilePath,
          JSON.stringify({
            version: 1,
            imports: {
              [baseUrl]: { resolved: baseUrl, integrity: "sha256-base" },
            },
          }),
        );
        try {
          await Deno.symlink(projectDir, aliasDir);
        } catch (error) {
          if (
            error instanceof Deno.errors.NotSupported ||
            error instanceof Deno.errors.PermissionDenied
          ) return;
          throw error;
        }

        const firstWriteStarted = Promise.withResolvers<void>();
        const releaseFirstWrite = Promise.withResolvers<void>();
        const aliasRead = Promise.withResolvers<void>();
        let blockFirstWrite = false;
        let blocked = false;
        let observeAliasRead = false;
        const fs: FSAdapter = {
          async exists(path: string): Promise<boolean> {
            try {
              await Deno.stat(path);
              return true;
            } catch (error) {
              if (error instanceof Deno.errors.NotFound) return false;
              throw error;
            }
          },
          async readFile(path: string): Promise<string> {
            if (observeAliasRead && path === aliasLockfilePath) aliasRead.resolve();
            return await Deno.readTextFile(path);
          },
          async writeFile(path: string, content: string): Promise<void> {
            if (blockFirstWrite && !blocked && path === lockfilePath) {
              blocked = true;
              firstWriteStarted.resolve();
              await releaseFirstWrite.promise;
            }
            await Deno.writeTextFile(path, content);
          },
          remove: (path: string) => Deno.remove(path),
          realPath: (path: string) => Deno.realPath(path),
        };
        const managerA = createLockfileManager(projectDir, fs);
        const managerB = createLockfileManager(aliasDir, fs);

        assertEquals(await managerA.has(baseUrl), true);
        assertEquals(await managerB.has(baseUrl), true);
        await managerA.set(aUrl, { resolved: aUrl, integrity: "sha256-a" });
        await managerB.set(bUrl, { resolved: bUrl, integrity: "sha256-b" });

        blockFirstWrite = true;
        const flushA = managerA.flush();
        await firstWriteStarted.promise;
        observeAliasRead = true;
        const flushB = managerB.flush();
        const aliasReadBeforeRelease = await resolvesWithin(aliasRead.promise);
        releaseFirstWrite.resolve();
        await Promise.all([flushA, flushB]);

        assertEquals(aliasReadBeforeRelease, false);
        const onDisk = JSON.parse(await Deno.readTextFile(lockfilePath)) as {
          imports: Record<string, unknown>;
        };
        assertEquals(Object.keys(onDisk.imports).sort(), [aUrl, bUrl, baseUrl]);
      } finally {
        await Deno.remove(root, { recursive: true });
      }
    });

    it("should coordinate aliases when the lockfile is created after manager construction", async () => {
      const canonicalProjectDir = "/backing/project";
      const canonicalLockfilePath = `${canonicalProjectDir}/veryfront.lock`;
      const projectDir = "/project";
      const aliasDir = "/project-alias";
      const projectLockfilePath = `${projectDir}/veryfront.lock`;
      const aliasLockfilePath = `${aliasDir}/veryfront.lock`;
      const aUrl = "https://cdn.com/a.ts";
      const bUrl = "https://cdn.com/b.ts";
      const store = new Map<string, string>();
      const firstWriteStarted = Promise.withResolvers<void>();
      const releaseFirstWrite = Promise.withResolvers<void>();
      const aliasAccess = Promise.withResolvers<void>();
      let blockFirstWrite = false;
      let blocked = false;
      let observeAliasAccess = false;

      function backingPath(path: string): string {
        return path === projectLockfilePath || path === aliasLockfilePath
          ? canonicalLockfilePath
          : path;
      }

      const fs: FSAdapter = {
        exists(path: string): Promise<boolean> {
          if (observeAliasAccess && path === aliasLockfilePath) aliasAccess.resolve();
          return Promise.resolve(store.has(backingPath(path)));
        },
        readFile(path: string): Promise<string> {
          if (observeAliasAccess && path === aliasLockfilePath) aliasAccess.resolve();
          const content = store.get(backingPath(path));
          return content === undefined
            ? Promise.reject(new Error("ENOENT"))
            : Promise.resolve(content);
        },
        async writeFile(path: string, content: string): Promise<void> {
          if (blockFirstWrite && !blocked && path === projectLockfilePath) {
            blocked = true;
            firstWriteStarted.resolve();
            await releaseFirstWrite.promise;
          }
          store.set(backingPath(path), content);
        },
        remove(path: string): Promise<void> {
          store.delete(backingPath(path));
          return Promise.resolve();
        },
        realPath(path: string): Promise<string> {
          if (path === projectDir || path === aliasDir) {
            return Promise.resolve(canonicalProjectDir);
          }
          if (
            (path === projectLockfilePath || path === aliasLockfilePath) &&
            store.has(canonicalLockfilePath)
          ) {
            return Promise.resolve(canonicalLockfilePath);
          }
          return Promise.reject(new Error("ENOENT"));
        },
      };
      const managerA = createLockfileManager(projectDir, fs);
      const managerB = createLockfileManager(aliasDir, fs);

      // Both managers resolve their stable access identity while the lockfile
      // is absent, using the canonical project directory as the fallback.
      await managerA.set(aUrl, { resolved: aUrl, integrity: "sha256-a" });
      await managerB.set(bUrl, { resolved: bUrl, integrity: "sha256-b" });

      blockFirstWrite = true;
      const flushA = managerA.flush();
      await firstWriteStarted.promise;
      observeAliasAccess = true;
      const flushB = managerB.flush();
      const aliasAccessBeforeRelease = await resolvesWithin(aliasAccess.promise);
      releaseFirstWrite.resolve();
      await Promise.all([flushA, flushB]);

      assertEquals(aliasAccessBeforeRelease, false);
      const onDisk = JSON.parse(store.get(canonicalLockfilePath)!) as {
        imports: Record<string, unknown>;
      };
      assertEquals(Object.keys(onDisk.imports).sort(), [aUrl, bUrl]);
    });

    it("should preserve a set queued during an in-flight flush and snapshot its input", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const firstUrl = "https://cdn.com/first.ts";
      const lateUrl = "https://cdn.com/late.ts";
      await mgr.set(firstUrl, { resolved: firstUrl, integrity: "sha256-first" });
      const gate = blockNextWrite(fs);

      const inFlightFlush = mgr.flush();
      await gate.started;
      const lateEntry = {
        resolved: lateUrl,
        integrity: "sha256-late",
        dependencies: ["dep-a"],
      };
      const lateSet = mgr.set(lateUrl, lateEntry);
      lateEntry.integrity = "sha256-mutated-by-caller";
      lateEntry.dependencies.push("dep-b");
      gate.release();
      await inFlightFlush;
      await lateSet;

      assertEquals(await mgr.get(lateUrl), {
        resolved: lateUrl,
        integrity: "sha256-late",
        dependencies: ["dep-a"],
      });
      await mgr.flush();
      const onDisk = JSON.parse(await fs.readFile("/project/veryfront.lock")) as {
        imports: Record<string, LockfileEntry>;
      };
      assertEquals(onDisk.imports[lateUrl]?.integrity, "sha256-late");
      assertEquals(Object.keys(onDisk.imports).sort(), [firstUrl, lateUrl]);
    });

    it("should preserve a set queued during an in-flight write", async () => {
      const fs = createMockFS();
      const mgr = createLockfileManager("/project", fs);
      const writtenUrl = "https://cdn.com/written.ts";
      const lateUrl = "https://cdn.com/late.ts";
      const writeData: LockfileData = {
        version: 1,
        imports: {
          [writtenUrl]: { resolved: writtenUrl, integrity: "sha256-written" },
        },
      };
      const gate = blockNextWrite(fs);

      const inFlightWrite = mgr.write(writeData);
      await gate.started;
      const lateSet = mgr.set(lateUrl, {
        resolved: lateUrl,
        integrity: "sha256-late",
      });
      writeData.imports[writtenUrl]!.integrity = "sha256-mutated-by-caller";
      gate.release();
      await Promise.all([inFlightWrite, lateSet]);

      assertEquals((await mgr.get(writtenUrl))?.integrity, "sha256-written");
      assertEquals((await mgr.get(lateUrl))?.integrity, "sha256-late");
      await mgr.flush();
      const onDisk = JSON.parse(await fs.readFile("/project/veryfront.lock")) as {
        imports: Record<string, LockfileEntry>;
      };
      assertEquals(Object.keys(onDisk.imports).sort(), [lateUrl, writtenUrl]);
      assertEquals(onDisk.imports[writtenUrl]?.integrity, "sha256-written");
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
