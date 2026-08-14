/**
 * EsbuildBundler smoke tests — verifies the adapter correctly invokes
 * esbuild and maps its results into the Bundler contract shape.
 *
 * @module extensions/ext-bundler-esbuild/esbuild-bundler.test
 */

import { assertEquals, assertExists, assertRejects, assertStringIncludes } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createRequire } from "node:module";

import {
  __recordOwnershipErrorForTests,
  __resetOwnershipErrorForTests,
  __resetServiceRecoveryForTests,
  EsbuildBundler,
  isLiveEsbuildServiceProcess,
  MAX_SERVICE_RESTARTS,
} from "./esbuild-bundler.ts";
import { rebuildContextWithSignal } from "./context-build-lifecycle.ts";

const childProcess = createRequire(import.meta.url)("node:child_process") as {
  spawn: typeof import("node:child_process").spawn;
};

function observeEsbuildServices(): {
  services: Array<{
    child: ReturnType<typeof childProcess.spawn>;
    closed: boolean;
    close: Promise<void>;
  }>;
  restore: () => void;
} {
  const previousSpawn = childProcess.spawn;
  const services: Array<{
    child: ReturnType<typeof childProcess.spawn>;
    closed: boolean;
    close: Promise<void>;
  }> = [];
  const observingSpawn = ((...spawnArgs: unknown[]) => {
    const child = Reflect.apply(previousSpawn, childProcess, spawnArgs);
    const args = spawnArgs[1];
    if (
      Array.isArray(args) &&
      args.some((arg) => typeof arg === "string" && arg.startsWith("--service=")) &&
      args.includes("--ping")
    ) {
      const close = Promise.withResolvers<void>();
      const service = { child, closed: false, close: close.promise };
      services.push(service);
      child.once("close", () => {
        service.closed = true;
        close.resolve();
      });
    }
    return child;
  }) as typeof childProcess.spawn;
  childProcess.spawn = observingSpawn;

  return {
    services,
    restore() {
      if (childProcess.spawn === observingSpawn) childProcess.spawn = previousSpawn;
    },
  };
}

describe("EsbuildBundler.transform", () => {
  it("compiles TS to JS", async () => {
    const bundler = new EsbuildBundler();
    try {
      const result = await bundler.transform({
        code: "const x: number = 1; export default x;",
        loader: "ts",
        format: "esm",
      });
      assertExists(result.code);
      assertEquals(result.code.includes("const x"), true);
      assertEquals(Array.isArray(result.warnings), true);
    } finally {
      await bundler.stop();
    }
  });

  it("strips types in tsx", async () => {
    const bundler = new EsbuildBundler();
    try {
      const result = await bundler.transform({
        code: "const x: number = 1;",
        loader: "ts",
      });
      // Type annotation should be gone
      assertEquals(result.code.includes(": number"), false);
    } finally {
      await bundler.stop();
    }
  });
});

describe("esbuild service lifecycle", () => {
  it("treats a Node-compatible child with unset exit fields as live", () => {
    assertEquals(
      isLiveEsbuildServiceProcess({
        killed: false,
        exitCode: undefined,
        signalCode: undefined,
      } as Pick<ReturnType<typeof childProcess.spawn>, "killed" | "exitCode" | "signalCode">),
      true,
    );
  });
});

describe("abortable esbuild context lifecycle", () => {
  it("cancels active work and preserves the primary abort over cleanup failures", async () => {
    const controller = new AbortController();
    const rebuild = Promise.withResolvers<unknown>();
    const cancelCalled = Promise.withResolvers<void>();
    let disposed = false;
    const abortReason = new DOMException("deadline exceeded", "AbortError");
    const building = rebuildContextWithSignal({
      rebuild: () => rebuild.promise,
      cancel: () => {
        cancelCalled.resolve();
        rebuild.reject(new Error("esbuild rebuild cancelled"));
        return Promise.reject(new Error("cancel cleanup failed"));
      },
      dispose: () => {
        disposed = true;
        return Promise.reject(new Error("dispose cleanup failed"));
      },
    }, controller.signal);
    void building.catch(() => undefined);

    controller.abort(abortReason);
    await cancelCalled.promise;
    const error = await assertRejects(() => building);

    assertEquals(error, abortReason);
    assertEquals(disposed, true);
  });
});

describe("EsbuildBundler.stop", () => {
  it("does not return until the service fully closes", async () => {
    const serviceClosed = Promise.withResolvers<void>();
    const releaseCloseListener = Promise.withResolvers<void>();
    let closeListenerRegistered = false;
    const originalSpawn = childProcess.spawn;
    const interceptedSpawn = ((...spawnArgs: unknown[]) => {
      const child = Reflect.apply(originalSpawn, childProcess, spawnArgs);
      const originalOnce = child.once;
      child.once = ((event: string | symbol, listener: (...args: unknown[]) => void) => {
        if (event === "close" && !closeListenerRegistered) {
          closeListenerRegistered = true;
          child.once = originalOnce;
          return Reflect.apply(originalOnce, child, [event, (...closeArgs: unknown[]) => {
            serviceClosed.resolve();
            void releaseCloseListener.promise.then(() => {
              Reflect.apply(listener, child, closeArgs);
            });
          }]);
        }
        return Reflect.apply(originalOnce, child, [event, listener]);
      }) as typeof child.once;
      childProcess.spawn = originalSpawn;
      return child;
    }) as typeof childProcess.spawn;
    childProcess.spawn = interceptedSpawn;

    const bundler = new EsbuildBundler();
    let stopping: Promise<void> | undefined;

    try {
      const result = await bundler.transform({
        code: "export const lifecycle: number = 1;",
        loader: "ts",
        format: "esm",
      });
      assertEquals(result.code.includes("lifecycle = 1"), true);
      assertEquals(closeListenerRegistered, true);

      let stopSettled = false;
      stopping = bundler.stop();
      void stopping.then(
        () => {
          stopSettled = true;
        },
        () => {
          stopSettled = true;
        },
      );

      await serviceClosed.promise;
      await Promise.resolve();
      assertEquals(stopSettled, false);

      releaseCloseListener.resolve();
      await stopping;
      assertEquals(stopSettled, true);
    } finally {
      releaseCloseListener.resolve();
      await stopping?.catch(() => undefined);
      try {
        await bundler.stop();
      } finally {
        if (childProcess.spawn === interceptedSpawn) childProcess.spawn = originalSpawn;
      }
    }
  });

  it("does not let concurrent work outlive shutdown", async () => {
    const observation = observeEsbuildServices();
    const { services } = observation;
    const bundler = new EsbuildBundler();

    try {
      await bundler.transform({ code: "export const warm = true;", loader: "ts" });

      const transforming = bundler.transform({
        code: "export const duringShutdown: number = 1;",
        loader: "ts",
      });
      const stopping = bundler.stop();
      await Promise.all([transforming, stopping]);

      assertEquals(services.length >= 1, true);
      assertEquals(services.every((service) => service.closed), true);
    } finally {
      try {
        await bundler.stop();
      } finally {
        observation.restore();
      }
    }
  });

  it("waits for an in-flight bundle before shutdown", async () => {
    const buildStarted = Promise.withResolvers<void>();
    const releaseBuild = Promise.withResolvers<void>();
    const bundler = new EsbuildBundler();
    let bundling: Promise<Awaited<ReturnType<EsbuildBundler["bundle"]>>> | undefined;
    let stopping: Promise<void> | undefined;

    try {
      bundling = bundler.bundle({
        entryPoints: ["hold:entry"],
        bundle: true,
        format: "esm",
        write: false,
        plugins: [{
          name: "hold-build",
          setup(build) {
            build.onResolve({ filter: /^hold:/ }, () => ({
              path: "entry",
              namespace: "hold",
            }));
            build.onLoad({ filter: /.*/, namespace: "hold" }, async () => {
              buildStarted.resolve();
              await releaseBuild.promise;
              return { contents: "export const held = true;", loader: "ts" };
            });
          },
        }],
      });
      void bundling.catch(() => undefined);
      await buildStarted.promise;

      stopping = bundler.stop();
      releaseBuild.resolve();
      const [result] = await Promise.all([bundling, stopping]);

      assertExists(result.outputFiles[0]);
    } finally {
      releaseBuild.resolve();
      await bundling?.catch(() => undefined);
      await stopping?.catch(() => undefined);
      await bundler.stop();
    }
  });

  it("keeps re-entrant plugin work inside the shutdown barrier", async () => {
    const observation = observeEsbuildServices();
    const { services } = observation;
    const pluginEntered = Promise.withResolvers<void>();
    const releasePlugin = Promise.withResolvers<void>();
    const nestedTransform = Promise.withResolvers<
      Awaited<ReturnType<EsbuildBundler["transform"]>>
    >();
    const bundler = new EsbuildBundler();
    let bundling: Promise<Awaited<ReturnType<EsbuildBundler["bundle"]>>> | undefined;
    let stopping: Promise<void> | undefined;

    try {
      await bundler.transform({ code: "export const warm = true;", loader: "ts" });

      bundling = bundler.bundle({
        entryPoints: ["nested:entry"],
        bundle: true,
        format: "esm",
        write: false,
        plugins: [{
          name: "nested-operation",
          setup(build) {
            build.onResolve({ filter: /^nested:/ }, () => ({
              path: "entry",
              namespace: "nested",
            }));
            build.onLoad({ filter: /.*/, namespace: "nested" }, async () => {
              pluginEntered.resolve();
              await releasePlugin.promise;
              void bundler.transform({
                code: "export const nested: number = 1;",
                loader: "ts",
              }).then(nestedTransform.resolve, nestedTransform.reject);
              return { contents: "export const outer = true;", loader: "ts" };
            });
          },
        }],
      });
      void bundling.catch(() => undefined);
      await pluginEntered.promise;

      stopping = bundler.stop();
      releasePlugin.resolve();
      const [bundleResult, transformResult] = await Promise.all([
        bundling,
        nestedTransform.promise,
        stopping,
      ]);

      assertExists(bundleResult.outputFiles[0]);
      assertEquals(transformResult.code.includes("nested = 1"), true);
      assertEquals(services.length >= 1, true);
      assertEquals(services.every((service) => service.closed), true);
    } finally {
      releasePlugin.resolve();
      await bundling?.catch(() => undefined);
      await stopping?.catch(() => undefined);
      try {
        await bundler.stop();
      } finally {
        observation.restore();
      }
    }
  });

  it("keeps context rebuild plugin work inside the shutdown barrier", async () => {
    const observation = observeEsbuildServices();
    const { services } = observation;
    const pluginEntered = Promise.withResolvers<void>();
    const releasePlugin = Promise.withResolvers<void>();
    const nestedTransform = Promise.withResolvers<
      Awaited<ReturnType<EsbuildBundler["transform"]>>
    >();
    const bundler = new EsbuildBundler();
    let context: Awaited<ReturnType<EsbuildBundler["context"]>> | undefined;
    let rebuilding:
      | ReturnType<Awaited<ReturnType<EsbuildBundler["context"]>>["rebuild"]>
      | undefined;
    let stopping: Promise<void> | undefined;

    try {
      await bundler.transform({ code: "export const warm = true;", loader: "ts" });

      context = await bundler.context({
        entryPoints: ["nested-context:entry"],
        bundle: true,
        format: "esm",
        write: false,
        plugins: [{
          name: "nested-context-operation",
          setup(build) {
            build.onResolve({ filter: /^nested-context:/ }, () => ({
              path: "entry",
              namespace: "nested-context",
            }));
            build.onLoad({ filter: /.*/, namespace: "nested-context" }, async () => {
              pluginEntered.resolve();
              await releasePlugin.promise;
              void bundler.transform({
                code: "export const nestedContext: number = 1;",
                loader: "ts",
              }).then(nestedTransform.resolve, nestedTransform.reject);
              return { contents: "export const outer = true;", loader: "ts" };
            });
          },
        }],
      });
      rebuilding = context.rebuild();
      void rebuilding.catch(() => undefined);
      await pluginEntered.promise;

      stopping = bundler.stop();
      releasePlugin.resolve();
      const [rebuildResult, transformResult] = await Promise.all([
        rebuilding,
        nestedTransform.promise,
        stopping,
      ]);

      assertExists(rebuildResult.outputFiles[0]);
      assertEquals(transformResult.code.includes("nestedContext = 1"), true);
      assertEquals(services.length >= 1, true);
      assertEquals(services.every((service) => service.closed), true);
    } finally {
      releasePlugin.resolve();
      await rebuilding?.catch(() => undefined);
      await stopping?.catch(() => undefined);
      await context?.dispose().catch(() => undefined);
      try {
        await bundler.stop();
      } finally {
        observation.restore();
      }
    }
  });

  it("keeps one-shot plugin disposal work inside the shutdown barrier", async () => {
    const disposeStarted = Promise.withResolvers<void>();
    const releaseDisposal = Promise.withResolvers<void>();
    const nestedDone = Promise.withResolvers<void>();
    const bundler = new EsbuildBundler();
    let stopping: Promise<void> | undefined;
    let bundleResolved = false;
    let disposeObservedBundleResolved: boolean | undefined;
    let stopSettled = false;
    let nestedObservedStopSettled: boolean | undefined;

    try {
      await bundler.bundle({
        stdin: {
          contents: "export const outer = true;",
          loader: "ts",
        },
        bundle: true,
        format: "esm",
        write: false,
        plugins: [{
          name: "dispose-reentry",
          setup(build) {
            build.onDispose(async () => {
              disposeStarted.resolve();
              disposeObservedBundleResolved = bundleResolved;
              await releaseDisposal.promise;
              try {
                await bundler.transform({
                  code: "export const nested: number = 1;",
                  loader: "ts",
                });
                nestedObservedStopSettled = stopSettled;
                nestedDone.resolve();
              } catch (error) {
                nestedDone.reject(error);
                throw error;
              }
            });
          },
        }],
      });
      bundleResolved = true;

      await disposeStarted.promise;
      stopping = bundler.stop().then(() => {
        stopSettled = true;
      });
      releaseDisposal.resolve();
      await Promise.all([stopping, nestedDone.promise]);

      assertEquals(disposeObservedBundleResolved, true);
      assertEquals(nestedObservedStopSettled, false);
    } finally {
      releaseDisposal.resolve();
      await stopping?.catch(() => undefined);
      await bundler.stop();
    }
  });

  it("keeps context disposal work inside the shutdown barrier", async () => {
    const disposeStarted = Promise.withResolvers<void>();
    const releaseDisposal = Promise.withResolvers<void>();
    const nestedDone = Promise.withResolvers<void>();
    const bundler = new EsbuildBundler();
    let context: Awaited<ReturnType<EsbuildBundler["context"]>> | undefined;
    let stopping: Promise<void> | undefined;
    let contextDisposeResolved = false;
    let disposeObservedContextResolved: boolean | undefined;
    let stopSettled = false;
    let nestedObservedStopSettled: boolean | undefined;

    try {
      context = await bundler.context({
        stdin: {
          contents: "export const outerContext = true;",
          loader: "ts",
        },
        bundle: true,
        format: "esm",
        write: false,
        plugins: [{
          name: "context-dispose-reentry",
          setup(build) {
            build.onDispose(async () => {
              disposeStarted.resolve();
              disposeObservedContextResolved = contextDisposeResolved;
              await releaseDisposal.promise;
              try {
                await bundler.transform({
                  code: "export const nestedContextDispose: number = 1;",
                  loader: "ts",
                });
                nestedObservedStopSettled = stopSettled;
                nestedDone.resolve();
              } catch (error) {
                nestedDone.reject(error);
                throw error;
              }
            });
          },
        }],
      });

      await context.dispose();
      contextDisposeResolved = true;
      await disposeStarted.promise;
      stopping = bundler.stop().then(() => {
        stopSettled = true;
      });
      releaseDisposal.resolve();
      await Promise.all([stopping, nestedDone.promise]);

      assertEquals(disposeObservedContextResolved, true);
      assertEquals(nestedObservedStopSettled, false);
    } finally {
      releaseDisposal.resolve();
      await stopping?.catch(() => undefined);
      await context?.dispose().catch(() => undefined);
      await bundler.stop();
    }
  });

  it("keeps failed-build disposal work inside the shutdown barrier", async () => {
    const disposeStarted = Promise.withResolvers<void>();
    const releaseDisposal = Promise.withResolvers<void>();
    const nestedDone = Promise.withResolvers<void>();
    const bundler = new EsbuildBundler();
    let stopping: Promise<void> | undefined;
    let buildRejected = false;
    let disposeObservedBuildRejected: boolean | undefined;
    let stopSettled = false;
    let nestedObservedStopSettled: boolean | undefined;

    try {
      try {
        await bundler.bundle({
          stdin: {
            contents: "export const broken = ;",
            loader: "ts",
          },
          bundle: true,
          format: "esm",
          write: false,
          plugins: [{
            name: "failed-dispose-reentry",
            setup(build) {
              build.onDispose(async () => {
                disposeStarted.resolve();
                disposeObservedBuildRejected = buildRejected;
                await releaseDisposal.promise;
                try {
                  await bundler.transform({
                    code: "export const nestedAfterFailure: number = 1;",
                    loader: "ts",
                  });
                  nestedObservedStopSettled = stopSettled;
                  nestedDone.resolve();
                } catch (error) {
                  nestedDone.reject(error);
                  throw error;
                }
              });
            },
          }],
        });
      } catch {
        buildRejected = true;
      }

      assertEquals(buildRejected, true);
      await disposeStarted.promise;
      stopping = bundler.stop().then(() => {
        stopSettled = true;
      });
      releaseDisposal.resolve();
      await Promise.all([stopping, nestedDone.promise]);

      assertEquals(disposeObservedBuildRejected, true);
      assertEquals(nestedObservedStopSettled, false);
    } finally {
      releaseDisposal.resolve();
      await stopping?.catch(() => undefined);
      await bundler.stop();
    }
  });

  it("does not wait forever for disposal callbacks after plugin setup fails", async () => {
    const bundler = new EsbuildBundler();
    let disposeCalled = false;
    let setupError: unknown;

    try {
      try {
        await bundler.bundle({
          stdin: {
            contents: "export const setupFailure = true;",
            loader: "ts",
          },
          bundle: true,
          format: "esm",
          write: false,
          plugins: [{
            name: "setup-failure",
            setup(build) {
              build.onDispose(() => {
                disposeCalled = true;
              });
              throw new Error("intentional setup failure");
            },
          }],
        });
      } catch (error) {
        setupError = error;
      }

      assertEquals(setupError instanceof Error, true);
      assertStringIncludes((setupError as Error).message, "intentional setup failure");
      await bundler.stop();
      assertEquals(disposeCalled, false);
    } finally {
      await bundler.stop();
    }
  });

  it("reports asynchronous plugin disposal failures from shutdown", async () => {
    const bundler = new EsbuildBundler();
    let stopError: unknown;

    try {
      await bundler.bundle({
        stdin: {
          contents: "export const disposalFailure = true;",
          loader: "ts",
        },
        bundle: true,
        format: "esm",
        write: false,
        plugins: [{
          name: "disposal-failure",
          setup(build) {
            build.onDispose(async () => {
              await Promise.resolve();
              throw new Error("intentional disposal failure");
            });
          },
        }],
      });

      try {
        await bundler.stop();
      } catch (error) {
        stopError = error;
      }

      assertEquals(stopError instanceof Error, true);
      assertStringIncludes((stopError as Error).message, "Plugin disposal failed");
    } finally {
      await bundler.stop();
    }
  });

  it("rejects shutdown from inside an active plugin operation", async () => {
    const bundler = new EsbuildBundler();
    let stopError: unknown;

    try {
      const result = await bundler.bundle({
        entryPoints: ["nested-stop:entry"],
        bundle: true,
        format: "esm",
        write: false,
        plugins: [{
          name: "nested-stop",
          setup(build) {
            build.onResolve({ filter: /^nested-stop:/ }, () => ({
              path: "entry",
              namespace: "nested-stop",
            }));
            build.onLoad({ filter: /.*/, namespace: "nested-stop" }, async () => {
              try {
                await bundler.stop();
              } catch (error) {
                stopError = error;
              }
              return { contents: "export const outer = true;", loader: "ts" };
            });
          },
        }],
      });

      assertExists(result.outputFiles[0]);
      assertEquals(stopError instanceof Error, true);
      assertStringIncludes((stopError as Error).message, "active bundler operation");
    } finally {
      await bundler.stop();
    }
  });
});

describe("EsbuildBundler.bundle", () => {
  it("awaits asynchronous plugin setup before starting the build", async () => {
    const bundler = new EsbuildBundler();
    try {
      const result = await bundler.bundle({
        entryPoints: ["async-setup:entry"],
        bundle: true,
        format: "esm",
        write: false,
        plugins: [{
          name: "async-setup",
          async setup(build) {
            await Promise.resolve();
            build.onResolve({ filter: /^async-setup:/ }, () => ({
              path: "entry",
              namespace: "async-setup",
            }));
            build.onLoad({ filter: /.*/, namespace: "async-setup" }, () => ({
              contents: "export const ready = true;",
              loader: "ts",
            }));
          },
        }],
      });

      assertExists(result.outputFiles[0]);
      assertStringIncludes(result.outputFiles[0]!.text, "ready");
    } finally {
      await bundler.stop();
    }
  });

  it("bundles a stdin entry into an in-memory output", async () => {
    const bundler = new EsbuildBundler();
    try {
      const result = await bundler.bundle({
        stdin: {
          contents: "export const hello = 'world';",
          resolveDir: ".",
          sourcefile: "entry.ts",
          loader: "ts",
        },
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
      });

      assertEquals(result.errors.length, 0);
      assertEquals(result.outputFiles.length, 1);
      const out = result.outputFiles[0]!;
      assertExists(out.text);
      assertEquals(out.text.includes("hello"), true);
    } finally {
      await bundler.stop();
    }
  });

  it("cancels an active context build through the contract signal", async () => {
    const bundler = new EsbuildBundler();
    const controller = new AbortController();
    const loadStarted = Promise.withResolvers<void>();
    const releaseLoad = Promise.withResolvers<void>();
    const abortReason = new DOMException("cancel requested", "AbortError");
    let bundling: Promise<Awaited<ReturnType<EsbuildBundler["bundle"]>>> | undefined;

    try {
      bundling = bundler.bundle({
        entryPoints: ["cancel:entry"],
        bundle: true,
        format: "esm",
        write: false,
        signal: controller.signal,
        plugins: [{
          name: "cancel-active-build",
          setup(build) {
            build.onResolve({ filter: /^cancel:/ }, () => ({
              path: "entry",
              namespace: "cancel",
            }));
            build.onLoad({ filter: /.*/, namespace: "cancel" }, async () => {
              loadStarted.resolve();
              await releaseLoad.promise;
              return { contents: "export default 1;", loader: "ts" };
            });
          },
        }],
      });
      void bundling.catch(() => undefined);
      await loadStarted.promise;
      controller.abort(abortReason);
      releaseLoad.resolve();

      const error = await assertRejects(() => bundling!);
      assertEquals(error, abortReason);
    } finally {
      releaseLoad.resolve();
      await bundling?.catch(() => undefined);
      await bundler.stop();
    }
  });
});

describe("ownership error cause", () => {
  afterEach(() => {
    __resetOwnershipErrorForTests();
  });

  it("adopts the underlying failure when the latch was set before it surfaced", () => {
    // The latch is created before the operation settles, so it starts without a
    // cause. Discarding the cause that arrives afterwards is what made every
    // real esbuild failure surface as a lifecycle problem instead.
    __resetOwnershipErrorForTests();
    __recordOwnershipErrorForTests();
    const error = __recordOwnershipErrorForTests(new Error("spawn ENOENT esbuild"));

    assertStringIncludes(error.message, "module-wide adapter");
    assertStringIncludes(error.message, "spawn ENOENT esbuild");
    assertEquals((error.cause as Error).message, "spawn ENOENT esbuild");
  });

  it("reports a cause supplied on the first record", () => {
    __resetOwnershipErrorForTests();
    const error = __recordOwnershipErrorForTests(new Error("binary missing"));

    assertStringIncludes(error.message, "binary missing");
    assertEquals((error.cause as Error).message, "binary missing");
  });

  it("keeps the first cause rather than overwriting it", () => {
    __resetOwnershipErrorForTests();
    __recordOwnershipErrorForTests(new Error("first failure"));
    const error = __recordOwnershipErrorForTests(new Error("second failure"));

    assertEquals((error.cause as Error).message, "first failure");
    assertStringIncludes(error.message, "first failure");
  });

  it("keeps the filesystem layout out of the reported cause", () => {
    // A compiled runtime resolves esbuild under a temp directory, and spawn
    // errors quote that path. The message is logged, so it must carry the
    // failure without the machine's layout.
    __resetOwnershipErrorForTests();
    const error = __recordOwnershipErrorForTests(
      new Error("spawn /tmp/veryfront-esbuild-0.28.1-c3fd/esbuild ENOENT"),
    );

    assertStringIncludes(error.message, "spawn esbuild ENOENT");
    assertEquals(error.message.includes("/tmp/"), false);
  });

  it("keeps a stack out of the reported cause", () => {
    __resetOwnershipErrorForTests();
    const error = __recordOwnershipErrorForTests(
      new Error("boom\n    at Object.create (file:///tmp/deno-compile/src/errors/types.ts:111:14)"),
    );

    assertStringIncludes(error.message, "boom");
    assertEquals(error.message.includes("types.ts"), false);
    assertEquals(error.message.includes("    at "), false);
  });

  it("stays usable when there is no underlying failure", () => {
    __resetOwnershipErrorForTests();
    const error = __recordOwnershipErrorForTests();

    assertStringIncludes(error.message, "module-wide adapter");
    assertEquals(error.cause, undefined);
  });
});

describe("EsbuildBundler service crash recovery", () => {
  beforeEach(() => {
    __resetServiceRecoveryForTests();
  });

  it("recovers with a fresh service after the managed service is killed externally", async () => {
    const observation = observeEsbuildServices();
    const { services } = observation;
    const bundler = new EsbuildBundler();

    try {
      const first = await bundler.transform({
        code: "export const before: number = 1;",
        loader: "ts",
      });
      assertStringIncludes(first.code, "before = 1");
      assertEquals(services.length, 1);

      // The container runtime kills the service child (OOM/SIGKILL); the
      // adapter never receives an error from esbuild first. The child is
      // unref'd, so ref it to keep the loop alive for the close event.
      services[0]!.child.ref();
      services[0]!.child.kill("SIGKILL");
      await services[0]!.close;

      const second = await bundler.transform({
        code: "export const after: number = 2;",
        loader: "ts",
      });
      assertStringIncludes(second.code, "after = 2");
      assertEquals(services.length, 2);
    } finally {
      await bundler.stop().catch(() => undefined);
      __resetServiceRecoveryForTests();
      try {
        await bundler.stop();
      } finally {
        observation.restore();
      }
    }
  });

  it("latches the ownership error once the restart budget is exhausted", async () => {
    const observation = observeEsbuildServices();
    const { services } = observation;
    const bundler = new EsbuildBundler();

    try {
      await bundler.transform({ code: "export const seed: number = 0;", loader: "ts" });

      for (let restart = 1; restart <= MAX_SERVICE_RESTARTS; restart++) {
        const current = services[services.length - 1]!;
        current.child.ref();
        current.child.kill("SIGKILL");
        await current.close;

        const result = await bundler.transform({
          code: `export const retry${restart}: number = ${restart};`,
          loader: "ts",
        });
        assertStringIncludes(result.code, `retry${restart} = ${restart}`);
      }
      assertEquals(services.length, MAX_SERVICE_RESTARTS + 1);

      const last = services[services.length - 1]!;
      last.child.ref();
      last.child.kill("SIGKILL");
      await last.close;

      const error = await assertRejects(() =>
        bundler.transform({ code: "export const exhausted = true;", loader: "ts" })
      );
      assertStringIncludes((error as Error).message, "module-wide adapter");
      assertStringIncludes((error as Error).message, "exited unexpectedly");

      // The latch is sticky: later operations keep rejecting without respawns.
      await assertRejects(() =>
        bundler.transform({ code: "export const still = true;", loader: "ts" })
      );
      assertEquals(services.length, MAX_SERVICE_RESTARTS + 1);
    } finally {
      await bundler.stop().catch(() => undefined);
      __resetServiceRecoveryForTests();
      try {
        await bundler.stop();
      } finally {
        observation.restore();
      }
    }
  });
});

describe("EsbuildBundler unsupported lifecycle ownership", () => {
  beforeEach(() => {
    __resetServiceRecoveryForTests();
  });

  it("recovers after a raw service generation replaces the managed one", async () => {
    const observation = observeEsbuildServices();
    const { services } = observation;
    const rawEsbuild = await import("esbuild");
    const bundler = new EsbuildBundler();

    try {
      await bundler.transform({ code: "export const managed = true;", loader: "ts" });
      await rawEsbuild.stop();
      await rawEsbuild.transform("export const external = true;");

      // The raw stop() killed the managed child, which is the recoverable
      // crash case: shutdown stays clean instead of rejecting...
      await bundler.stop();

      // ...and the next operation regains ownership with a fresh service.
      const result = await bundler.transform({
        code: "export const recovered: number = 1;",
        loader: "ts",
      });
      assertStringIncludes(result.code, "recovered = 1");
      assertEquals(services.length >= 3, true);
    } finally {
      await bundler.stop().catch(() => undefined);
      for (const service of services) service.child.ref();
      try {
        await rawEsbuild.stop();
        await Promise.all(services.map((service) => service.close));
      } finally {
        for (const service of services) service.child.unref();
        observation.restore();
      }
    }
  });

  it("still rejects operations that reuse a service started before the adapter", async () => {
    const observation = observeEsbuildServices();
    const { services } = observation;
    const rawEsbuild = await import("esbuild");
    const bundler = new EsbuildBundler();
    let ownershipError: unknown;

    try {
      // A foreign service the adapter never captured: it was started while
      // the spawn interceptor was not installed, so it can never be owned.
      await rawEsbuild.transform("export const external = true;");

      try {
        await bundler.transform({ code: "export const mine = true;", loader: "ts" });
      } catch (error) {
        ownershipError = error;
      }
      assertEquals(ownershipError instanceof Error, true);
      assertStringIncludes((ownershipError as Error).message, "module-wide adapter");
    } finally {
      __resetServiceRecoveryForTests();
      await bundler.stop().catch(() => undefined);
      for (const service of services) service.child.ref();
      try {
        await rawEsbuild.stop();
        await Promise.all(services.map((service) => service.close));
      } finally {
        for (const service of services) service.child.unref();
        observation.restore();
      }
    }
  });
});
