import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertStrictEquals,
  fail,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  createEsbuildBinaryInitializer,
  type EsbuildInitializationRuntime,
} from "./esbuild-init.ts";
import { dirname, join, toFileUrl } from "./path/index.ts";
import { ESBUILD_VERSION, getEsbuildBinaryName } from "./esbuild-shared.ts";

interface FakeFile {
  bytes: Uint8Array;
  mode: number | null;
}

interface FakeRuntimeState {
  chmodCalls: Array<{ mode: number; path: string }>;
  cleanupRegistrations: string[];
  denoEnv: Map<string, string>;
  files: Map<string, FakeFile>;
  makeTempDirCalls: Array<{ prefix: string }>;
  processEnv: Map<string, string>;
  readFileCalls: string[];
  removeCalls: string[];
  writeFileCalls: Array<{ mode: number; path: string }>;
}

function createFakeRuntime(
  overrides: Partial<EsbuildInitializationRuntime> = {},
): { runtime: EsbuildInitializationRuntime; sourcePath: string; state: FakeRuntimeState } {
  const build = overrides.build ?? { arch: "aarch64", os: "darwin" };
  const vfsBase = "/bundle/deno-compile-test space";
  const executableName = build.os === "windows" ? "esbuild.exe" : "esbuild";
  const sourcePath = `${vfsBase}/node_modules/${getEsbuildBinaryName(build)}/bin/${executableName}`;
  const state: FakeRuntimeState = {
    chmodCalls: [],
    cleanupRegistrations: [],
    denoEnv: new Map(),
    files: new Map([[sourcePath, { bytes: new Uint8Array([1, 2, 3]), mode: 0o555 }]]),
    makeTempDirCalls: [],
    processEnv: new Map(),
    readFileCalls: [],
    removeCalls: [],
    writeFileCalls: [],
  };
  let tempDirectorySequence = 0;

  const runtime: EsbuildInitializationRuntime = {
    build,
    denoEnv: {
      delete: (name) => state.denoEnv.delete(name),
      get: (name) => state.denoEnv.get(name),
      set: (name, value) => state.denoEnv.set(name, value),
    },
    isCompiled: true,
    moduleUrl: "file:///bundle/deno-compile-test%20space/src/platform/compat/esbuild-init.ts",
    processEnv: {
      delete: (name) => state.processEnv.delete(name),
      get: (name) => state.processEnv.get(name),
      set: (name, value) => state.processEnv.set(name, value),
    },
    chmod: (path, mode) => {
      state.chmodCalls.push({ mode, path });
      const file = state.files.get(path);
      if (!file) throw new Error("missing file");
      file.mode = mode;
      return Promise.resolve();
    },
    makeTempDir: (options) => {
      state.makeTempDirCalls.push(options);
      tempDirectorySequence += 1;
      return Promise.resolve(`/runtime-temp/private-${tempDirectorySequence}`);
    },
    readFile: (path) => {
      state.readFileCalls.push(path);
      const file = state.files.get(path);
      if (!file) return Promise.reject(new Error("missing file"));
      return Promise.resolve(file.bytes.slice());
    },
    registerCleanup: (path) => {
      state.cleanupRegistrations.push(path);
    },
    remove: (path) => {
      state.removeCalls.push(path);
      for (const filePath of state.files.keys()) {
        if (filePath === path || filePath.startsWith(`${path}/`)) state.files.delete(filePath);
      }
      return Promise.resolve();
    },
    stat: (path) => {
      const file = state.files.get(path);
      if (!file) return Promise.resolve(null);
      return Promise.resolve({ isFile: true, mode: file.mode, size: file.bytes.byteLength });
    },
    writeFile: (path, data, options) => {
      state.writeFileCalls.push({ mode: options.mode, path });
      if (state.files.has(path)) return Promise.reject(new Error("file exists"));
      state.files.set(path, { bytes: data.slice(), mode: options.mode });
      return Promise.resolve();
    },
    ...overrides,
  };

  return { runtime, sourcePath, state };
}

async function captureInitializationError(operation: () => Promise<void>): Promise<VeryfrontError> {
  try {
    await operation();
  } catch (error) {
    assertInstanceOf(error, VeryfrontError);
    return error;
  }
  return fail("Expected esbuild initialization to fail");
}

describe("platform/compat/esbuild-init", () => {
  it("does not access the environment or filesystem outside a compiled runtime", async () => {
    const { runtime, state } = createFakeRuntime({
      denoEnv: {
        delete: () => false,
        get: () => {
          throw new Error("environment must not be read");
        },
        set: () => {
          throw new Error("environment must not be written");
        },
      },
      isCompiled: false,
    });

    await createEsbuildBinaryInitializer(runtime)();

    assertEquals(state.readFileCalls, []);
    assertEquals(state.makeTempDirCalls, []);
  });

  it("respects a preconfigured ESBUILD_BINARY_PATH without filesystem access", async () => {
    const { runtime, state } = createFakeRuntime();
    state.denoEnv.set("ESBUILD_BINARY_PATH", "/configured/esbuild");

    await createEsbuildBinaryInitializer(runtime)();

    assertEquals(state.denoEnv.get("ESBUILD_BINARY_PATH"), "/configured/esbuild");
    assertEquals(state.readFileCalls, []);
    assertEquals(state.makeTempDirCalls, []);
  });

  it("does not read the process environment after finding a Deno configuration", async () => {
    const { runtime, state } = createFakeRuntime();
    state.denoEnv.set("ESBUILD_BINARY_PATH", "/configured/esbuild");
    runtime.processEnv.get = () => {
      throw new Error("process environment must not be read");
    };

    await createEsbuildBinaryInitializer(runtime)();

    assertEquals(state.denoEnv.get("ESBUILD_BINARY_PATH"), "/configured/esbuild");
    assertEquals(state.makeTempDirCalls, []);
  });

  it("also respects a path configured through the process environment", async () => {
    const { runtime, state } = createFakeRuntime();
    state.processEnv.set("ESBUILD_BINARY_PATH", "/configured/esbuild");

    await createEsbuildBinaryInitializer(runtime)();

    assertEquals(state.processEnv.get("ESBUILD_BINARY_PATH"), "/configured/esbuild");
    assertEquals(state.readFileCalls, []);
    assertEquals(state.makeTempDirCalls, []);
  });

  it("extracts to a private unique directory before publishing the binary path", async () => {
    const { runtime, sourcePath, state } = createFakeRuntime();

    await createEsbuildBinaryInitializer(runtime)();

    const binaryPath = state.denoEnv.get("ESBUILD_BINARY_PATH");
    assertExists(binaryPath);
    assertEquals(binaryPath, "/runtime-temp/private-1/esbuild");
    assertEquals(state.processEnv.get("ESBUILD_BINARY_PATH"), binaryPath);
    assertEquals(state.makeTempDirCalls, [{ prefix: "veryfront-esbuild-" }]);
    assertEquals(state.readFileCalls, [sourcePath]);
    assertEquals(state.writeFileCalls, [{ mode: 0o700, path: binaryPath }]);
    assertEquals(state.chmodCalls, [{ mode: 0o700, path: binaryPath }]);
    assertEquals(state.cleanupRegistrations, ["/runtime-temp/private-1"]);
    const extractedFile = state.files.get(binaryPath);
    assertExists(extractedFile);
    assert(extractedFile.bytes.byteLength > 0);
    assertEquals(extractedFile.mode, 0o700);
  });

  it("finds the escaped scoped-package layout produced by Deno", async () => {
    const { runtime, state } = createFakeRuntime();
    const binaryName = getEsbuildBinaryName(runtime.build);
    const packageStoreName = binaryName.replace("/", "+");
    const sourcePath =
      `/bundle/deno-compile-test space/node_modules/.deno/${packageStoreName}@${ESBUILD_VERSION}` +
      `/node_modules/${binaryName}/bin/esbuild`;
    state.files.clear();
    state.files.set(sourcePath, { bytes: new Uint8Array([1, 2, 3]), mode: 0o555 });

    await createEsbuildBinaryInitializer(runtime)();

    assertEquals(state.readFileCalls, [sourcePath]);
    assertEquals(
      state.denoEnv.get("ESBUILD_BINARY_PATH"),
      "/runtime-temp/private-1/esbuild",
    );
  });

  it("creates a private executable containing the complete source bytes", async () => {
    const testRoot = await Deno.makeTempDir({ prefix: "esbuild-init-test-" });
    const denoEnv = new Map<string, string>();
    const processEnv = new Map<string, string>();
    const environment = (values: Map<string, string>) => ({
      delete: (name: string) => values.delete(name),
      get: (name: string) => values.get(name),
      set: (name: string, value: string) => values.set(name, value),
    });

    try {
      const vfsBase = join(testRoot, "deno-compile-fixture");
      const binaryName = getEsbuildBinaryName(Deno.build);
      const executableName = Deno.build.os === "windows" ? "esbuild.exe" : "esbuild";
      const sourcePath = join(vfsBase, "node_modules", binaryName, "bin", executableName);
      const sourceBytes = new Uint8Array([0, 1, 2, 3, 4, 255]);
      await Deno.mkdir(dirname(sourcePath), { recursive: true });
      await Deno.writeFile(sourcePath, sourceBytes);

      const runtime: EsbuildInitializationRuntime = {
        build: Deno.build,
        denoEnv: environment(denoEnv),
        isCompiled: true,
        moduleUrl: toFileUrl(join(vfsBase, "src/platform/compat/esbuild-init.ts")).href,
        processEnv: environment(processEnv),
        chmod: (path, mode) => Deno.chmod(path, mode),
        makeTempDir: (options) => Deno.makeTempDir({ ...options, dir: testRoot }),
        readFile: (path) => Deno.readFile(path),
        registerCleanup: () => undefined,
        remove: (path) => Deno.remove(path, { recursive: true }),
        stat: async (path) => {
          try {
            return await Deno.stat(path);
          } catch (error) {
            if (error instanceof Deno.errors.NotFound) return null;
            throw error;
          }
        },
        writeFile: (path, data, options) => Deno.writeFile(path, data, options),
      };

      await createEsbuildBinaryInitializer(runtime)();

      const extractedPath = denoEnv.get("ESBUILD_BINARY_PATH");
      assertExists(extractedPath);
      assertEquals(processEnv.get("ESBUILD_BINARY_PATH"), extractedPath);
      assertEquals(await Deno.readFile(extractedPath), sourceBytes);
      const extractedDirectoryStat = await Deno.stat(dirname(extractedPath));
      const extractedFileStat = await Deno.stat(extractedPath);
      if (Deno.build.os !== "windows") {
        assertEquals((extractedDirectoryStat.mode ?? 0) & 0o777, 0o700);
        assertEquals((extractedFileStat.mode ?? 0) & 0o777, 0o700);
      }
      assert(extractedFileStat.isFile);
      assertEquals(extractedFileStat.size, sourceBytes.byteLength);
    } finally {
      await Deno.remove(testRoot, { recursive: true });
    }
  });

  it("fails with a sanitized typed error when the compiled binary is absent", async () => {
    const { runtime, state } = createFakeRuntime();
    state.files.clear();

    const error = await captureInitializationError(
      createEsbuildBinaryInitializer(runtime),
    );

    assertEquals(error.slug, "initialization-error");
    assertEquals(error.message, "Veryfront could not initialize esbuild.");
    assertEquals(error.cause, undefined);
    assertEquals(error.context, { component: "esbuild", reason: "binary-not-found" });
    assertEquals(state.makeTempDirCalls, [{ prefix: "veryfront-esbuild-" }]);
    assertEquals(state.removeCalls, ["/runtime-temp/private-1"]);
  });

  it("sanitizes environment permission failures without touching the filesystem", async () => {
    const privateFailure = "PRIVATE_ENVIRONMENT_FAILURE";
    const { runtime, state } = createFakeRuntime({
      denoEnv: {
        delete: () => false,
        get: () => {
          throw new Error(privateFailure);
        },
        set: () => undefined,
      },
    });

    const error = await captureInitializationError(
      createEsbuildBinaryInitializer(runtime),
    );

    assertEquals(error.context, { component: "esbuild", reason: "environment-read-failed" });
    assertEquals(error.cause, undefined);
    assert(!JSON.stringify(error).includes(privateFailure));
    assertEquals(state.makeTempDirCalls, []);
  });

  it("rejects a non-file module URL before creating extraction resources", async () => {
    const { runtime, state } = createFakeRuntime({
      moduleUrl: "https://example.invalid/esbuild-init.ts",
    });

    const error = await captureInitializationError(
      createEsbuildBinaryInitializer(runtime),
    );

    assertEquals(error.context, { component: "esbuild", reason: "module-url-invalid" });
    assertEquals(state.makeTempDirCalls, []);
  });

  it("rejects an empty source binary and removes its staging directory", async () => {
    const { runtime, sourcePath, state } = createFakeRuntime();
    state.files.set(sourcePath, { bytes: new Uint8Array(), mode: 0o555 });

    const error = await captureInitializationError(
      createEsbuildBinaryInitializer(runtime),
    );

    assertEquals(error.context, { component: "esbuild", reason: "binary-invalid" });
    assertEquals(state.removeCalls, ["/runtime-temp/private-1"]);
    assertEquals(state.denoEnv.get("ESBUILD_BINARY_PATH"), undefined);
    assertEquals(state.processEnv.get("ESBUILD_BINARY_PATH"), undefined);
  });

  it("does not publish a partially written executable", async () => {
    const { runtime, state } = createFakeRuntime();
    runtime.writeFile = (path, data, options) => {
      state.writeFileCalls.push({ mode: options.mode, path });
      state.files.set(path, { bytes: data.slice(0, 1), mode: options.mode });
      return Promise.resolve();
    };

    const error = await captureInitializationError(
      createEsbuildBinaryInitializer(runtime),
    );

    assertEquals(error.context, { component: "esbuild", reason: "binary-invalid" });
    assertEquals(state.removeCalls, ["/runtime-temp/private-1"]);
    assertEquals(state.cleanupRegistrations, []);
    assertEquals(state.denoEnv.get("ESBUILD_BINARY_PATH"), undefined);
    assertEquals(state.processEnv.get("ESBUILD_BINARY_PATH"), undefined);
  });

  it("does not expose filesystem failures and removes partial extraction resources", async () => {
    const privateFailure = "PRIVATE_FILESYSTEM_FAILURE:/private/path";
    const { runtime, state } = createFakeRuntime({
      readFile: () => Promise.reject(new Error(privateFailure)),
    });

    const error = await captureInitializationError(
      createEsbuildBinaryInitializer(runtime),
    );

    assertEquals(error.context, { component: "esbuild", reason: "extraction-failed" });
    assertEquals(error.cause, undefined);
    assert(!JSON.stringify(error).includes(privateFailure));
    assert(!JSON.stringify(error).includes("/private/path"));
    assertEquals(state.removeCalls, ["/runtime-temp/private-1"]);
  });

  it("rolls back both environments and removes the binary when publication fails", async () => {
    const { runtime, state } = createFakeRuntime();
    state.denoEnv.set("ESBUILD_BINARY_PATH", "");
    state.processEnv.set("ESBUILD_BINARY_PATH", "");
    runtime.processEnv.set = (name, value) => {
      if (value.startsWith("/runtime-temp/")) {
        throw new Error("PRIVATE_PROCESS_ENV_FAILURE");
      }
      state.processEnv.set(name, value);
    };

    const error = await captureInitializationError(
      createEsbuildBinaryInitializer(runtime),
    );

    assertEquals(error.context, { component: "esbuild", reason: "environment-write-failed" });
    assertEquals(state.denoEnv.get("ESBUILD_BINARY_PATH"), "");
    assertEquals(state.processEnv.get("ESBUILD_BINARY_PATH"), "");
    assertEquals(state.removeCalls, ["/runtime-temp/private-1"]);
    assertEquals(state.files.has("/runtime-temp/private-1/esbuild"), false);
  });

  it("coalesces concurrent initialization into one extraction", async () => {
    let releaseRead: (() => void) | undefined;
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const readReleased = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const { runtime, state } = createFakeRuntime();
    const originalReadFile = runtime.readFile;
    runtime.readFile = async (path) => {
      markReadStarted?.();
      await readReleased;
      return await originalReadFile(path);
    };
    const initialize = createEsbuildBinaryInitializer(runtime);

    const first = initialize();
    await readStarted;
    const second = initialize();

    assertStrictEquals(first, second);
    assertEquals(state.makeTempDirCalls.length, 1);
    releaseRead?.();
    await Promise.all([first, second]);
    await initialize();
    assertEquals(state.makeTempDirCalls.length, 1);
  });

  it("can retry with a new private directory after a failed attempt", async () => {
    const { runtime, sourcePath, state } = createFakeRuntime();
    const source = state.files.get(sourcePath);
    assertExists(source);
    state.files.delete(sourcePath);
    const initialize = createEsbuildBinaryInitializer(runtime);

    await captureInitializationError(initialize);
    state.files.set(sourcePath, source);
    await initialize();

    assertEquals(state.makeTempDirCalls.length, 2);
    assertEquals(state.removeCalls, ["/runtime-temp/private-1"]);
    assertEquals(
      state.denoEnv.get("ESBUILD_BINARY_PATH"),
      "/runtime-temp/private-2/esbuild",
    );
  });

  it("uses the native executable name and permission behavior on Windows", async () => {
    const { runtime, state } = createFakeRuntime({
      build: { arch: "x86_64", os: "windows" },
    });

    await createEsbuildBinaryInitializer(runtime)();

    assertEquals(
      state.denoEnv.get("ESBUILD_BINARY_PATH"),
      "/runtime-temp/private-1/esbuild.exe",
    );
    assertEquals(state.chmodCalls, []);
  });
});
