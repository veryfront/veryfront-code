import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createSecureFs, wrapAdapterWithSecurity } from "./secure-fs.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { FileSnapshotChangedError } from "#veryfront/platform/adapters/file-snapshot-error.ts";
import { resolve } from "#veryfront/platform/compat/path/index.ts";

describe("SecureFs", () => {
  it("rejects a missing write target beneath a symlinked parent", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    const outsideFile = `${outsideDir}/escaped.txt`;
    try {
      await Deno.symlink(outsideDir, `${baseDir}/link`);
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });

      await assertRejects(
        () => secureFs.writeFile("link/escaped.txt", "blocked"),
        VeryfrontError,
        "outside base directory",
      );

      let outsideFileExists = true;
      try {
        await Deno.stat(outsideFile);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) outsideFileExists = false;
        else throw error;
      }
      assertEquals(outsideFileExists, false);
    } finally {
      await Deno.remove(baseDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("rejects a symlink escape after an unresolved parent traversal", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    const outsideFile = `${outsideDir}/escaped.txt`;
    try {
      await Deno.symlink(outsideDir, `${baseDir}/link`);
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });

      await assertRejects(
        () => secureFs.writeFile("missing/../link/escaped.txt", "blocked"),
        VeryfrontError,
        "outside base directory",
      );

      let outsideFileExists = true;
      try {
        await Deno.stat(outsideFile);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) outsideFileExists = false;
        else throw error;
      }
      assertEquals(outsideFileExists, false);
    } finally {
      await Deno.remove(baseDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("binds snapshot reads to captured authority, canonical paths, and the construction root", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/assets/app.bin", "present");
    let originalCalls = 0;
    let replacementCalls = 0;
    let received: [string, string, number] | undefined;
    const source = new Uint8Array([1, 2, 3]);
    Object.defineProperty(adapter.fs, "readFileSnapshotWithinLimit", {
      configurable: true,
      value(path: string, root: string, byteLimit: number) {
        originalCalls++;
        received = [path, root, byteLimit];
        return Promise.resolve(source);
      },
    });
    const config = {
      baseDir: "/project/./",
      adapter,
      context: "internal" as const,
    };
    const secureFs = createSecureFs(config);
    config.baseDir = "/attacker";
    Object.defineProperty(adapter.fs, "readFileSnapshotWithinLimit", {
      configurable: true,
      value() {
        replacementCalls++;
        return Promise.resolve(new Uint8Array([9]));
      },
    });

    const result = await secureFs.readFileSnapshotWithinLimit!("assets/app.bin", 3);
    source[0] = 9;

    assertEquals([...result], [1, 2, 3]);
    assertEquals(received?.[0], "/project/assets/app.bin");
    assertEquals(resolve(received?.[1] ?? ""), "/project");
    assertEquals(received?.[2], 3);
    assertEquals({ originalCalls, replacementCalls }, { originalCalls: 1, replacementCalls: 0 });
  });

  it("rejects traversal before invoking raw snapshot authority", async () => {
    const adapter = createMockAdapter();
    let reads = 0;
    Object.defineProperty(adapter.fs, "readFileSnapshotWithinLimit", {
      configurable: true,
      value() {
        reads++;
        return Promise.resolve(new Uint8Array());
      },
    });
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter,
      context: "internal",
    });

    await assertRejects(
      () => secureFs.readFileSnapshotWithinLimit!("../secret.txt", 3),
      VeryfrontError,
      "Path validation failed",
    );
    assertEquals(reads, 0);
  });

  it("quarantines malformed ordinary readers without vetoing snapshot authority", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/asset.bin", "present");
    let getterCalls = 0;
    Object.defineProperty(adapter.fs, "readFileSnapshotWithinLimit", {
      configurable: true,
      value: () => Promise.resolve(new Uint8Array([4])),
    });
    Object.defineProperty(adapter.fs, "readFileBytesWithinLimit", {
      configurable: true,
      get() {
        getterCalls++;
        throw new Error("must not run");
      },
    });

    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter,
      context: "internal",
    });
    assertEquals(
      [...await secureFs.readFileSnapshotWithinLimit!("asset.bin", 1)],
      [4],
    );
    assertEquals(secureFs.readFileBytesWithinLimit, undefined);
    assertEquals(getterCalls, 0);
  });

  it("fails closed instead of reconstructing binary data from a text read", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/asset.bin", "text fallback must not run");
    let textReads = 0;
    const readFile = adapter.fs.readFile;
    adapter.fs.readFile = (path: string) => {
      textReads++;
      return readFile(path);
    };
    for (
      const key of [
        "readFileBytes",
        "readFileBytesBounded",
        "readFileBytesWithinLimit",
        "readFileSnapshotWithinLimit",
      ] as const
    ) {
      Reflect.deleteProperty(adapter.fs, key);
    }

    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter,
      context: "internal",
    });

    await assertRejects(
      () => secureFs.readFileBytes("asset.bin"),
      TypeError,
      "binary-safe file reads",
    );
    assertEquals(textReads, 0);
  });

  it("captures binary-read authority and isolates returned bytes", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/asset.bin", "present");
    const source = new Uint8Array([0xff, 0x00]);
    Object.defineProperty(adapter.fs, "readFileBytes", {
      configurable: true,
      value: () => Promise.resolve(source),
    });

    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter,
      context: "internal",
    });
    adapter.fs.readFileBytes = () => Promise.resolve(new Uint8Array([9]));

    const result = await secureFs.readFileBytes("asset.bin");
    source[0] = 1;
    assertEquals([...result], [0xff, 0x00]);
  });

  it("rejects generation changes around virtual snapshots", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/asset.bin", "old");
    Reflect.deleteProperty(adapter.fs, "readFileSnapshotWithinLimit");
    const exact = adapter.fs.readFileBytesWithinLimit;
    let mutateDuringRead = false;
    Object.defineProperty(adapter.fs, "readFileBytesWithinLimit", {
      configurable: true,
      value: async (path: string, byteLimit: number) => {
        const bytes = await exact(path, byteLimit);
        if (mutateDuringRead) adapter.fs.files.set(path, "new");
        return bytes;
      },
    });
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter,
      context: "internal",
    });

    assertEquals(
      new TextDecoder().decode(
        await secureFs.readFileSnapshotWithinLimit!("asset.bin", 3),
      ),
      "old",
    );
    mutateDuringRead = true;
    await assertRejects(
      () => secureFs.readFileSnapshotWithinLimit!("asset.bin", 3),
      FileSnapshotChangedError,
    );
  });

  it("accepts an initial zero generation for virtual snapshots", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/asset.bin", "old");
    Reflect.deleteProperty(adapter.fs, "readFileSnapshotWithinLimit");
    Object.defineProperty(adapter.fs, "getSourceSnapshotVersion", {
      configurable: true,
      value: () => 0,
    });
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter,
      context: "internal",
    });

    assertEquals(
      new TextDecoder().decode(
        await secureFs.readFileSnapshotWithinLimit!("asset.bin", 3),
      ),
      "old",
    );
  });

  it("captures module-loading allowlists and preserves them across context changes", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/allowed/module.ts", "allowed");
    adapter.fs.files.set("/project/secret/module.ts", "secret");
    const allowedImportDirs = ["allowed"];
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter,
      context: "internal",
      contextOptions: { allowedImportDirs },
    });
    allowedImportDirs[0] = "secret";

    secureFs.setContext("module-loading");
    assertEquals(await secureFs.readFile("allowed/module.ts"), "allowed");
    await assertRejects(
      () => secureFs.readFile("secret/module.ts"),
      VeryfrontError,
      "not allowed",
    );
  });

  it("does not let validation updates replace the construction root or adapter", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/outside/secret.txt", "secret");
    const replacement = createMockAdapter();
    replacement.fs.files.set("/outside/secret.txt", "replacement");
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter,
      context: "internal",
    });

    secureFs.updateValidationOptions({
      baseDir: "/outside",
      adapter: replacement,
      allowAbsolute: true,
    });
    await assertRejects(
      () => secureFs.readFile("/outside/secret.txt"),
      VeryfrontError,
      "outside base directory",
    );
  });

  it("publishes captured capabilities as immutable own data", () => {
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter: createMockAdapter(),
      context: "internal",
    });
    for (
      const key of [
        "maxWholeFileReadBytes",
        "readFileBytesBounded",
        "readFileBytesWithinLimit",
        "readFileSnapshotWithinLimit",
        "createFileBytesExclusive",
      ] as const
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(secureFs, key);
      assertEquals(descriptor?.enumerable, true, key);
      assertEquals(descriptor?.configurable, false, key);
      assertEquals(descriptor?.writable, false, key);
      assertEquals(Reflect.deleteProperty(secureFs, key), false, key);
    }
    assertEquals(
      Reflect.set(secureFs, "readFileBytesWithinLimit", () => Promise.resolve(new Uint8Array())),
      false,
    );
  });

  it("keeps raw and rooted snapshot signatures distinct on secured adapters", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/asset.bin", "present");
    let received: [string, string, number] | undefined;
    Object.defineProperty(adapter.fs, "readFileSnapshotWithinLimit", {
      configurable: true,
      value(path: string, root: string, byteLimit: number) {
        received = [path, root, byteLimit];
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      },
    });
    const wrapped = wrapAdapterWithSecurity(adapter, {
      baseDir: "/project",
      context: "internal",
    });

    assertEquals(
      [
        ...await wrapped.fs.readFileSnapshotWithinLimit!(
          "/project/asset.bin",
          "/project",
          3,
        ),
      ],
      [1, 2, 3],
    );
    assertEquals(received, ["/project/asset.bin", "/project", 3]);
    assertThrows(
      () =>
        wrapped.fs.readFileSnapshotWithinLimit!(
          "/project/asset.bin",
          "/attacker",
          3,
        ),
      TypeError,
      "construction-time root",
    );
  });

  describe("getUnsafeAdapter", () => {
    it("throws in production", () => {
      const originalEnv = Deno.env.get("NODE_ENV");
      try {
        Deno.env.set("NODE_ENV", "production");
        const secureFs = createSecureFs({
          baseDir: "/tmp",
          adapter: createMockAdapter(),
        });

        assertThrows(
          () => secureFs.getUnsafeAdapter(),
          VeryfrontError,
          "not allowed in production",
        );
      } finally {
        if (originalEnv !== undefined) {
          Deno.env.set("NODE_ENV", originalEnv);
        } else {
          Deno.env.delete("NODE_ENV");
        }
      }
    });

    it("returns adapter in development", () => {
      const originalEnv = Deno.env.get("NODE_ENV");
      try {
        Deno.env.set("NODE_ENV", "development");
        const adapter = createMockAdapter();
        const secureFs = createSecureFs({
          baseDir: "/tmp",
          adapter,
        });

        const result = secureFs.getUnsafeAdapter();
        assertEquals(result, adapter);
      } finally {
        if (originalEnv !== undefined) {
          Deno.env.set("NODE_ENV", originalEnv);
        } else {
          Deno.env.delete("NODE_ENV");
        }
      }
    });
  });
});
