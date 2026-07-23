import "#veryfront/schemas/_test-setup.ts";
import { expect } from "#std/expect.ts";
import { FakeTime } from "#std/testing/time";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { ReloadNotifier } from "../reload-notifier.ts";
import {
  FileWatchSetup,
  isIgnoredOutputDir,
  isPathInsideProject,
  shouldIgnorePath,
} from "./file-watch-setup.ts";
import type { RouteDiscovery } from "./route-discovery.ts";

function createRouteDiscovery(
  discoverRoutes: () => Promise<void> = () => Promise.resolve(),
): RouteDiscovery {
  return { discoverRoutes } as RouteDiscovery;
}

afterEach(() => ReloadNotifier.reset());

describe("shouldIgnorePath", () => {
  it("ignores paths inside generated/output directories", () => {
    expect(shouldIgnorePath("/proj/node_modules/foo/index.js")).toBe(true);
    expect(shouldIgnorePath("/proj/.git/HEAD")).toBe(true);
    expect(shouldIgnorePath("/proj/.cache/bundle.js")).toBe(true);
    expect(shouldIgnorePath("/proj/.veryfront/manifest.json")).toBe(true);
  });

  it("ignores the Playwright MCP output directory (regression for #1977)", () => {
    expect(
      shouldIgnorePath("/proj/.playwright-mcp/console-2026-06-01T09-33-43.log"),
    ).toBe(true);
    expect(shouldIgnorePath("/proj/.playwright-mcp/page-001.yml")).toBe(true);
    expect(shouldIgnorePath("/proj/.playwright-mcp/screenshot.png")).toBe(true);
  });

  it("ignores generated-artifact extensions anywhere in the tree", () => {
    // Defends against tools that write logs outside a known output directory.
    expect(shouldIgnorePath("/proj/server.log")).toBe(true);
    expect(shouldIgnorePath("/proj/pages/build.LOG")).toBe(true);
    expect(shouldIgnorePath("/proj/scratch.tmp")).toBe(true);
  });

  it("does not ignore legitimate source files", () => {
    expect(shouldIgnorePath("/proj/pages/index.tsx")).toBe(false);
    expect(shouldIgnorePath("/proj/components/Button.jsx")).toBe(false);
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
    // changes inside it must still trigger HMR because the match is project-relative.
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

describe("isPathInsideProject", () => {
  it("rejects parent and sibling paths", () => {
    expect(isPathInsideProject("/project", "/project/pages/index.tsx")).toBe(true);
    expect(isPathInsideProject("/project", "/project")).toBe(true);
    expect(isPathInsideProject("/project", "/project-sibling/page.tsx")).toBe(false);
    expect(isPathInsideProject("/project", "/outside/page.tsx")).toBe(false);
  });
});

describe("FileWatchSetup", () => {
  it("rejects primitive directories that escape the project root", () => {
    expect(() =>
      new FileWatchSetup(
        "/project",
        createMockAdapter(),
        createRouteDiscovery(),
        5,
        undefined,
        ["../outside"],
      )
    ).toThrow(TypeError);
  });

  it("recognizes changes in nested configured primitive directories", async () => {
    const adapter = createMockAdapter();
    const path = "/project/src/agents/reviewer.ts";
    adapter.fs.files.set(path, "export default {};");
    let rediscoveries = 0;
    const setup = new FileWatchSetup(
      "/project",
      adapter,
      createRouteDiscovery(),
      5,
      () => {
        rediscoveries++;
        return Promise.resolve();
      },
      ["src/agents"],
    );
    const internals = setup as unknown as {
      handleBatchedFileChanges(paths: string[]): Promise<void>;
    };

    await internals.handleBatchedFileChanges([path]);

    expect(rediscoveries).toBe(1);
  });

  it("uses collision-resistant content identity for HMR change detection", async () => {
    const adapter = createMockAdapter();
    const path = "/project/pages/index.tsx";
    let content = "content-1ngioan-18js";
    adapter.fs.stat = () =>
      Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: content.length,
        mtime: null,
      });
    adapter.fs.readFile = () => Promise.resolve(content);
    const setup = new FileWatchSetup("/project", adapter, createRouteDiscovery(), 5);
    const internals = setup as unknown as {
      filterChangedFiles(paths: string[]): Promise<string[]>;
    };

    expect(await internals.filterChangedFiles([path])).toEqual([path]);
    content = "content-1yu5nxd-1go2";
    expect(await internals.filterChangedFiles([path])).toEqual([path]);
  });

  it("propagates permission failures while hashing changed files", async () => {
    const adapter = createMockAdapter();
    adapter.fs.stat = () =>
      Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: 10,
        mtime: null,
      });
    adapter.fs.readFile = () => Promise.reject(new Deno.errors.PermissionDenied("private source"));
    const setup = new FileWatchSetup("/project", adapter, createRouteDiscovery(), 5);
    const internals = setup as unknown as {
      filterChangedFiles(paths: string[]): Promise<string[]>;
    };

    await assertRejects(
      () => internals.filterChangedFiles(["/project/pages/index.tsx"]),
      Deno.errors.PermissionDenied,
    );
  });

  it("does not read oversized files merely to detect a change", async () => {
    const adapter = createMockAdapter();
    let readCalls = 0;
    adapter.fs.stat = () =>
      Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: 32 * 1024 * 1024,
        mtime: null,
      });
    adapter.fs.readFile = () => {
      readCalls++;
      return Promise.resolve("oversized");
    };
    const setup = new FileWatchSetup("/project", adapter, createRouteDiscovery(), 5);
    const internals = setup as unknown as {
      filterChangedFiles(paths: string[]): Promise<string[]>;
    };

    expect(await internals.filterChangedFiles(["/project/assets/large.bin"])).toEqual([
      "/project/assets/large.bin",
    ]);
    expect(readCalls).toBe(0);
  });

  it("performs a full invalidation when individual change paths are collapsed", async () => {
    using time = new FakeTime();
    let routeDiscoveries = 0;
    let primitiveDiscoveries = 0;
    let broadcastPaths: string[] | null = ["not-called"];
    ReloadNotifier.subscribe((paths) => {
      broadcastPaths = paths ?? null;
    });
    const setup = new FileWatchSetup(
      "/project",
      createMockAdapter(),
      createRouteDiscovery(() => {
        routeDiscoveries++;
        return Promise.resolve();
      }),
      5,
      () => {
        primitiveDiscoveries++;
        return Promise.resolve();
      },
    );
    const internals = setup as unknown as {
      handleBatchedFileChanges(
        paths: string[],
        metadata: { fullInvalidation: boolean },
      ): Promise<void>;
    };

    await internals.handleBatchedFileChanges([], { fullInvalidation: true });
    time.tick(301);

    expect(routeDiscoveries).toBe(1);
    expect(primitiveDiscoveries).toBe(1);
    expect(broadcastPaths).toBe(null);
  });

  it("propagates unexpected filesystem failures while resolving watch paths", async () => {
    const adapter = createMockAdapter();
    adapter.fs.exists = () => Promise.resolve(true);
    adapter.fs.stat = () => Promise.reject(new Deno.errors.PermissionDenied("private path"));
    const setup = new FileWatchSetup("/project", adapter, createRouteDiscovery(), 5);

    await assertRejects(() => setup.setup(), Deno.errors.PermissionDenied);
  });

  it("does not reload with stale routes when route discovery fails", async () => {
    let invalidations = 0;
    const setup = new FileWatchSetup(
      "/project",
      createMockAdapter(),
      createRouteDiscovery(() => Promise.reject(new Error("route discovery unavailable"))),
      5,
    );
    ReloadNotifier.subscribeInvalidate(() => {
      invalidations++;
    });
    const internals = setup as unknown as {
      refreshAndReload(paths: string[], message: string): Promise<void>;
    };

    await assertRejects(
      () => internals.refreshAndReload(["/project/pages/index.tsx"], "change"),
      Error,
      "route discovery unavailable",
    );
    expect(invalidations).toBe(0);
    expect(ReloadNotifier.getMetrics().triggerCalls).toBe(0);
  });

  it("awaits cache invalidation before broadcasting a reload", async () => {
    const invalidationStarted = Promise.withResolvers<void>();
    const releaseInvalidation = Promise.withResolvers<void>();
    const setup = new FileWatchSetup(
      "/project",
      createMockAdapter(),
      createRouteDiscovery(),
      5,
    );
    ReloadNotifier.subscribeInvalidate(() => {
      invalidationStarted.resolve();
      return releaseInvalidation.promise;
    });
    const internals = setup as unknown as {
      refreshAndReload(paths: string[], message: string): Promise<void>;
    };

    const refresh = internals.refreshAndReload(["/project/pages/index.tsx"], "change");
    let refreshSettled = false;
    void refresh.then(() => {
      refreshSettled = true;
    });
    await invalidationStarted.promise;
    await Promise.resolve();
    const settledBeforeInvalidation = refreshSettled;
    releaseInvalidation.resolve();
    await refresh;

    expect(settledBeforeInvalidation).toBe(false);
    expect(ReloadNotifier.getMetrics().triggerCalls).toBe(1);
  });
});
