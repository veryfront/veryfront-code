import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BrowserModuleBuildCoordinator,
  BrowserModuleCapacityError,
} from "./browser-module-availability.ts";

interface TestBundle {
  source: string;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function request(
  coordinator: BrowserModuleBuildCoordinator<TestBundle>,
  options: {
    cacheKey: string;
    projectKey?: string;
    build: () => Promise<TestBundle>;
    validate?: (bundle: TestBundle) => Promise<boolean>;
  },
) {
  return coordinator.getOrBuild({
    cacheKey: options.cacheKey,
    projectKey: options.projectKey ?? "project-a",
    build: options.build,
    validate: options.validate ?? (() => Promise.resolve(true)),
    sizeOf: (bundle: TestBundle) => bundle.source.length,
  });
}

describe("server/shared/browser-module-availability", () => {
  it("shares one build across concurrent requests for the same module", async () => {
    const coordinator = new BrowserModuleBuildCoordinator<TestBundle>();
    const started = deferred();
    const release = deferred();
    let builds = 0;
    const build = async () => {
      builds++;
      started.resolve();
      await release.promise;
      return { source: "export const value = 1;" };
    };

    const first = request(coordinator, { cacheKey: "module-a", build });
    await started.promise;
    const second = request(coordinator, { cacheKey: "module-a", build });

    assertEquals(builds, 1);
    release.resolve();
    assertEquals((await first).value.source, "export const value = 1;");
    assertEquals((await second).value.source, "export const value = 1;");
    assertEquals(builds, 1);
  });

  it("shares one validation across concurrent requests for a cached module", async () => {
    const coordinator = new BrowserModuleBuildCoordinator<TestBundle>();
    let builds = 0;
    const build = () => {
      builds++;
      return Promise.resolve({ source: "cached" });
    };
    await request(coordinator, { cacheKey: "module-a", build });

    const validationStarted = deferred();
    const releaseValidation = deferred();
    let validations = 0;
    const loadCached = () =>
      request(coordinator, {
        cacheKey: "module-a",
        build,
        validate: async () => {
          validations++;
          validationStarted.resolve();
          await releaseValidation.promise;
          return true;
        },
      });

    const first = loadCached();
    await validationStarted.promise;
    const second = loadCached();
    await Promise.resolve();
    const observedValidations = validations;
    releaseValidation.resolve();

    assertEquals((await first).status, "hit");
    assertEquals((await second).status, "shared");
    assertEquals(observedValidations, 1);
    assertEquals(builds, 1);
  });

  it("reuses entries within fixed count and byte limits with deterministic LRU eviction", async () => {
    const coordinator = new BrowserModuleBuildCoordinator<TestBundle>({
      maxEntries: 2,
      maxBytes: 8,
    });
    const builds = new Map<string, number>();
    const load = (key: string, source = key.repeat(4)) =>
      request(coordinator, {
        cacheKey: key,
        build: () => {
          builds.set(key, (builds.get(key) ?? 0) + 1);
          return Promise.resolve({ source });
        },
      });

    await load("a");
    await load("b");
    await load("a"); // Touch a, making b the oldest entry.
    await load("c");
    await load("b");

    assertEquals(builds.get("a"), 1);
    assertEquals(builds.get("b"), 2);
    assertEquals(builds.get("c"), 1);
    assertEquals(coordinator.getStatsForTesting(), {
      cacheEntries: 2,
      cacheBytes: 8,
      inFlight: 0,
      activeGlobal: 0,
    });

    await load("oversized", "123456789");
    assertEquals(coordinator.getStatsForTesting().cacheBytes <= 8, true);
    assertEquals(coordinator.getStatsForTesting().cacheEntries <= 2, true);
  });

  it("rejects immediately when the per-project build limit is saturated", async () => {
    const coordinator = new BrowserModuleBuildCoordinator<TestBundle>({
      globalLimit: 3,
      perProjectLimit: 1,
    });
    const release = deferred();
    const active = request(coordinator, {
      cacheKey: "module-a",
      projectKey: "private-project-key",
      build: async () => {
        await release.promise;
        return { source: "a" };
      },
    });

    const error = await assertRejects(
      () =>
        request(coordinator, {
          cacheKey: "module-b",
          projectKey: "private-project-key",
          build: () => Promise.resolve({ source: "b" }),
        }),
      BrowserModuleCapacityError,
    );
    assertEquals((error as Error).message.includes("private-project-key"), false);

    release.resolve();
    await active;
  });

  it("rejects immediately when the global build limit is saturated", async () => {
    const coordinator = new BrowserModuleBuildCoordinator<TestBundle>({
      globalLimit: 2,
      perProjectLimit: 2,
    });
    const release = deferred();
    const build = async () => {
      await release.promise;
      return { source: "active" };
    };
    const first = request(coordinator, {
      cacheKey: "module-a",
      projectKey: "project-a",
      build,
    });
    const second = request(coordinator, {
      cacheKey: "module-b",
      projectKey: "project-b",
      build,
    });

    await assertRejects(
      () =>
        request(coordinator, {
          cacheKey: "module-c",
          projectKey: "project-c",
          build,
        }),
      BrowserModuleCapacityError,
    );

    release.resolve();
    await Promise.all([first, second]);
  });

  it("applies the per-project limit while validating cached modules", async () => {
    const coordinator = new BrowserModuleBuildCoordinator<TestBundle>({
      globalLimit: 3,
      perProjectLimit: 1,
    });
    for (const cacheKey of ["module-a", "module-b"]) {
      await request(coordinator, {
        cacheKey,
        projectKey: "project-a",
        build: () => Promise.resolve({ source: cacheKey }),
      });
    }

    const validationStarted = deferred();
    const releaseValidation = deferred();
    const active = request(coordinator, {
      cacheKey: "module-a",
      projectKey: "project-a",
      build: () => Promise.resolve({ source: "unexpected-a" }),
      validate: async () => {
        validationStarted.resolve();
        await releaseValidation.promise;
        return true;
      },
    });
    await validationStarted.promise;

    let checkedSecond = false;
    try {
      await assertRejects(
        () =>
          request(coordinator, {
            cacheKey: "module-b",
            projectKey: "project-a",
            build: () => Promise.resolve({ source: "unexpected-b" }),
            validate: () => {
              checkedSecond = true;
              return Promise.resolve(true);
            },
          }),
        BrowserModuleCapacityError,
      );
    } finally {
      releaseValidation.resolve();
      await active;
    }
    assertEquals(checkedSecond, false);
  });

  it("applies the global limit while validating cached modules", async () => {
    const coordinator = new BrowserModuleBuildCoordinator<TestBundle>({
      globalLimit: 1,
      perProjectLimit: 2,
    });
    await request(coordinator, {
      cacheKey: "module-a",
      projectKey: "project-a",
      build: () => Promise.resolve({ source: "module-a" }),
    });
    await request(coordinator, {
      cacheKey: "module-b",
      projectKey: "project-b",
      build: () => Promise.resolve({ source: "module-b" }),
    });

    const validationStarted = deferred();
    const releaseValidation = deferred();
    const active = request(coordinator, {
      cacheKey: "module-a",
      projectKey: "project-a",
      build: () => Promise.resolve({ source: "unexpected-a" }),
      validate: async () => {
        validationStarted.resolve();
        await releaseValidation.promise;
        return true;
      },
    });
    await validationStarted.promise;

    let checkedSecond = false;
    try {
      await assertRejects(
        () =>
          request(coordinator, {
            cacheKey: "module-b",
            projectKey: "project-b",
            build: () => Promise.resolve({ source: "unexpected-b" }),
            validate: () => {
              checkedSecond = true;
              return Promise.resolve(true);
            },
          }),
        BrowserModuleCapacityError,
      );
    } finally {
      releaseValidation.resolve();
      await active;
    }
    assertEquals(checkedSecond, false);
  });

  it("clears cached and in-flight bookkeeping through its reset hook", async () => {
    const coordinator = new BrowserModuleBuildCoordinator<TestBundle>();
    await request(coordinator, {
      cacheKey: "module-a",
      build: () => Promise.resolve({ source: "cached" }),
    });

    coordinator.resetForTesting();

    assertEquals(coordinator.getStatsForTesting(), {
      cacheEntries: 0,
      cacheBytes: 0,
      inFlight: 0,
      activeGlobal: 0,
    });
  });

  it("does not let a pre-reset build release post-reset capacity", async () => {
    const coordinator = new BrowserModuleBuildCoordinator<TestBundle>({ globalLimit: 1 });
    const releaseOld = deferred();
    const oldBuild = request(coordinator, {
      cacheKey: "old-module",
      projectKey: "old-project",
      build: async () => {
        await releaseOld.promise;
        return { source: "old" };
      },
    });
    coordinator.resetForTesting();

    const releaseNew = deferred();
    const newBuild = request(coordinator, {
      cacheKey: "new-module",
      projectKey: "new-project",
      build: async () => {
        await releaseNew.promise;
        return { source: "new" };
      },
    });
    releaseOld.resolve();
    await oldBuild;

    assertEquals(coordinator.getStatsForTesting().activeGlobal, 1);
    releaseNew.resolve();
    await newBuild;
  });

  it("does not evict a post-reset replacement after stale validation", async () => {
    const coordinator = new BrowserModuleBuildCoordinator<TestBundle>();
    let builds = 0;
    await request(coordinator, {
      cacheKey: "module-a",
      build: () => {
        builds++;
        return Promise.resolve({ source: "old" });
      },
    });

    const slowValidationStarted = deferred();
    const releaseSlowValidation = deferred();
    const slow = request(coordinator, {
      cacheKey: "module-a",
      validate: async (bundle) => {
        if (bundle.source === "old") {
          slowValidationStarted.resolve();
          await releaseSlowValidation.promise;
          return false;
        }
        return true;
      },
      build: () => {
        builds++;
        return Promise.resolve({ source: "unexpected-slow-build" });
      },
    });
    await slowValidationStarted.promise;
    coordinator.resetForTesting();
    const fast = await request(coordinator, {
      cacheKey: "module-a",
      validate: () => Promise.resolve(false),
      build: () => {
        builds++;
        return Promise.resolve({ source: "replacement" });
      },
    });
    releaseSlowValidation.resolve();

    assertEquals(fast.value.source, "replacement");
    assertEquals((await slow).value.source, "replacement");
    assertEquals(builds, 2);
  });
});
