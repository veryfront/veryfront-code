import "#veryfront/schemas/_test-setup.ts";
/**
 * Filesystem Compat Tests
 *
 * These tests verify the cross-runtime filesystem abstractions work correctly.
 */

import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createError, toError } from "#veryfront/errors";
import {
  chmod,
  createFileSystem,
  exists,
  getPathIdentity,
  isAlreadyExistsError,
  isNotFoundError,
  lstat,
  makeTempDir,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  stat,
  symlink,
  writeFile,
  writeTextFile,
} from "./fs.ts";
import { join } from "./path/index.ts";
import { isCanonicalNotFoundError } from "./not-found-error.ts";

describe("Filesystem Compat", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await makeTempDir({ prefix: "fs-test-" });
  });

  afterAll(async () => {
    try {
      await remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("createFileSystem", () => {
    it("should create a filesystem instance", () => {
      const fs = createFileSystem();
      assertExists(fs);

      const methods = [
        "readTextFile",
        "writeTextFile",
        "rename",
        "exists",
        "mkdir",
        "remove",
        "chmod",
      ] as const;

      for (const method of methods) {
        assertEquals(typeof fs[method], "function");
      }
    });

    it("forwards bound native snapshot and exclusive-create capabilities", async () => {
      const fs = createFileSystem();
      assertExists(fs.readFileSnapshotWithinLimit);
      assertExists(fs.createFileBytesExclusive);
      const readSnapshot = fs.readFileSnapshotWithinLimit;
      const createExclusive = fs.createFileBytesExclusive;
      const source = join(testDir, "factory-snapshot.bin");
      const created = join(testDir, "factory-exclusive.bin");
      await fs.writeFile(source, new Uint8Array([1, 2, 3]));

      assertEquals([...await readSnapshot(source, testDir, 3)], [1, 2, 3]);
      await createExclusive(created, new Uint8Array([4, 5]));
      assertEquals([...await fs.readFile(created)], [4, 5]);
      await assertRejects(
        () => createExclusive(created, new Uint8Array([9])),
        Error,
      );
    });
  });

  describe("writeTextFile / readTextFile", () => {
    async function assertWriteReadTextFile(
      fileName: string,
      content: string,
    ): Promise<void> {
      const filePath = join(testDir, fileName);
      await writeTextFile(filePath, content);
      assertEquals(await readTextFile(filePath), content);
    }

    it("should write and read text files", async () => {
      await assertWriteReadTextFile("test-text.txt", "Hello, World!\nLine 2\n");
    });

    it("should handle unicode content", async () => {
      await assertWriteReadTextFile("test-unicode.txt", "こんにちは 🌍 مرحبا");
    });
  });

  describe("rename", () => {
    it("replaces a file through the rename capability", async () => {
      const fs = createFileSystem();
      assertExists(fs.rename);
      const source = join(testDir, "rename-source.txt");
      const target = join(testDir, "rename-target.txt");
      await fs.writeTextFile(source, "replacement");
      await fs.writeTextFile(target, "original");

      await fs.rename(source, target);

      assertEquals(await fs.exists(source), false);
      assertEquals(await fs.readTextFile(target), "replacement");
    });
  });

  describe("writeFile / readFile", () => {
    it("should write and read binary files", async () => {
      const filePath = join(testDir, "test-binary.bin");
      const content = new Uint8Array([0, 1, 2, 255, 254, 253]);

      await writeFile(filePath, content);
      const readContent = await readFile(filePath);

      // Compare as Uint8Array to handle Node.js Buffer vs Uint8Array differences
      const readAsUint8 = new Uint8Array(readContent);
      assertEquals(readAsUint8.length, content.length);

      for (let i = 0; i < content.length; i++) {
        assertEquals(readAsUint8[i], content[i]);
      }
    });
  });

  describe("exists", () => {
    it("should return true for existing file", async () => {
      const filePath = join(testDir, "exists-test.txt");
      await writeTextFile(filePath, "test");

      assertEquals(await exists(filePath), true);
    });

    it("should return false for non-existent file", async () => {
      const filePath = join(testDir, "does-not-exist.txt");
      assertEquals(await exists(filePath), false);
    });

    it("should return true for existing directory", async () => {
      assertEquals(await exists(testDir), true);
    });
  });

  describe("stat", () => {
    it("should return file info for a file", async () => {
      const filePath = join(testDir, "stat-test.txt");
      await writeTextFile(filePath, "test content");

      const info = await stat(filePath);
      assertEquals(info.isFile, true);
      assertEquals(info.isDirectory, false);
      assertEquals(info.size > 0, true);
    });

    it("should return file info for a directory", async () => {
      const info = await stat(testDir);
      assertEquals(info.isFile, false);
      assertEquals(info.isDirectory, true);
    });
  });

  describe("getPathIdentity", () => {
    it("returns a stable identity for a path", async () => {
      const filePath = join(testDir, "identity-test.txt");
      await writeTextFile(filePath, "identity");

      const first = await getPathIdentity(filePath);
      const second = await getPathIdentity(filePath);

      assertExists(first);
      assertEquals(second, first);
    });
  });

  describe("mkdir", () => {
    it("should create a directory", async () => {
      const dirPath = join(testDir, "new-dir");
      await mkdir(dirPath);

      assertEquals(await exists(dirPath), true);
      assertEquals((await stat(dirPath)).isDirectory, true);
    });

    it("should create nested directories with recursive option", async () => {
      const dirPath = join(testDir, "nested", "deep", "dir");
      await mkdir(dirPath, { recursive: true });

      assertEquals(await exists(dirPath), true);
    });
  });

  describe("readDir", () => {
    it("should iterate over directory entries", async () => {
      const subDir = join(testDir, "readdir-test");
      await mkdir(subDir);
      await writeTextFile(join(subDir, "file1.txt"), "1");
      await writeTextFile(join(subDir, "file2.txt"), "2");
      await mkdir(join(subDir, "subdir"));

      const entries: Array<{ name: string; isFile: boolean; isDirectory: boolean }> = [];
      for await (const entry of readDir(subDir)) {
        entries.push(entry);
      }

      assertEquals(entries.length, 3);

      const names = entries.map((e) => e.name).sort();
      assertEquals(names, ["file1.txt", "file2.txt", "subdir"]);

      const file1 = entries.find((e) => e.name === "file1.txt");
      const subdir = entries.find((e) => e.name === "subdir");

      assertEquals(file1?.isFile, true);
      assertEquals(subdir?.isDirectory, true);
    });
  });

  describe("remove", () => {
    it("should remove a file", async () => {
      const filePath = join(testDir, "to-remove.txt");
      await writeTextFile(filePath, "delete me");

      await remove(filePath);
      assertEquals(await exists(filePath), false);
    });

    it("should remove a directory with recursive option", async () => {
      const dirPath = join(testDir, "to-remove-dir");
      await mkdir(dirPath);
      await writeTextFile(join(dirPath, "file.txt"), "test");

      await remove(dirPath, { recursive: true });
      assertEquals(await exists(dirPath), false);
    });

    it("removes an empty directory without the recursive option", async () => {
      const dirPath = join(testDir, "to-remove-empty-dir");
      await mkdir(dirPath);

      await remove(dirPath);
      assertEquals(await exists(dirPath), false);
    });

    it("refuses a non-empty directory without the recursive option", async () => {
      const dirPath = join(testDir, "to-remove-populated-dir");
      await mkdir(dirPath);
      await writeTextFile(join(dirPath, "file.txt"), "test");

      await assertRejects(() => remove(dirPath), Error);
      assertEquals(await exists(dirPath), true);
    });

    it("surfaces a missing path even when recursive", async () => {
      await assertRejects(
        () => remove(join(testDir, "missing-recursive-remove"), { recursive: true }),
        Error,
      );
    });
  });

  describe("makeTempDir", () => {
    it("should create a temporary directory", async () => {
      const tempDir = await makeTempDir({ prefix: "test-temp-" });

      assertExists(tempDir);
      assertEquals(await exists(tempDir), true);
      assertEquals((await stat(tempDir)).isDirectory, true);

      await remove(tempDir, { recursive: true });
    });

    it("rejects path-bearing prefixes", async () => {
      await assertRejects(
        () => makeTempDir({ prefix: "../outside-temp-root-" }),
        Error,
      );
      await assertRejects(
        () => makeTempDir({ prefix: "nested/temp-" }),
        Error,
      );
      await assertRejects(
        () => makeTempDir({ prefix: String.raw`nested\temp-` }),
        Error,
      );
    });
  });

  describe("chmod", () => {
    it("should apply each requested mode", async () => {
      const filePath = join(testDir, "chmod-test.txt");
      await writeTextFile(filePath, "test");

      // Should not throw (chmod is a documented no-op on Windows, where mode is null)
      await chmod(filePath, 0o600);
      if (Deno.build.os !== "windows") {
        assertEquals(
          (await Deno.stat(filePath)).mode! & 0o777,
          0o600,
          "chmod must apply the requested mode",
        );
        await chmod(filePath, 0o644);
        assertEquals(
          (await Deno.stat(filePath)).mode! & 0o777,
          0o644,
          "chmod must apply each requested mode, not a fixed one",
        );
      }
    });

    it("surfaces filesystem failures", async () => {
      await assertRejects(
        () => chmod(join(testDir, "missing-chmod-target.txt"), 0o600),
        Error,
      );
    });
  });

  describe("symlink", () => {
    it("should create a symlink", async () => {
      const filePath = join(testDir, "symlink-target.txt");
      const linkPath = join(testDir, "symlink-link.txt");
      await writeTextFile(filePath, "symlink test");

      await symlink(filePath, linkPath);

      const content = await readTextFile(linkPath);
      assertEquals(content, "symlink test");
      assertEquals((await lstat(linkPath)).isSymlink, true);
    });
  });

  describe("isNotFoundError", () => {
    it("should return true for Deno.errors.NotFound", () => {
      try {
        Deno.readTextFileSync("/nonexistent/path/12345.txt");
      } catch (e) {
        assertEquals(isNotFoundError(e), true);
      }
    });

    it("should return true for Node ENOENT errors", () => {
      const error = new Error("ENOENT") as Error & { code: string };
      error.code = "ENOENT";
      assertEquals(isNotFoundError(error), true);
    });

    it("should return true when a path candidate crosses a non-directory", () => {
      const error = new Error("ENOTDIR") as Error & { code: string };
      error.code = "ENOTDIR";
      assertEquals(isNotFoundError(error), true);
    });

    it("does not classify a symbolic-link loop as a missing path", () => {
      const error = Object.assign(new Error("ELOOP"), { code: "ELOOP" });
      assertEquals(isNotFoundError(error), false);
    });

    it("should return true for VeryfrontError with file-not-found slug", () => {
      const error = new Error("File not found") as Error & { slug: string; name: string };
      error.name = "VeryfrontError";
      error.slug = "file-not-found";
      assertEquals(isNotFoundError(error), true);
    });

    it("recognizes legacy structured file-not-found errors", () => {
      const error = toError(
        createError({
          type: "file",
          message: "File not found: app/layout.mdx",
        }),
      );

      assertEquals(isNotFoundError(error), true);
    });

    it("does not classify legacy operational file errors as absence", () => {
      const error = toError(
        createError({
          type: "file",
          message: "Failed to stat app/layout.mdx: storage unavailable",
        }),
      );

      assertEquals(isNotFoundError(error), false);
    });

    it("should return true when not-found is wrapped in an Error cause chain", () => {
      const cause = new Error("ENOENT") as Error & { code: string };
      cause.code = "ENOENT";
      const wrapped = new Error("wrapper", { cause });

      assertEquals(isNotFoundError(wrapped), true);
    });

    it("should return false for generic errors", () => {
      assertEquals(isNotFoundError(new Error("generic")), false);
    });

    it("should return false for non-errors", () => {
      assertEquals(isNotFoundError("string"), false);
      assertEquals(isNotFoundError(null), false);
      assertEquals(isNotFoundError(undefined), false);
    });

    it("offers a strict classifier for fail-closed absence boundaries", () => {
      const nativeMissing = Object.assign(new Error("missing"), { code: "ENOENT" });
      const nativeWrapped = new Error("wrapped", { cause: nativeMissing });
      const shapedMissing = Object.freeze({ code: "ENOENT" });
      const shapedWrapped = new Error("wrapped", { cause: shapedMissing });
      const inheritedCode = Object.setPrototypeOf(
        new Error("inherited code"),
        Object.create(Error.prototype, {
          code: { configurable: true, value: "ENOENT" },
        }),
      );
      const inheritedCause = Object.setPrototypeOf(
        new Error("inherited cause"),
        Object.create(Error.prototype, {
          cause: { configurable: true, value: nativeMissing },
        }),
      );
      const inheritedModernName = Object.assign(
        Object.setPrototypeOf(
          new Error("inherited modern marker"),
          Object.create(Error.prototype, {
            name: { configurable: true, value: "VeryfrontError" },
          }),
        ),
        { slug: "file-not-found" },
      );
      const inheritedLegacyName = Object.assign(
        Object.setPrototypeOf(
          new Error("inherited legacy marker"),
          Object.create(Error.prototype, {
            name: { configurable: true, value: "VeryfrontError[file]" },
          }),
        ),
        { context: { type: "file", message: "File not found: example.ts" } },
      );
      const ownModernMarker = Object.assign(new Error("missing"), {
        name: "VeryfrontError",
        slug: "file-not-found",
      });
      const ownLegacyMarker = Object.assign(new Error("missing"), {
        name: "VeryfrontError[file]",
        context: { type: "file", message: "File not found: example.ts" },
      });

      assertEquals(isCanonicalNotFoundError(nativeMissing), true);
      assertEquals(isCanonicalNotFoundError(nativeWrapped), true);
      assertEquals(isCanonicalNotFoundError(shapedMissing), false);
      assertEquals(isCanonicalNotFoundError(shapedWrapped), false);
      assertEquals(isCanonicalNotFoundError(inheritedCode), false);
      assertEquals(isCanonicalNotFoundError(inheritedCause), false);
      assertEquals(isCanonicalNotFoundError(inheritedModernName), false);
      assertEquals(isCanonicalNotFoundError(inheritedLegacyName), false);
      assertEquals(isCanonicalNotFoundError(ownModernMarker), true);
      assertEquals(isCanonicalNotFoundError(ownLegacyMarker), true);
      assertEquals(isNotFoundError(shapedMissing), true);
      assertEquals(isNotFoundError(inheritedCode), true);
      assertEquals(isNotFoundError(inheritedCause), true);
      assertEquals(isNotFoundError(inheritedModernName), true);
      assertEquals(isNotFoundError(inheritedLegacyName), true);
    });

    it("treats hostile proxies and accessors as opaque without invoking hooks", () => {
      let proxyTrapCalls = 0;
      const hostileProxy = new Proxy(new Error("hostile"), {
        get() {
          proxyTrapCalls++;
          throw new Error("get trap must not run");
        },
        getPrototypeOf() {
          proxyTrapCalls++;
          throw new Error("prototype trap must not run");
        },
      });

      let causeGetterCalls = 0;
      const accessorError = new Error("hostile cause");
      Object.defineProperty(accessorError, "cause", {
        get() {
          causeGetterCalls++;
          throw new Error("cause getter must not run");
        },
      });

      assertEquals(isNotFoundError(hostileProxy), false);
      assertEquals(isNotFoundError(accessorError), false);
      assertEquals(proxyTrapCalls, 0);
      assertEquals(causeGetterCalls, 0);
    });

    it("bounds deep cause traversal and terminates cyclic cause chains", () => {
      const createCauseChain = (wrapperCount: number): Error => {
        let current: Error = Object.assign(new Error("missing"), { code: "ENOENT" });
        for (let index = 0; index < wrapperCount; index++) {
          current = new Error(`wrapper ${index}`, { cause: current });
        }
        return current;
      };

      assertEquals(isNotFoundError(createCauseChain(63)), true);
      assertEquals(isNotFoundError(createCauseChain(64)), false);

      const first = new Error("first");
      const second = new Error("second", { cause: first });
      Object.defineProperty(first, "cause", { value: second });
      assertEquals(isNotFoundError(first), false);
    });

    it("honors and updates the caller-provided seen set", () => {
      const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
      const middle = new Error("middle", { cause: missing });
      const outer = new Error("outer", { cause: middle });

      const visited = new Set<unknown>();
      assertEquals(isNotFoundError(outer, visited), true);
      assertEquals(visited.size, 3);
      assertEquals(visited.has(outer), true);
      assertEquals(visited.has(middle), true);
      assertEquals(visited.has(missing), true);

      const previsited = new Set<unknown>([middle]);
      assertEquals(isNotFoundError(outer, previsited), false);
      assertEquals(previsited.size, 2);
      assertEquals(previsited.has(outer), true);
    });

    it("does not invoke hostile prototype traps or inherited accessors", () => {
      let proxyTrapCalls = 0;
      const hostilePrototype = new Proxy(Error.prototype, {
        getOwnPropertyDescriptor() {
          proxyTrapCalls++;
          throw new Error("prototype descriptor trap must not run");
        },
        getPrototypeOf() {
          proxyTrapCalls++;
          throw new Error("prototype traversal trap must not run");
        },
      });
      const proxyPrototypeError = Object.setPrototypeOf(
        new Error("hostile prototype"),
        hostilePrototype,
      );

      let accessorCalls = 0;
      const accessorPrototype = Object.create(Error.prototype, {
        code: {
          get() {
            accessorCalls++;
            return "ENOENT";
          },
        },
      });
      const accessorPrototypeError = Object.setPrototypeOf(
        new Error("hostile inherited accessor"),
        accessorPrototype,
      );

      assertEquals(isNotFoundError(proxyPrototypeError), false);
      assertEquals(isNotFoundError(accessorPrototypeError), false);
      assertEquals(proxyTrapCalls, 0);
      assertEquals(accessorCalls, 0);
    });
  });

  describe("isAlreadyExistsError", () => {
    it("should return true for Deno.errors.AlreadyExists", async () => {
      const dirPath = join(testDir, "already-exists-test");
      await mkdir(dirPath);
      const error = await assertRejects(
        () => mkdir(dirPath),
        Error,
        undefined,
        "re-creating an existing directory without recursive must reject",
      );
      assertEquals(
        isAlreadyExistsError(error),
        true,
        "a re-create rejection must classify as already-exists",
      );
    });

    it("should return true for Node EEXIST errors", () => {
      const error = new Error("EEXIST") as Error & { code: string };
      error.code = "EEXIST";
      assertEquals(isAlreadyExistsError(error), true);
    });

    it("should return false for generic errors", () => {
      assertEquals(isAlreadyExistsError(new Error("generic")), false);
    });
  });
});
