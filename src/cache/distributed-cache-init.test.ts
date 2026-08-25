import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __runDistributedCacheInitializationForTests,
  type DistributedCacheInitializers,
} from "./distributed-cache-init.ts";

function createCountingInitializers(): {
  calls: Record<keyof DistributedCacheInitializers, number>;
  initializers: DistributedCacheInitializers;
} {
  const calls: Record<keyof DistributedCacheInitializers, number> = {
    transformCache: 0,
    ssrModuleCache: 0,
    fileCache: 0,
    projectCSSCache: 0,
    httpModuleCache: 0,
  };
  const track = (name: keyof DistributedCacheInitializers) => () => {
    calls[name] += 1;
    return Promise.resolve(true);
  };

  return {
    calls,
    initializers: {
      transformCache: track("transformCache"),
      ssrModuleCache: track("ssrModuleCache"),
      fileCache: track("fileCache"),
      projectCSSCache: track("projectCSSCache"),
      httpModuleCache: track("httpModuleCache"),
    },
  };
}

describe("cache/distributed-cache-init", () => {
  it("includes httpModule cache status", async () => {
    const status = await __runDistributedCacheInitializationForTests("api", {
      transformCache: async () => true,
      ssrModuleCache: async () => true,
      fileCache: async () => true,
      projectCSSCache: async () => true,
      httpModuleCache: async () => true,
    });

    assertEquals(status.backend, "api");
    assertEquals(status.transformCache, true);
    assertEquals(status.ssrModuleCache, true);
    assertEquals(status.fileCache, true);
    assertEquals(status.projectCSSCache, true);
    assertEquals(status.httpModuleCache, true);
  });

  it("marks rejected initializers as disabled", async () => {
    const status = await __runDistributedCacheInitializationForTests("api", {
      transformCache: async () => true,
      ssrModuleCache: async () => true,
      fileCache: async () => {
        throw new Error("boom");
      },
      projectCSSCache: async () => true,
      httpModuleCache: async () => false,
    });

    assertEquals(status.backend, "api");
    assertEquals(status.transformCache, true);
    assertEquals(status.ssrModuleCache, true);
    assertEquals(status.fileCache, false);
    assertEquals(status.projectCSSCache, true);
    assertEquals(status.httpModuleCache, false);
  });

  it("runs every injected initializer exactly once", async () => {
    const { calls, initializers } = createCountingInitializers();

    const status = await __runDistributedCacheInitializationForTests("disk", initializers);

    assertEquals(status.backend, "disk", "the resolved backend is reported back unchanged");
    assertEquals(calls, {
      transformCache: 1,
      ssrModuleCache: 1,
      fileCache: 1,
      projectCSSCache: 1,
      httpModuleCache: 1,
    }, "every injected initializer must run exactly once for a persistent backend");
  });

  it("reports a persistent backend as fully enabled", async () => {
    const { initializers } = createCountingInitializers();

    const status = await __runDistributedCacheInitializationForTests("disk", initializers);

    assertEquals(status, {
      backend: "disk",
      transformCache: true,
      ssrModuleCache: true,
      fileCache: true,
      projectCSSCache: true,
      httpModuleCache: true,
    }, "a persistent backend whose initializers all resolve true reports every cache enabled");
  });
});
