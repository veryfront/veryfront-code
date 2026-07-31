import "#veryfront/schemas/_test-setup.ts";
import { expect } from "#std/expect.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { FileWatcher } from "#veryfront/platform/adapters/base.ts";
import {
  FileWatchSetup,
  isConfiguredPrimitivePath,
  isIgnoredOutputDir,
  shouldIgnorePath,
} from "./file-watch-setup.ts";
import type { RouteDiscovery } from "./route-discovery.ts";
import { ReloadNotifier } from "../reload-notifier.ts";

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createRouteDiscoveryStub(): RouteDiscovery {
  return {
    discoverRoutes: () => Promise.resolve(),
  } as RouteDiscovery;
}

describe("shouldIgnorePath", () => {
  it("ignores generated/output directory events and their contents", () => {
    expect(shouldIgnorePath("/proj/node_modules/foo/index.js")).toBe(true);
    expect(shouldIgnorePath("/proj/node_modules")).toBe(true);
    expect(shouldIgnorePath("/proj/.git/HEAD")).toBe(true);
    expect(shouldIgnorePath("/proj/.cache/bundle.js")).toBe(true);
    expect(shouldIgnorePath("/proj/.veryfront")).toBe(true);
    expect(shouldIgnorePath("/proj/.veryfront/manifest.json")).toBe(true);
    expect(shouldIgnorePath(String.raw`C:\proj\.veryfront`)).toBe(true);
    expect(shouldIgnorePath(String.raw`C:\proj\.veryfront\manifest.json`)).toBe(true);
  });

  it("ignores the Playwright MCP output directory (regression for #1977)", () => {
    expect(
      shouldIgnorePath("/proj/.playwright-mcp/console-2026-06-01T09-33-43.log"),
    ).toBe(true);
    expect(shouldIgnorePath("/proj/.playwright-mcp/page-001.yml")).toBe(true);
    expect(shouldIgnorePath("/proj/.playwright-mcp/screenshot.png")).toBe(true);
  });

  it("ignores OMX runtime state and log output directories", () => {
    expect(shouldIgnorePath("/proj/.omx/state/session.json")).toBe(true);
    expect(shouldIgnorePath("/proj/.omx/logs/runtime.log")).toBe(true);
    expect(shouldIgnorePath(String.raw`C:\proj\.omx\state\session.json`)).toBe(true);
    expect(shouldIgnorePath(String.raw`C:\proj\.omx\logs\runtime.log`)).toBe(true);
  });

  it("ignores generated-artifact extensions anywhere in the tree", () => {
    // Defends against tools that write logs outside a known output directory.
    expect(shouldIgnorePath("/proj/server.log")).toBe(true);
    expect(shouldIgnorePath("/proj/pages/build.LOG")).toBe(true);
    expect(shouldIgnorePath("/proj/scratch.tmp")).toBe(true);
  });

  it("ignores transient middleware modules written beside root middleware", () => {
    expect(shouldIgnorePath("/proj/.vf-middleware-123.mjs")).toBe(true);
    expect(shouldIgnorePath(String.raw`C:\proj\.vf-middleware-123.mjs`)).toBe(true);
    expect(shouldIgnorePath("/proj/.vf-middleware-config.ts")).toBe(false);
  });

  it("does not ignore legitimate source files", () => {
    expect(shouldIgnorePath("/proj/pages/index.tsx")).toBe(false);
    expect(shouldIgnorePath("/proj/components/Button.jsx")).toBe(false);
    expect(shouldIgnorePath("/proj/.veryfront.config.ts")).toBe(false);
    expect(shouldIgnorePath("/proj/my-node_modules/index.ts")).toBe(false);
    expect(shouldIgnorePath("/proj/lib/util.ts")).toBe(false);
    expect(shouldIgnorePath("/proj/styles/app.css")).toBe(false);
    expect(shouldIgnorePath("/proj/content/post.mdx")).toBe(false);
    expect(shouldIgnorePath("/proj/README.md")).toBe(false);
    expect(shouldIgnorePath("/proj/resources/data.json")).toBe(false);
  });
});

describe("isIgnoredOutputDir", () => {
  const projectDir = "/proj";

  it("ignores the project's build-output dir at any depth", () => {
    expect(isIgnoredOutputDir(projectDir, "/proj/dist/app.js")).toBe(true);
    expect(isIgnoredOutputDir(projectDir, "/proj/packages/ui/dist/index.js")).toBe(true);
  });

  it("does not match an ancestor dir named 'dist' (Codex review of #1977)", () => {
    // The project itself is checked out under an ancestor `dist/`; source
    // changes inside it must still trigger HMR — the match is project-relative.
    const nested = "/workspace/dist/my-app";
    expect(isIgnoredOutputDir(nested, "/workspace/dist/my-app/pages/index.tsx")).toBe(false);
    expect(isIgnoredOutputDir(nested, "/workspace/dist/my-app/dist/app.js")).toBe(true);
  });

  it("does not match source dirs whose names merely end in 'dist'", () => {
    expect(isIgnoredOutputDir(projectDir, "/proj/mydist/app.tsx")).toBe(false);
    expect(isIgnoredOutputDir(projectDir, "/proj/pages/wishlist-dist/index.tsx")).toBe(false);
  });

  it("does not match legitimate source files", () => {
    expect(isIgnoredOutputDir(projectDir, "/proj/pages/index.tsx")).toBe(false);
    expect(isIgnoredOutputDir(projectDir, "/proj/styles/app.css")).toBe(false);
  });
});

describe("isConfiguredPrimitivePath", () => {
  it("matches default and nested custom discovery roots without prefix aliases", () => {
    const roots = ["tools", "src/ai/prompts", "content/resources"];

    expect(isConfiguredPrimitivePath("/proj", roots, "/proj/tools/search.ts")).toBe(true);
    expect(isConfiguredPrimitivePath("/proj", roots, "/proj/src/ai/prompts/review.ts")).toBe(
      true,
    );
    expect(isConfiguredPrimitivePath("/proj", roots, "/proj/content/resources/docs.ts")).toBe(
      true,
    );
    expect(isConfiguredPrimitivePath("/proj", roots, "/proj/toolsmith/search.ts")).toBe(false);
    expect(isConfiguredPrimitivePath("/proj", roots, "/proj/src/ai/other.ts")).toBe(false);
  });
});

describe("FileWatchSetup lifecycle", () => {
  it("rejects a second setup instead of orphaning the active watcher", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/index.tsx", "export default () => null;");
    let watchCalls = 0;
    let closeCalls = 0;
    adapter.fs.watch = () => {
      watchCalls++;
      return {
        ready: Promise.resolve(),
        done: Promise.resolve(),
        async *[Symbol.asyncIterator]() {
          // Completion is explicit through `done`, so an empty stream is valid.
        },
        close: () => closeCalls++,
      } satisfies FileWatcher;
    };
    const setup = new FileWatchSetup(
      "/project",
      adapter,
      createRouteDiscoveryStub(),
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {},
    );

    try {
      await setup.setup();
      await assertRejects(
        () => setup.setup(),
        Error,
        "File watcher setup is already active",
      );
      assertEquals(watchCalls, 1);
    } finally {
      await setup.cleanup();
    }
    assertEquals(closeCalls, 1);
  });

  it("serializes cleanup behind an in-progress watcher acquisition", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/index.tsx", "export default () => null;");
    const inspectionStarted = createDeferred<void>();
    const releaseInspection = createDeferred<void>();
    const originalStat = adapter.fs.stat;
    let firstInspection = true;
    adapter.fs.stat = async (path) => {
      if (firstInspection) {
        firstInspection = false;
        inspectionStarted.resolve();
        await releaseInspection.promise;
      }
      return await originalStat(path);
    };
    let watchCalls = 0;
    let closeCalls = 0;
    adapter.fs.watch = () => {
      watchCalls++;
      const stopped = createDeferred<void>();
      return {
        ready: Promise.resolve(),
        done: stopped.promise,
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            await stopped.promise;
            return { done: true, value: undefined };
          },
        }),
        close: () => {
          closeCalls++;
          stopped.resolve();
        },
      } satisfies FileWatcher;
    };
    const setup = new FileWatchSetup("/project", adapter, createRouteDiscoveryStub(), 10);

    const setupPromise = setup.setup();
    await inspectionStarted.promise;
    await assertRejects(
      () => setup.setup(),
      Error,
      "File watcher setup is already active",
    );
    const cleanupPromise = setup.cleanup();
    releaseInspection.resolve();

    await setupPromise;
    await cleanupPromise;
    assertEquals(watchCalls, 1);
    assertEquals(closeCalls, 1);
  });

  it("rejects setup when HMR has no directory it can watch", async () => {
    const adapter = createMockAdapter();
    const setup = new FileWatchSetup("/project", adapter, createRouteDiscoveryStub(), 10);

    await assertRejects(
      () => setup.setup(),
      Error,
      "No directories are available for file watching",
    );
  });

  it("propagates watch-path inspection failures instead of degrading silently", async () => {
    const adapter = createMockAdapter();
    adapter.fs.stat = () => Promise.reject(new Error("filesystem unavailable"));
    const setup = new FileWatchSetup("/project", adapter, createRouteDiscoveryStub(), 10);

    await assertRejects(() => setup.setup(), Error, "filesystem unavailable");
  });

  it("awaits watcher acquisition and closes a watcher whose ready signal rejects", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/index.tsx", "export default () => null;");
    let closed = false;
    adapter.fs.watch = () => ({
      ready: Promise.resolve().then(() => {
        throw new Error("watch acquisition failed");
      }),
      async *[Symbol.asyncIterator]() {
        // Acquisition fails before event iteration starts.
      },
      close: () => {
        closed = true;
      },
    });
    const setup = new FileWatchSetup("/project", adapter, createRouteDiscoveryStub(), 10);

    await assertRejects(() => setup.setup(), Error, "watch acquisition failed");

    assertEquals(closed, true);
  });

  it("reports an unexpected watcher task failure exactly once", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/index.tsx", "export default () => null;");
    const failure = new Error("watch stream failed");
    adapter.fs.watch = () => ({
      ready: Promise.resolve(),
      [Symbol.asyncIterator](): AsyncIterator<{ kind: "modify"; paths: string[] }> {
        return {
          next: () => Promise.reject(failure),
        };
      },
      close: () => {},
    } satisfies FileWatcher);
    let reportCount = 0;
    let resolveReported!: (error: unknown) => void;
    const reported = new Promise<unknown>((resolve) => {
      resolveReported = resolve;
    });
    const setup = new FileWatchSetup(
      "/project",
      adapter,
      createRouteDiscoveryStub(),
      10,
      undefined,
      undefined,
      undefined,
      undefined,
      (error) => {
        reportCount++;
        resolveReported(error);
      },
    );

    await setup.setup();

    assertEquals(await reported, failure);
    await Promise.resolve();
    assertEquals(reportCount, 1);
    await setup.cleanup();
  });

  it("does not invalidate or reload when route discovery rejects", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/index.tsx", "export default () => null;");
    adapter.fs.watch = (_paths, options) => ({
      ready: Promise.resolve(),
      async *[Symbol.asyncIterator]() {
        yield { kind: "modify" as const, paths: ["/project/pages/index.tsx"] };
        if (options?.signal?.aborted) return;
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      close: () => {},
    });
    const routeDiscovery = {
      discoverRoutes: () => Promise.reject(new Error("route adapter unavailable")),
    } as unknown as RouteDiscovery;
    let invalidations = 0;
    const setup = new FileWatchSetup(
      "/project",
      adapter,
      routeDiscovery,
      0,
      () => invalidations++,
    );

    await setup.setup();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assertEquals(invalidations, 0);
    await setup.cleanup();
  });

  it("fences downstream HMR work when cleanup begins during route discovery", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/index.tsx", "export default () => null;");
    adapter.fs.watch = (_paths, options) => ({
      ready: Promise.resolve(),
      async *[Symbol.asyncIterator]() {
        yield { kind: "modify" as const, paths: ["/project/pages/index.tsx"] };
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      close: () => {},
    });

    const discoveryStarted = createDeferred<void>();
    const releaseDiscovery = createDeferred<void>();
    const discoveryFinished = createDeferred<void>();
    const routeDiscovery = {
      discoverRoutes: async () => {
        discoveryStarted.resolve();
        await releaseDiscovery.promise;
        discoveryFinished.resolve();
      },
    } as unknown as RouteDiscovery;
    let invalidations = 0;
    let reloadInvalidations = 0;
    const unsubscribeReload = ReloadNotifier.subscribeInvalidate(() => reloadInvalidations++);
    const setup = new FileWatchSetup(
      "/project",
      adapter,
      routeDiscovery,
      0,
      () => invalidations++,
    );

    try {
      await setup.setup();
      await discoveryStarted.promise;

      const cleanup = setup.cleanup();
      releaseDiscovery.resolve();
      await cleanup;
      await discoveryFinished.promise;

      assertEquals(invalidations, 0);
      assertEquals(reloadInvalidations, 0);
    } finally {
      unsubscribeReload();
    }
  });

  it("propagates an underlying watcher cleanup failure", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/pages/index.tsx", "export default () => null;");
    let rejectDone!: (error: unknown) => void;
    const done = new Promise<void>((_resolve, reject) => {
      rejectDone = reject;
    });
    adapter.fs.watch = (_paths, options) => ({
      ready: Promise.resolve(),
      done,
      [Symbol.asyncIterator](): AsyncIterator<{ kind: "modify"; paths: string[] }> {
        return {
          next: () => {
            if (options?.signal?.aborted) {
              return Promise.resolve({ done: true, value: undefined });
            }
            return new Promise((resolve) => {
              options?.signal?.addEventListener(
                "abort",
                () => resolve({ done: true, value: undefined }),
                { once: true },
              );
            });
          },
        };
      },
      close: () => rejectDone(new Error("native watcher close failed")),
    });
    const setup = new FileWatchSetup("/project", adapter, createRouteDiscoveryStub(), 10);
    await setup.setup();

    await assertRejects(
      () => setup.cleanup(),
      AggregateError,
      "File watcher cleanup did not complete cleanly",
    );
  });
});
