import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#std/assert";
import {
  __runDistributedCacheInitializationForTests,
  type DistributedCacheInitializers,
} from "./distributed-cache-init.ts";

Deno.test("distributed-cache-init does not import higher layers (rendering/transform/platform)", async () => {
  // Layering guard (#1987): src/cache is a low-level layer and must not reach
  // up into html / transforms / modules / platform. The concrete initializers
  // are injected from the server composition root instead. If this fails, a
  // cross-layer import was re-introduced into distributed-cache-init.ts.
  const source = await Deno.readTextFile(new URL("./distributed-cache-init.ts", import.meta.url));
  const forbidden = [
    "#veryfront/html/",
    "#veryfront/transforms/",
    "#veryfront/modules/",
    "#veryfront/platform/",
  ];
  for (const specifier of forbidden) {
    assertEquals(
      source.includes(specifier),
      false,
      `distributed-cache-init.ts must not import ${specifier} (inject initializers from the server layer instead)`,
    );
  }
});

Deno.test("distributed cache init includes httpModule cache status", async () => {
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

Deno.test("distributed cache init marks rejected initializers as disabled", async () => {
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

Deno.test("distributed cache init runs every injected initializer exactly once", async () => {
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

Deno.test("distributed cache init reports a persistent backend as fully enabled", async () => {
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
