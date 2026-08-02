import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createBuildContext, createShimFile, getExternalDependencies } from "./build-context.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import type { BuildContext, BundleOptions, Bundler } from "veryfront/extensions/bundler";

function getInjectedShim(options: BundleOptions): string {
  const inject = options.inject;
  if (!Array.isArray(inject) || typeof inject[0] !== "string") {
    throw new TypeError("Expected one injected code-splitter shim");
  }
  return inject[0];
}

function bundlerWithContext(
  createContext: (options: BundleOptions) => Promise<BuildContext>,
): Bundler {
  return {
    bundle: () => Promise.resolve({ outputFiles: [], warnings: [], errors: [] }),
    transform: () => Promise.resolve({ code: "", warnings: [] }),
    context: createContext,
  };
}

async function withBundler<T>(bundler: Bundler, operation: () => Promise<T>): Promise<T> {
  const previous = tryResolve<Bundler>("Bundler");
  register("Bundler", bundler);
  try {
    return await operation();
  } finally {
    unregister("Bundler");
    if (previous !== undefined) register("Bundler", previous);
  }
}

async function replaceShimWithNonEmptyDirectory(shimPath: string): Promise<void> {
  await Deno.remove(shimPath);
  await Deno.mkdir(shimPath);
  await Deno.writeTextFile(`${shimPath}/child`, "occupied");
}

function testSplitOptions(outDir: string) {
  return {
    projectDir: outDir,
    outDir,
    mode: "production" as const,
    routes: [],
  };
}

describe("build/bundler/code-splitter/build-context", () => {
  describe("getExternalDependencies", () => {
    const REACT_EXTERNALS = [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ];

    const VERYFRONT_CLIENT_MODULES = [
      "veryfront/chat",
      "veryfront/markdown",
      "veryfront/mdx",
      "veryfront/workflow",
    ];

    function assertIncludesAll(
      result: string[],
      expected: string[],
      messagePrefix: string,
    ): void {
      for (const item of expected) {
        assertEquals(result.includes(item), true, `${messagePrefix}: ${item}`);
      }
    }

    function assertExcludesAll(
      result: string[],
      expected: string[],
      messagePrefix: string,
    ): void {
      for (const item of expected) {
        assertEquals(result.includes(item), false, `${messagePrefix}: ${item}`);
      }
    }

    it("should include React externals by default", () => {
      const result = getExternalDependencies();
      assertIncludesAll(result, REACT_EXTERNALS, "Missing React external");
    });

    it("should include Veryfront client modules for cdn mode (default)", () => {
      const result = getExternalDependencies([], "cdn");
      assertIncludesAll(result, VERYFRONT_CLIENT_MODULES, "Missing Veryfront module");
    });

    it("should include Veryfront client modules for self-hosted mode", () => {
      const result = getExternalDependencies([], "self-hosted");
      assertIncludesAll(result, VERYFRONT_CLIENT_MODULES, "Missing Veryfront module");
    });

    it("should exclude Veryfront client modules for bundled mode", () => {
      const result = getExternalDependencies([], "bundled");
      assertExcludesAll(result, VERYFRONT_CLIENT_MODULES, "Should not include");
    });

    it("should append custom external dependencies", () => {
      const result = getExternalDependencies(["lodash", "axios"]);
      assertIncludesAll(result, ["lodash", "axios"], "Missing custom external");
    });

    it("should combine React, Veryfront, and custom externals for cdn mode", () => {
      const result = getExternalDependencies(["custom-lib"], "cdn");
      assertIncludesAll(
        result,
        ["react", "veryfront/chat", "custom-lib"],
        "Missing external",
      );
    });

    it("should handle empty custom array", () => {
      const result = getExternalDependencies([]);
      assertIncludesAll(result, REACT_EXTERNALS, "Missing React external");
    });

    it("should not duplicate entries", () => {
      const result = getExternalDependencies(["react"]);
      const reactCount = result.filter((r) => r === "react").length;
      assertEquals(reactCount, 1);
    });
  });

  describe("createShimFile", () => {
    const tmpDir = Deno.makeTempDirSync();

    afterAll(async () => {
      try {
        await Deno.remove(tmpDir, { recursive: true });
      } catch (_) {
        /* cleanup best-effort */
      }
    });

    it("should create a shim file in the specified directory", async () => {
      const shimPath = await createShimFile(tmpDir);
      assertEquals(shimPath.includes(".veryfront-shim-"), true);
    });

    it("should write global polyfills", async () => {
      const shimPath = await createShimFile(tmpDir);
      const fs = createFileSystem();
      const content = await fs.readTextFile(shimPath);
      assertEquals(content.includes("global"), true);
      assertEquals(content.includes("process"), true);
    });

    it("should include react import map", async () => {
      const shimPath = await createShimFile(tmpDir);
      const fs = createFileSystem();
      const content = await fs.readTextFile(shimPath);
      assertEquals(content.includes("__veryfront_react_imports"), true);
    });
  });

  describe("createBuildContext lifecycle", () => {
    it("coalesces concurrent disposal", async () => {
      const outDir = await Deno.makeTempDir({ prefix: "vf-splitter-context-" });
      let disposeCalls = 0;
      let releaseDispose: () => void = () => {};
      const disposeBarrier = new Promise<void>((resolve) => {
        releaseDispose = resolve;
      });

      try {
        const wrapped = await withBundler(
          bundlerWithContext(() =>
            Promise.resolve({
              rebuild: () => Promise.resolve({ outputFiles: [], warnings: [], errors: [] }),
              async dispose() {
                disposeCalls++;
                await disposeBarrier;
              },
            })
          ),
          () => createBuildContext(testSplitOptions(outDir), {}),
        );

        const first = wrapped.dispose();
        const second = wrapped.dispose();
        assertEquals(first === second, true);
        assertEquals(disposeCalls, 1);
        releaseDispose();
        await Promise.all([first, second]);
        assertEquals(disposeCalls, 1);
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("retries only the disposal work that failed", async () => {
      const outDir = await Deno.makeTempDir({ prefix: "vf-splitter-context-" });
      const disposeFailure = new Error("delegate disposal failed");
      let disposeCalls = 0;

      try {
        const wrapped = await withBundler(
          bundlerWithContext(() =>
            Promise.resolve({
              rebuild: () => Promise.resolve({ outputFiles: [], warnings: [], errors: [] }),
              dispose() {
                disposeCalls++;
                return disposeCalls === 1 ? Promise.reject(disposeFailure) : Promise.resolve();
              },
            })
          ),
          () => createBuildContext(testSplitOptions(outDir), {}),
        );

        assertEquals(await assertRejects(() => wrapped.dispose()), disposeFailure);
        await wrapped.dispose();
        assertEquals(disposeCalls, 2);
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("aggregates delegate and shim cleanup failures", async () => {
      const outDir = await Deno.makeTempDir({ prefix: "vf-splitter-context-" });
      const disposeFailure = new Error("delegate disposal failed");
      let shimPath = "";

      try {
        const wrapped = await withBundler(
          bundlerWithContext((options) => {
            shimPath = getInjectedShim(options);
            return Promise.resolve({
              rebuild: () => Promise.resolve({ outputFiles: [], warnings: [], errors: [] }),
              async dispose() {
                await replaceShimWithNonEmptyDirectory(shimPath);
                throw disposeFailure;
              },
            });
          }),
          () => createBuildContext(testSplitOptions(outDir), {}),
        );

        const error = await assertRejects(
          () => wrapped.dispose(),
          AggregateError,
          "Code-splitter context disposal failed",
        );
        assertInstanceOf(error, AggregateError);
        assertEquals(error.errors.length, 2);
        assertEquals(error.errors[0], disposeFailure);
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });

    it("preserves context creation and shim rollback failures", async () => {
      const outDir = await Deno.makeTempDir({ prefix: "vf-splitter-context-" });
      const creationFailure = new Error("context creation failed");

      try {
        const error = await assertRejects(
          () =>
            withBundler(
              bundlerWithContext(async (options) => {
                await replaceShimWithNonEmptyDirectory(getInjectedShim(options));
                throw creationFailure;
              }),
              () => createBuildContext(testSplitOptions(outDir), {}),
            ),
          AggregateError,
          "context creation failed and shim cleanup also failed",
        );
        assertInstanceOf(error, AggregateError);
        assertEquals(error.errors.length, 2);
        assertEquals(error.errors[0], creationFailure);
      } finally {
        await Deno.remove(outDir, { recursive: true });
      }
    });
  });
});
