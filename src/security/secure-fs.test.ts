import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createSecureFs, SecureFs, wrapAdapterWithSecurity } from "./secure-fs.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";
import type { RuntimeAdapter, ServeOptions, Server } from "#veryfront/platform/adapters/base.ts";
import { captureBoundedTextReader } from "#veryfront/platform/adapters/bounded-text-reader.ts";

function createMockFileSystem(
  overrides: Partial<RuntimeAdapter["fs"]> = {},
): RuntimeAdapter["fs"] {
  const ready = Promise.resolve();
  const fileSystem: RuntimeAdapter["fs"] = {
    symlinkSemantics: "none",
    readFile: () => Promise.resolve(""),
    writeFile: () => Promise.resolve(),
    stat: () =>
      Promise.resolve({
        isSymlink: false,
        isDirectory: false,
        isFile: true,
        size: 0,
        mtime: null,
      }),
    mkdir: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    exists: () => Promise.resolve(true),
    async *readDir() {},
    makeTempDir: (prefix) => Promise.resolve(`/tmp/${prefix}`),
    watch: () => ({
      ready,
      done: ready,
      close() {},
      async *[Symbol.asyncIterator]() {},
    }),
  };
  return Object.assign(fileSystem, overrides);
}

// Complete adapter stub for constructor and adapter-lifecycle tests.
function createMockAdapter() {
  return { fs: createMockFileSystem() } as RuntimeAdapter;
}

describe("SecureFs", () => {
  it("rejects inherited policy fields instead of treating them as configuration", () => {
    const inheritedConfig = Object.assign(
      Object.create({ baseDir: "/tmp" }),
      { adapter: createMockAdapter() },
    ) as Parameters<typeof createSecureFs>[0];
    assertThrows(
      () => createSecureFs(inheritedConfig),
      VeryfrontError,
      "own data property",
    );

    const inheritedValidationOptions = Object.create({ followSymlinks: true });
    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/tmp",
          adapter: createMockAdapter(),
          validationOptions: inheritedValidationOptions,
        }),
      VeryfrontError,
      "own data property",
    );

    const inheritedContextOptions = Object.create({ allowedImportDirs: ["outside"] });
    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/tmp",
          adapter: createMockAdapter(),
          contextOptions: inheritedContextOptions,
        }),
      VeryfrontError,
      "own data property",
    );
  });

  it("rejects policy accessors without invoking them", () => {
    let getterCalls = 0;
    const accessorConfig = { adapter: createMockAdapter() } as Record<string, unknown>;
    Object.defineProperty(accessorConfig, "baseDir", {
      enumerable: true,
      get() {
        getterCalls++;
        return "/tmp";
      },
    });
    assertThrows(
      () => createSecureFs(accessorConfig as unknown as Parameters<typeof createSecureFs>[0]),
      VeryfrontError,
      "own data property",
    );

    const validationOptions = {} as Record<string, unknown>;
    Object.defineProperty(validationOptions, "followSymlinks", {
      enumerable: true,
      get() {
        getterCalls++;
        return true;
      },
    });
    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/tmp",
          adapter: createMockAdapter(),
          validationOptions,
        }),
      VeryfrontError,
      "own data property",
    );

    const contextOptions = {} as Record<string, unknown>;
    Object.defineProperty(contextOptions, "allowedImportDirs", {
      enumerable: true,
      get() {
        getterCalls++;
        return ["outside"];
      },
    });
    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/tmp",
          adapter: createMockAdapter(),
          contextOptions,
        }),
      VeryfrontError,
      "own data property",
    );

    const allowedDirs = ["public"];
    Object.defineProperty(allowedDirs, "0", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls++;
        return "outside";
      },
    });
    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/tmp",
          adapter: createMockAdapter(),
          validationOptions: { allowedDirs },
        }),
      VeryfrontError,
      "dense, non-empty strings",
    );

    const accessorAdapter = {} as Record<string, unknown>;
    Object.defineProperty(accessorAdapter, "fs", {
      enumerable: true,
      get() {
        getterCalls++;
        return {};
      },
    });
    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/tmp",
          adapter: accessorAdapter as unknown as RuntimeAdapter,
        }),
      VeryfrontError,
      "own, data-property",
    );

    assertEquals(getterCalls, 0);
  });

  it("rejects wrapper option accessors without invoking them", () => {
    let getterCalls = 0;
    const options = {} as Record<string, unknown>;
    Object.defineProperty(options, "baseDir", {
      enumerable: true,
      get() {
        getterCalls++;
        return "/tmp";
      },
    });

    assertThrows(
      () =>
        wrapAdapterWithSecurity(
          createMockAdapter(),
          options as unknown as Parameters<typeof wrapAdapterWithSecurity>[1],
        ),
      VeryfrontError,
      "own data property",
    );
    assertEquals(getterCalls, 0);
  });

  it("rejects operation option and watch-path accessors without invoking them", async () => {
    let getterCalls = 0;
    const secureFs = createSecureFs({
      baseDir: "/tmp",
      adapter: createMockAdapter(),
    });
    const recursiveOptions = {} as { recursive?: boolean };
    Object.defineProperty(recursiveOptions, "recursive", {
      enumerable: true,
      get() {
        getterCalls++;
        return true;
      },
    });
    const watchPaths = ["file.txt"];
    Object.defineProperty(watchPaths, "0", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls++;
        return "outside";
      },
    });
    const watchOptions = {} as { recursive?: boolean };
    Object.defineProperty(watchOptions, "recursive", {
      enumerable: true,
      get() {
        getterCalls++;
        return true;
      },
    });

    await assertRejects(
      () => secureFs.mkdir("directory", recursiveOptions),
      VeryfrontError,
      "own data property",
    );
    assertThrows(
      () => secureFs.watch(watchPaths),
      VeryfrontError,
      "dense, non-empty strings",
    );
    assertThrows(
      () => secureFs.watch("file.txt", watchOptions),
      VeryfrontError,
      "own data property",
    );
    assertEquals(getterCalls, 0);
  });

  it("rejects unknown contexts instead of falling through to internal policy", () => {
    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/tmp",
          adapter: createMockAdapter(),
          context: "unknown" as never,
        }),
      VeryfrontError,
      "valid security context",
    );
  });

  it("rejects invalid runtime options instead of weakening validation", () => {
    for (
      const config of [
        { baseDir: "" },
        { context: null as unknown as "internal" },
        { contextOptions: null as never },
        {
          contextOptions: {
            allowedImportDirs: [""],
          },
        },
        { onSecurityEvent: "noop" as unknown as () => void },
        {
          validationOptions: {
            level: "unknown" as never,
          },
        },
        {
          validationOptions: {
            allowAbsolute: "yes" as unknown as boolean,
          },
        },
      ]
    ) {
      assertThrows(
        () =>
          createSecureFs({
            baseDir: "/tmp",
            adapter: createMockAdapter(),
            ...config,
          }),
        VeryfrontError,
        "SecureFs",
      );
    }
  });

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

  it("physically validates directory reads before iteration", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${outsideDir}/secret.txt`, "secret");
      await Deno.symlink(outsideDir, `${baseDir}/link`);
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });

      await assertRejects(
        async () => {
          for await (const _entry of secureFs.readDir("link")) {
            // Validation must reject before the adapter yields any entry.
          }
        },
        VeryfrontError,
        "outside base directory",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("physically validates watched paths before installing the watcher", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    try {
      await Deno.symlink(outsideDir, `${baseDir}/link`);
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });
      const watcher = secureFs.watch("link");

      await assertRejects(
        () => watcher.ready!,
        VeryfrontError,
        "outside base directory",
      );
      watcher.close();
    } finally {
      await Deno.remove(baseDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("installs and closes a watcher through the validated canonical path", async () => {
    const baseDir = await Deno.makeTempDir();
    try {
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });
      const watcher = secureFs.watch(".");

      await watcher.ready;
      watcher.close();
      await watcher.done;
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("snapshots allowedDirs supplied during construction", async () => {
    const baseDir = await Deno.makeTempDir();
    const allowedDirs = ["public"];
    try {
      await Deno.mkdir(`${baseDir}/private`);
      await Deno.writeTextFile(`${baseDir}/private/secret.txt`, "secret");
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
        validationOptions: { allowedDirs },
      });

      allowedDirs.push("private");

      await assertRejects(
        () => secureFs.readFile("private/secret.txt"),
        VeryfrontError,
        "not allowed",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("snapshots module-loading import directories supplied during construction", async () => {
    const baseDir = await Deno.makeTempDir();
    const allowedImportDirs = ["public"];
    try {
      await Deno.mkdir(`${baseDir}/private`);
      await Deno.writeTextFile(`${baseDir}/private/secret.txt`, "secret");
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "module-loading",
        contextOptions: { allowedImportDirs },
      });

      allowedImportDirs.push("private");

      await assertRejects(
        () => secureFs.readFile("private/secret.txt"),
        VeryfrontError,
        "not allowed",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("distinguishes an omitted module allowlist from an explicit deny-all list", async () => {
    const baseDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${baseDir}/src`);
      await Deno.writeTextFile(`${baseDir}/src/module.ts`, "export {};");
      const unrestricted = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "module-loading",
      });
      const denyAll = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "module-loading",
        contextOptions: { allowedImportDirs: [] },
      });

      assertEquals(await unrestricted.readFile("src/module.ts"), "export {};");
      await assertRejects(
        () => denyAll.readFile("src/module.ts"),
        VeryfrontError,
        "not allowed",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("returns false for missing admitted paths in existence-checking contexts", async () => {
    const baseDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${baseDir}/public`);
      await Deno.writeTextFile(`${baseDir}/public/present.txt`, "present");

      for (const context of ["user-input", "static-serving"] as const) {
        const secureFs = createSecureFs({
          baseDir,
          adapter: new DenoAdapter(),
          context,
        });

        assertEquals(await secureFs.exists("public/present.txt"), true);
        assertEquals(await secureFs.exists("public/missing.txt"), false);
      }
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("keeps the filesystem reference supplied during construction", async () => {
    const originalFs = createMockFileSystem({
      readFile: () => Promise.resolve("original"),
    });
    const replacementFs = createMockFileSystem({
      readFile: () => Promise.resolve("replacement"),
    });
    const adapter = { fs: originalFs } as RuntimeAdapter;
    const secureFs = createSecureFs({ baseDir: "/tmp", adapter });

    adapter.fs = replacementFs;

    assertEquals(await secureFs.readFile("file.txt"), "original");
  });

  it("snapshots filesystem methods supplied during construction", async () => {
    const fileSystem = createMockFileSystem({
      readFile: () => Promise.resolve("original"),
    });
    const secureFs = createSecureFs({
      baseDir: "/tmp",
      adapter: { fs: fileSystem } as RuntimeAdapter,
    });

    Object.defineProperty(fileSystem, "readFile", {
      configurable: true,
      value: () => Promise.resolve("replacement"),
    });

    assertEquals(await secureFs.readFile("file.txt"), "original");
  });

  it("snapshots filesystem symlink capabilities during construction", async () => {
    const fileSystem = createMockFileSystem({
      readFile: () => Promise.resolve("unsafe"),
    }) as RuntimeAdapter["fs"] & { symlinkSemantics?: "none" };
    Reflect.deleteProperty(fileSystem, "symlinkSemantics");
    const secureFs = createSecureFs({
      baseDir: "/tmp",
      adapter: { fs: fileSystem } as RuntimeAdapter,
    });

    fileSystem.symlinkSemantics = "none";

    await assertRejects(
      () => secureFs.readFile("file.txt"),
      VeryfrontError,
      "provide lstat",
    );
  });

  it("does not expose APIs that can mutate or bypass its policy", () => {
    const secureFs = createSecureFs({
      baseDir: "/tmp",
      adapter: createMockAdapter(),
    }) as unknown as Record<string, unknown>;

    assertEquals("getUnsafeAdapter" in secureFs, false);
    assertEquals("updateValidationOptions" in secureFs, false);
    assertEquals("setContext" in secureFs, false);
  });

  it("does not allow published metadata to forge a whole-file read ceiling", async () => {
    let unboundedReads = 0;
    const adapter = createMockAdapter();
    adapter.fs = createMockFileSystem({
      readFileBytes: () => {
        unboundedReads++;
        return Promise.resolve(new Uint8Array([1, 2]));
      },
    });
    const secureFs = createSecureFs({ baseDir: "/tmp", adapter, context: "build" });

    assertEquals(Reflect.set(secureFs, "maxWholeFileReadBytes", 1), false);
    assertEquals(Reflect.deleteProperty(secureFs, "maxWholeFileReadBytes"), false);
    await assertRejects(
      () => captureBoundedTextReader(secureFs).readUtf8("file.txt", 1, "Asset"),
      TypeError,
      "genuine exact bounded byte reader",
    );
    assertEquals(unboundedReads, 0);
  });

  it("publishes bounded filesystem capabilities as immutable own data", async () => {
    let boundedReads = 0;
    let exactReads = 0;
    const adapter = createMockAdapter();
    adapter.fs = createMockFileSystem({
      readFileBytes: () => Promise.resolve(new Uint8Array([3])),
      maxWholeFileReadBytes: 3,
      readFileBytesBounded: () => {
        boundedReads++;
        return Promise.resolve(new Uint8Array([1]));
      },
      readFileBytesWithinLimit: () => {
        exactReads++;
        return Promise.resolve(new Uint8Array([2]));
      },
    });
    const secureFs = createSecureFs({ baseDir: "/tmp", adapter, context: "build" });

    for (
      const key of [
        "maxWholeFileReadBytes",
        "readFileBytesBounded",
        "readFileBytesWithinLimit",
      ] as const
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(secureFs, key);
      assertStrictEquals(descriptor?.enumerable, true, key);
      assertStrictEquals(descriptor?.configurable, false, key);
      assertStrictEquals(descriptor?.writable, false, key);
      assertEquals(Reflect.deleteProperty(secureFs, key), false, key);
    }
    assertEquals(
      Reflect.set(secureFs, "readFileBytesBounded", async () => new Uint8Array()),
      false,
    );
    assertEquals(
      Reflect.set(secureFs, "readFileBytesWithinLimit", async () => new Uint8Array()),
      false,
    );
    assertThrows(
      () => Object.defineProperty(secureFs, "maxWholeFileReadBytes", { value: 1 }),
      TypeError,
    );

    assertEquals([...(await secureFs.readFileBytesBounded!("file.txt", 1))], [1]);
    assertEquals([...(await secureFs.readFileBytesWithinLimit!("file.txt", 1))], [2]);
    assertEquals({ boundedReads, exactReads }, { boundedReads: 1, exactReads: 1 });
  });

  it("keeps policy authority private while allowing unrelated subclass state", async () => {
    class DerivedSecureFs extends SecureFs {
      readonly marker = "derived";
    }

    const adapter = createMockAdapter();
    adapter.fs = createMockFileSystem({
      readFile: () => Promise.resolve("original"),
    });
    const secureFs = new DerivedSecureFs({ baseDir: "/tmp", adapter, context: "build" });
    const forged = secureFs as unknown as Record<string, unknown>;
    Reflect.set(forged, "fileSystem", {
      readFile: () => Promise.resolve("forged"),
    });
    Reflect.set(forged, "config", Object.freeze({}));
    Reflect.deleteProperty(forged, "validationOptions");

    assertEquals(secureFs.marker, "derived");
    assertEquals(await secureFs.readFile("file.txt"), "original");
  });

  it("keeps validation authoritative when an observer throws", async () => {
    const baseDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${baseDir}/file.txt`, "ok");
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
        onSecurityEvent() {
          throw new Error("observer failure");
        },
      });

      assertEquals(await secureFs.readFile("file.txt"), "ok");
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("creates temporary directories inside the configured trust root", async () => {
    const baseDir = await Deno.makeTempDir();
    try {
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });

      const tempDir = await secureFs.makeTempDir("vf-test-");
      assertEquals(tempDir.startsWith(`${await Deno.realPath(baseDir)}/vf-test-`), true);
      assertEquals((await Deno.stat(tempDir)).isDirectory, true);

      await assertRejects(
        () => secureFs.makeTempDir("../escape-"),
        VeryfrontError,
        "safe filename characters",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("does not emulate binary reads through lossy text encoding", async () => {
    const baseDir = await Deno.makeTempDir();
    try {
      await Deno.writeFile(`${baseDir}/binary.dat`, new Uint8Array([0xff, 0x00, 0x61]));
      const denoFileSystem = new DenoAdapter().fs;
      const fsWithoutBinary = createMockFileSystem({
        readFile: denoFileSystem.readFile.bind(denoFileSystem),
        writeFile: denoFileSystem.writeFile.bind(denoFileSystem),
        stat: denoFileSystem.stat.bind(denoFileSystem),
        lstat: denoFileSystem.lstat?.bind(denoFileSystem),
        realPath: denoFileSystem.realPath?.bind(denoFileSystem),
        mkdir: denoFileSystem.mkdir.bind(denoFileSystem),
        remove: denoFileSystem.remove.bind(denoFileSystem),
        exists: denoFileSystem.exists.bind(denoFileSystem),
        readDir: denoFileSystem.readDir.bind(denoFileSystem),
        makeTempDir: denoFileSystem.makeTempDir.bind(denoFileSystem),
        watch: denoFileSystem.watch.bind(denoFileSystem),
      });
      Reflect.deleteProperty(fsWithoutBinary, "symlinkSemantics");
      const secureFs = createSecureFs({
        baseDir,
        adapter: { fs: fsWithoutBinary } as RuntimeAdapter,
        context: "internal",
      });

      await assertRejects(
        () => secureFs.readFileBytes("binary.dat"),
        VeryfrontError,
        "binary-safe",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
    }
  });

  it("preserves bounded reads through canonical path validation", async () => {
    let receivedPath: string | undefined;
    let receivedLimit: number | undefined;
    const fileSystem = createMockFileSystem({
      readFileBytesBounded(path, byteLimit) {
        receivedPath = path;
        receivedLimit = byteLimit;
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      },
    });
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter: { fs: fileSystem } as RuntimeAdapter,
      context: "internal",
    });

    assertEquals(typeof secureFs.readFileBytesBounded, "function");
    assertEquals([...await secureFs.readFileBytesBounded!("assets/app.bin", 3)], [1, 2, 3]);
    assertEquals(receivedPath, "/project/assets/app.bin");
    assertEquals(receivedLimit, 3);
  });

  it("rejects traversal before invoking a bounded reader", async () => {
    let reads = 0;
    const fileSystem = createMockFileSystem({
      readFileBytesBounded() {
        reads++;
        return Promise.resolve(new Uint8Array());
      },
    });
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter: { fs: fileSystem } as RuntimeAdapter,
      context: "internal",
    });

    await assertRejects(
      () => secureFs.readFileBytesBounded!("../secret.bin", 1),
      VeryfrontError,
      "Path validation failed",
    );
    assertEquals(reads, 0);
  });

  it("does not advertise bounded reads when the adapter lacks the capability", () => {
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter: createMockAdapter(),
      context: "internal",
    });

    assertEquals(secureFs.readFileBytesBounded, undefined);
  });

  it("captures exact bounded reads and validates their canonical path", async () => {
    let originalCalls = 0;
    let replacementCalls = 0;
    let received: { path: string; byteLimit: number } | undefined;
    const fileSystem = createMockFileSystem({
      readFileBytesWithinLimit(path, byteLimit) {
        originalCalls++;
        received = { path, byteLimit };
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      },
    });
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter: { fs: fileSystem } as RuntimeAdapter,
      context: "internal",
    });
    fileSystem.readFileBytesWithinLimit = () => {
      replacementCalls++;
      return Promise.resolve(new Uint8Array([9]));
    };

    assertEquals(
      [...await secureFs.readFileBytesWithinLimit!("assets/app.bin", 3)],
      [1, 2, 3],
    );
    assertEquals(received, { path: "/project/assets/app.bin", byteLimit: 3 });
    assertEquals(originalCalls, 1);
    assertEquals(replacementCalls, 0);
  });

  it("post-verifies an exact reader before re-advertising its result", async () => {
    const fileSystem = createMockFileSystem({
      readFileBytesWithinLimit() {
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      },
    });
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter: { fs: fileSystem } as RuntimeAdapter,
      context: "internal",
    });

    await assertRejects(
      () => secureFs.readFileBytesWithinLimit!("assets/app.bin", 2),
      TypeError,
      "exceeds 2 bytes",
    );
  });

  it("does not let Object.prototype provide a missing filesystem method", () => {
    const fileSystem = createMockFileSystem();
    delete (fileSystem as Partial<RuntimeAdapter["fs"]>).writeFile;
    Object.defineProperty(Object.prototype, "writeFile", {
      configurable: true,
      value: () => Promise.resolve(),
    });
    try {
      assertThrows(
        () =>
          createSecureFs({
            baseDir: "/project",
            adapter: { fs: fileSystem } as RuntimeAdapter,
            context: "internal",
          }),
        VeryfrontError,
        "must provide writeFile",
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>).writeFile;
    }
  });

  it("rejects traversal and invalid limits before invoking an exact bounded reader", async () => {
    let reads = 0;
    const fileSystem = createMockFileSystem({
      readFileBytesWithinLimit() {
        reads++;
        return Promise.resolve(new Uint8Array());
      },
    });
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter: { fs: fileSystem } as RuntimeAdapter,
      context: "internal",
    });

    await assertRejects(
      () => secureFs.readFileBytesWithinLimit!("../secret.bin", 1),
      VeryfrontError,
      "Path validation failed",
    );
    await assertRejects(
      () => secureFs.readFileBytesWithinLimit!("assets/app.bin", 0),
      RangeError,
      "positive safe integer",
    );
    assertEquals(reads, 0);
  });

  it("rejects accessor and Proxy filesystem capabilities without invoking hooks", () => {
    let getterCalls = 0;
    const accessor = createMockFileSystem();
    Object.defineProperty(accessor, "readFileBytesWithinLimit", {
      get() {
        getterCalls++;
        return () => Promise.resolve(new Uint8Array());
      },
    });
    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/project",
          adapter: { fs: accessor } as RuntimeAdapter,
          context: "internal",
        }),
      VeryfrontError,
      "binary capabilities are invalid",
    );
    assertEquals(getterCalls, 0);

    let applyTraps = 0;
    const callableProxy = createMockFileSystem({
      readFileBytesWithinLimit: new Proxy(
        () => Promise.resolve(new Uint8Array()),
        {
          apply() {
            applyTraps++;
            throw new Error("must not run");
          },
        },
      ),
    });
    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/project",
          adapter: { fs: callableProxy } as RuntimeAdapter,
          context: "internal",
        }),
      VeryfrontError,
      "binary capabilities are invalid",
    );
    assertEquals(applyTraps, 0);

    let proxyTraps = 0;
    const proxied = new Proxy(createMockFileSystem(), {
      getOwnPropertyDescriptor() {
        proxyTraps++;
        throw new Error("must not run");
      },
    });
    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/project",
          adapter: { fs: proxied } as RuntimeAdapter,
          context: "internal",
        }),
      VeryfrontError,
      "Proxy",
    );
    assertEquals(proxyTraps, 0);
  });

  it("rejects an accessor-backed binary writer as sanitized configuration", () => {
    let getterCalls = 0;
    const fileSystem = createMockFileSystem();
    Object.defineProperty(fileSystem, "writeFileBytes", {
      configurable: true,
      get() {
        getterCalls++;
        return () => Promise.resolve();
      },
    });

    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/project",
          adapter: { fs: fileSystem } as RuntimeAdapter,
          context: "internal",
        }),
      VeryfrontError,
      "binary capabilities are invalid",
    );
    assertEquals(getterCalls, 0);
  });

  it("does not advertise exact bounded reads when the adapter lacks the capability", () => {
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter: createMockAdapter(),
      context: "internal",
    });

    assertEquals(secureFs.readFileBytesWithinLimit, undefined);
  });

  it("preserves a validated fixed whole-file read ceiling", () => {
    const fileSystem = createMockFileSystem({
      readFileBytes: () => Promise.resolve(new Uint8Array()),
      maxWholeFileReadBytes: 4096,
    });
    const secureFs = createSecureFs({
      baseDir: "/project",
      adapter: { fs: fileSystem } as RuntimeAdapter,
      context: "internal",
    });

    assertEquals(secureFs.maxWholeFileReadBytes, 4096);
  });

  it("rejects accessor-backed whole-file ceiling metadata without invoking it", () => {
    let getterCalls = 0;
    const fileSystem = createMockFileSystem({
      readFileBytes: () => Promise.resolve(new Uint8Array()),
    });
    Object.defineProperty(fileSystem, "maxWholeFileReadBytes", {
      get() {
        getterCalls++;
        return 4096;
      },
    });

    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/project",
          adapter: { fs: fileSystem } as RuntimeAdapter,
          context: "internal",
        }),
      VeryfrontError,
      "binary capabilities are invalid",
    );
    assertEquals(getterCalls, 0);
  });

  it("preserves adapter lifecycle methods with their original receiver", async () => {
    let initialized = false;
    let shutDown = false;
    const adapter = {
      id: "memory",
      name: "lifecycle-test",
      capabilities: {
        typescript: false,
        jsx: false,
        http2: false,
        websocket: false,
        workers: false,
        fileWatching: false,
        shell: false,
        kvStore: false,
        writableFs: false,
      },
      fs: createMockAdapter().fs,
      env: { get: () => undefined, set: () => {}, toObject: () => ({}) },
      server: {},
      serve(
        this: RuntimeAdapter,
        _handler: (request: Request) => Promise<Response> | Response,
        _options: ServeOptions,
      ): Promise<Server> {
        assertStrictEquals(this, adapter);
        return Promise.resolve({
          addr: { hostname: "localhost", port: 0 },
          stop: () => Promise.resolve(),
        });
      },
      initialize(this: RuntimeAdapter): Promise<void> {
        assertStrictEquals(this, adapter);
        initialized = true;
        return Promise.resolve();
      },
      shutdown(this: RuntimeAdapter): Promise<void> {
        assertStrictEquals(this, adapter);
        shutDown = true;
        return Promise.resolve();
      },
    } as unknown as RuntimeAdapter;

    const wrapped = wrapAdapterWithSecurity(adapter, { baseDir: "/tmp" });
    await wrapped.initialize?.();
    await wrapped.serve(() => new Response(), {});
    await wrapped.shutdown?.();

    assertEquals(initialized, true);
    assertEquals(shutDown, true);
    assertStrictEquals(wrapped.env, adapter.env);
    assertStrictEquals(wrapped.server, adapter.server);
  });
});
