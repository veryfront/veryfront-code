import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertNotEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { ConfigurationManager } from "./config.ts";
import { RendererLifecycle, type RendererServices } from "./lifecycle.ts";
import { deriveDefaultRendererProjectId, mergeRendererConfig, VeryfrontRenderer } from "./ssr.ts";

const TEST_ADAPTER = {} as RuntimeAdapter;
const TEST_SERVICES = {} as RendererServices;

interface RendererTestInternals {
  initializeModules(): void;
  mdxCompiler: {
    compileMDX(): Promise<never>;
  };
  lifecycle: RendererLifecycle;
  renderPipeline: {
    destroy(): void;
    getStaticPaths?: (...args: unknown[]) => Promise<unknown>;
  };
}

describe("rendering/orchestrator/ssr", () => {
  it("forwards getStaticPaths through the initialized render pipeline identity", async () => {
    const renderer = new VeryfrontRenderer({
      projectDir: "/project",
      projectId: "project-id",
      contentSourceId: "build-source",
      mode: "production",
      adapter: TEST_ADAPTER,
    });
    const calls: unknown[][] = [];
    (renderer as unknown as { projectId: string }).projectId = "project-id";
    (renderer as unknown as RendererTestInternals).renderPipeline = {
      destroy() {},
      getStaticPaths: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({ paths: [], fallback: false });
      },
    };

    const result = await renderer.getStaticPaths("blog/[slug]");

    assertEquals(calls, [[
      "blog/[slug]",
      { projectId: "project-id", contentSourceId: "build-source" },
    ]]);
    assertEquals(result, { paths: [], fallback: false });
  });

  it("derives deterministic, collision-resistant default project identities", async () => {
    const first = await deriveDefaultRendererProjectId("/project-1n");
    const repeated = await deriveDefaultRendererProjectId("/project-1n");
    const legacyCollision = await deriveDefaultRendererProjectId("/project-30");

    assertEquals(first, repeated);
    assertNotEquals(first, legacyCollision);
    assertEquals(/^proj_[a-f0-9]{64}$/.test(first), true);
  });

  it("applies the legacy renderer directory override without dropping config", () => {
    assertEquals(
      mergeRendererConfig(
        {
          title: "Project",
          directories: {
            pages: "content/pages",
            ai: "agents",
          },
        },
        {
          app: "src/app",
          components: ["src/components"],
        },
      ),
      {
        title: "Project",
        directories: {
          pages: "content/pages",
          ai: "agents",
          app: "src/app",
          components: ["src/components"],
        },
      },
    );
  });

  it("singleflights concurrent initialization without removing explicit reinitialization", async () => {
    const originalConfigInitialize = ConfigurationManager.prototype.initialize;
    const originalLifecycleInitialize = RendererLifecycle.prototype.initialize;
    const originalUpdateCompileMDX = RendererLifecycle.prototype.updateCompileMDX;
    const configStarted = Promise.withResolvers<void>();
    const releaseConfig = Promise.withResolvers<void>();
    let configInitializeCalls = 0;
    let lifecycleInitializeCalls = 0;
    let moduleInitializeCalls = 0;

    ConfigurationManager.prototype.initialize = async function () {
      configInitializeCalls++;
      configStarted.resolve();
      await releaseConfig.promise;
    };
    RendererLifecycle.prototype.initialize = function () {
      lifecycleInitializeCalls++;
      return Promise.resolve(TEST_SERVICES);
    };
    RendererLifecycle.prototype.updateCompileMDX = () => {};

    const renderer = new VeryfrontRenderer({
      projectDir: "/project",
      projectId: "project",
      mode: "production",
      adapter: TEST_ADAPTER,
    });
    const internals = renderer as unknown as RendererTestInternals;
    internals.initializeModules = () => {
      moduleInitializeCalls++;
      internals.mdxCompiler = {
        compileMDX: () => Promise.reject(new Error("not called")),
      };
    };

    try {
      const first = renderer.initialize();
      await configStarted.promise;
      const second = renderer.initialize();

      assertStrictEquals(first, second);
      releaseConfig.resolve();
      await Promise.all([first, second]);
      await renderer.initialize();

      assertEquals(configInitializeCalls, 2);
      assertEquals(lifecycleInitializeCalls, 2);
      assertEquals(moduleInitializeCalls, 2);
    } finally {
      releaseConfig.resolve();
      await renderer.destroy().catch(() => undefined);
      ConfigurationManager.prototype.initialize = originalConfigInitialize;
      RendererLifecycle.prototype.initialize = originalLifecycleInitialize;
      RendererLifecycle.prototype.updateCompileMDX = originalUpdateCompileMDX;
    }
  });

  it("singleflights concurrent destruction and disposes one generation once", async () => {
    const originalConfigInitialize = ConfigurationManager.prototype.initialize;
    const originalLifecycleInitialize = RendererLifecycle.prototype.initialize;
    const originalUpdateCompileMDX = RendererLifecycle.prototype.updateCompileMDX;
    const releaseLifecycleDestroy = Promise.withResolvers<void>();
    let pipelineDestroyCalls = 0;
    let lifecycleDestroyCalls = 0;

    ConfigurationManager.prototype.initialize = () => Promise.resolve();
    RendererLifecycle.prototype.initialize = () => Promise.resolve(TEST_SERVICES);
    RendererLifecycle.prototype.updateCompileMDX = () => {};

    const renderer = new VeryfrontRenderer({
      projectDir: "/project",
      projectId: "project",
      mode: "production",
      adapter: TEST_ADAPTER,
    });
    const internals = renderer as unknown as RendererTestInternals;
    internals.initializeModules = () => {
      internals.mdxCompiler = {
        compileMDX: () => Promise.reject(new Error("not called")),
      };
      internals.renderPipeline = {
        destroy() {
          pipelineDestroyCalls++;
        },
      };
    };

    try {
      await renderer.initialize();
      internals.lifecycle.destroy = () => {
        lifecycleDestroyCalls++;
        return releaseLifecycleDestroy.promise;
      };

      const first = renderer.destroy();
      const second = renderer.destroy();

      assertStrictEquals(first, second);
      assertEquals(pipelineDestroyCalls, 1);
      assertEquals(lifecycleDestroyCalls, 1);

      releaseLifecycleDestroy.resolve();
      await Promise.all([first, second]);
      await renderer.destroy();

      assertEquals(pipelineDestroyCalls, 1);
      assertEquals(lifecycleDestroyCalls, 1);
    } finally {
      releaseLifecycleDestroy.resolve();
      await renderer.destroy().catch(() => undefined);
      ConfigurationManager.prototype.initialize = originalConfigInitialize;
      RendererLifecycle.prototype.initialize = originalLifecycleInitialize;
      RendererLifecycle.prototype.updateCompileMDX = originalUpdateCompileMDX;
    }
  });

  for (const failingPhase of ["pipeline", "lifecycle"] as const) {
    it(`retries only the failed ${failingPhase} cleanup phase`, async () => {
      const originalConfigInitialize = ConfigurationManager.prototype.initialize;
      const originalLifecycleInitialize = RendererLifecycle.prototype.initialize;
      const originalUpdateCompileMDX = RendererLifecycle.prototype.updateCompileMDX;
      let pipelineDestroyCalls = 0;
      let lifecycleDestroyCalls = 0;

      ConfigurationManager.prototype.initialize = () => Promise.resolve();
      RendererLifecycle.prototype.initialize = () => Promise.resolve(TEST_SERVICES);
      RendererLifecycle.prototype.updateCompileMDX = () => {};

      const renderer = new VeryfrontRenderer({
        projectDir: "/project",
        projectId: "project",
        mode: "production",
        adapter: TEST_ADAPTER,
      });
      const internals = renderer as unknown as RendererTestInternals;
      internals.initializeModules = () => {
        internals.mdxCompiler = {
          compileMDX: () => Promise.reject(new Error("not called")),
        };
        internals.renderPipeline = {
          destroy() {
            pipelineDestroyCalls++;
            if (failingPhase === "pipeline" && pipelineDestroyCalls === 1) {
              throw new Error("pipeline cleanup failed");
            }
          },
        };
      };

      try {
        await renderer.initialize();
        internals.lifecycle.destroy = () => {
          lifecycleDestroyCalls++;
          if (failingPhase === "lifecycle" && lifecycleDestroyCalls === 1) {
            return Promise.reject(new Error("lifecycle cleanup failed"));
          }
          return Promise.resolve();
        };

        await assertRejects(
          () => renderer.destroy(),
          Error,
          `${failingPhase} cleanup failed`,
        );
        await renderer.destroy();
        await renderer.destroy();

        assertEquals(pipelineDestroyCalls, failingPhase === "pipeline" ? 2 : 1);
        assertEquals(lifecycleDestroyCalls, failingPhase === "lifecycle" ? 2 : 1);
      } finally {
        await renderer.destroy().catch(() => undefined);
        ConfigurationManager.prototype.initialize = originalConfigInitialize;
        RendererLifecycle.prototype.initialize = originalLifecycleInitialize;
        RendererLifecycle.prototype.updateCompileMDX = originalUpdateCompileMDX;
      }
    });
  }

  it("queues a new initialization when destruction interposes an older initialization", async () => {
    const originalConfigInitialize = ConfigurationManager.prototype.initialize;
    const originalLifecycleInitialize = RendererLifecycle.prototype.initialize;
    const originalLifecycleDestroy = RendererLifecycle.prototype.destroy;
    const originalUpdateCompileMDX = RendererLifecycle.prototype.updateCompileMDX;
    const lifecycleStarted = Promise.withResolvers<void>();
    const releaseFirstLifecycle = Promise.withResolvers<void>();
    let lifecycleInitializeCalls = 0;
    let moduleInitializeCalls = 0;

    ConfigurationManager.prototype.initialize = () => Promise.resolve();
    RendererLifecycle.prototype.initialize = async function () {
      lifecycleInitializeCalls++;
      if (lifecycleInitializeCalls === 1) {
        lifecycleStarted.resolve();
        await releaseFirstLifecycle.promise;
      }
      return TEST_SERVICES;
    };
    RendererLifecycle.prototype.destroy = () => Promise.resolve();
    RendererLifecycle.prototype.updateCompileMDX = () => {};

    const renderer = new VeryfrontRenderer({
      projectDir: "/project",
      projectId: "project",
      mode: "production",
      adapter: TEST_ADAPTER,
    });
    const internals = renderer as unknown as RendererTestInternals;
    internals.initializeModules = () => {
      moduleInitializeCalls++;
      internals.mdxCompiler = {
        compileMDX: () => Promise.reject(new Error("not called")),
      };
    };

    try {
      const firstInitialization = renderer.initialize();
      await lifecycleStarted.promise;
      const destruction = renderer.destroy();
      const replacementInitialization = renderer.initialize();

      assertNotStrictEquals(replacementInitialization, firstInitialization);
      releaseFirstLifecycle.resolve();

      await assertRejects(() => firstInitialization, Error, "cancelled");
      await destruction;
      await replacementInitialization;
      assertEquals(lifecycleInitializeCalls, 2);
      assertEquals(moduleInitializeCalls, 1);
    } finally {
      releaseFirstLifecycle.resolve();
      await renderer.destroy().catch(() => undefined);
      ConfigurationManager.prototype.initialize = originalConfigInitialize;
      RendererLifecycle.prototype.initialize = originalLifecycleInitialize;
      RendererLifecycle.prototype.destroy = originalLifecycleDestroy;
      RendererLifecycle.prototype.updateCompileMDX = originalUpdateCompileMDX;
    }
  });

  it("queues a requested replacement generation behind active destruction", async () => {
    const originalConfigInitialize = ConfigurationManager.prototype.initialize;
    const originalLifecycleInitialize = RendererLifecycle.prototype.initialize;
    const originalUpdateCompileMDX = RendererLifecycle.prototype.updateCompileMDX;
    const releaseLifecycleDestroy = Promise.withResolvers<void>();
    let lifecycleInitializeCalls = 0;
    let moduleInitializeCalls = 0;

    ConfigurationManager.prototype.initialize = () => Promise.resolve();
    RendererLifecycle.prototype.initialize = function () {
      lifecycleInitializeCalls++;
      return Promise.resolve(TEST_SERVICES);
    };
    RendererLifecycle.prototype.updateCompileMDX = () => {};

    const renderer = new VeryfrontRenderer({
      projectDir: "/project",
      projectId: "project",
      mode: "production",
      adapter: TEST_ADAPTER,
    });
    const internals = renderer as unknown as RendererTestInternals;
    internals.initializeModules = () => {
      moduleInitializeCalls++;
      internals.mdxCompiler = {
        compileMDX: () => Promise.reject(new Error("not called")),
      };
      let destroyed = false;
      internals.renderPipeline = {
        destroy() {
          if (destroyed) return;
          destroyed = true;
        },
      };
    };

    try {
      await renderer.initialize();
      internals.lifecycle.destroy = () => releaseLifecycleDestroy.promise;

      const destruction = renderer.destroy();
      const replacement = renderer.initialize();
      await Promise.resolve();
      await Promise.resolve();

      assertEquals(lifecycleInitializeCalls, 1);
      assertEquals(moduleInitializeCalls, 1);

      releaseLifecycleDestroy.resolve();
      await destruction;
      await replacement;

      assertEquals(lifecycleInitializeCalls, 2);
      assertEquals(moduleInitializeCalls, 2);
    } finally {
      releaseLifecycleDestroy.resolve();
      await renderer.destroy().catch(() => undefined);
      ConfigurationManager.prototype.initialize = originalConfigInitialize;
      RendererLifecycle.prototype.initialize = originalLifecycleInitialize;
      RendererLifecycle.prototype.updateCompileMDX = originalUpdateCompileMDX;
    }
  });

  it("lets a final destruction cancel initialization queued behind an older destruction", async () => {
    const originalConfigInitialize = ConfigurationManager.prototype.initialize;
    const originalLifecycleInitialize = RendererLifecycle.prototype.initialize;
    const originalUpdateCompileMDX = RendererLifecycle.prototype.updateCompileMDX;
    const releaseFirstDestroy = Promise.withResolvers<void>();
    let lifecycleInitializeCalls = 0;
    let moduleInitializeCalls = 0;

    ConfigurationManager.prototype.initialize = () => Promise.resolve();
    RendererLifecycle.prototype.initialize = function () {
      lifecycleInitializeCalls++;
      return Promise.resolve(TEST_SERVICES);
    };
    RendererLifecycle.prototype.updateCompileMDX = () => {};

    const renderer = new VeryfrontRenderer({
      projectDir: "/project",
      projectId: "project",
      mode: "production",
      adapter: TEST_ADAPTER,
    });
    const internals = renderer as unknown as RendererTestInternals & {
      ownedResources?: unknown;
    };
    internals.initializeModules = () => {
      moduleInitializeCalls++;
      internals.mdxCompiler = {
        compileMDX: () => Promise.reject(new Error("not called")),
      };
      let destroyed = false;
      internals.renderPipeline = {
        destroy() {
          if (destroyed) return;
          destroyed = true;
        },
      };
    };

    try {
      await renderer.initialize();
      internals.lifecycle.destroy = () => releaseFirstDestroy.promise;

      const firstDestroy = renderer.destroy();
      const queuedInitialization = renderer.initialize();
      const finalDestroy = renderer.destroy();

      assertNotStrictEquals(finalDestroy, firstDestroy);
      releaseFirstDestroy.resolve();

      await firstDestroy;
      await assertRejects(() => queuedInitialization, Error, "cancelled");
      await finalDestroy;
      assertEquals(internals.ownedResources, undefined);
      assertEquals(lifecycleInitializeCalls, 1);
      assertEquals(moduleInitializeCalls, 1);
    } finally {
      releaseFirstDestroy.resolve();
      await renderer.destroy().catch(() => undefined);
      ConfigurationManager.prototype.initialize = originalConfigInitialize;
      RendererLifecycle.prototype.initialize = originalLifecycleInitialize;
      RendererLifecycle.prototype.updateCompileMDX = originalUpdateCompileMDX;
    }
  });

  it("does not publish a late initialization after destruction starts", async () => {
    const originalConfigInitialize = ConfigurationManager.prototype.initialize;
    const originalLifecycleInitialize = RendererLifecycle.prototype.initialize;
    const originalLifecycleDestroy = RendererLifecycle.prototype.destroy;
    const originalUpdateCompileMDX = RendererLifecycle.prototype.updateCompileMDX;
    const lifecycleStarted = Promise.withResolvers<void>();
    const releaseLifecycle = Promise.withResolvers<void>();
    let lifecycleInitializeCalls = 0;
    let lifecycleDestroyCalls = 0;
    let moduleInitializeCalls = 0;

    ConfigurationManager.prototype.initialize = () => Promise.resolve();
    RendererLifecycle.prototype.initialize = async function () {
      lifecycleInitializeCalls++;
      lifecycleStarted.resolve();
      await releaseLifecycle.promise;
      return TEST_SERVICES;
    };
    RendererLifecycle.prototype.destroy = function () {
      lifecycleDestroyCalls++;
      return Promise.resolve();
    };
    RendererLifecycle.prototype.updateCompileMDX = () => {};

    const renderer = new VeryfrontRenderer({
      projectDir: "/project",
      projectId: "project",
      mode: "production",
      adapter: TEST_ADAPTER,
    });
    const internals = renderer as unknown as RendererTestInternals;
    internals.initializeModules = () => {
      moduleInitializeCalls++;
      internals.mdxCompiler = {
        compileMDX: () => Promise.reject(new Error("not called")),
      };
    };

    try {
      const initialization = renderer.initialize();
      await lifecycleStarted.promise;
      let destructionSettled = false;
      const destruction = renderer.destroy().finally(() => {
        destructionSettled = true;
      });
      await Promise.resolve();
      assertEquals(destructionSettled, false);
      releaseLifecycle.resolve();

      await assertRejects(() => initialization, Error, "cancelled");
      await destruction;
      assertEquals(lifecycleInitializeCalls, 1);
      assertEquals(lifecycleDestroyCalls, 1);
      assertEquals(moduleInitializeCalls, 0);

      await renderer.initialize();
      assertEquals(lifecycleInitializeCalls, 2);
      assertEquals(moduleInitializeCalls, 1);
    } finally {
      releaseLifecycle.resolve();
      await renderer.destroy().catch(() => undefined);
      ConfigurationManager.prototype.initialize = originalConfigInitialize;
      RendererLifecycle.prototype.initialize = originalLifecycleInitialize;
      RendererLifecycle.prototype.destroy = originalLifecycleDestroy;
      RendererLifecycle.prototype.updateCompileMDX = originalUpdateCompileMDX;
    }
  });
});
