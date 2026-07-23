import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#std/assert";
import { FakeTime } from "#std/testing/time";
import { __runDistributedCacheInitializationForTests } from "./distributed-cache-init.ts";

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

Deno.test("distributed cache init isolates synchronous initializer failures", async () => {
  const calls: string[] = [];
  const status = await __runDistributedCacheInitializationForTests("redis", {
    transformCache: () => {
      calls.push("transform");
      throw new Error("sensitive provider detail");
    },
    ssrModuleCache: async () => {
      calls.push("ssr");
      return true;
    },
    fileCache: async () => {
      calls.push("file");
      return true;
    },
    projectCSSCache: async () => {
      calls.push("css");
      return false;
    },
    httpModuleCache: async () => {
      calls.push("http");
      return true;
    },
  });

  assertEquals(calls, ["transform", "ssr", "file", "css", "http"]);
  assertEquals(status, {
    backend: "redis",
    transformCache: false,
    ssrModuleCache: true,
    fileCache: true,
    projectCSSCache: false,
    httpModuleCache: true,
  });
});

Deno.test("distributed cache init does not wait forever for an initializer", async () => {
  using time = new FakeTime();
  let status: Awaited<ReturnType<typeof __runDistributedCacheInitializationForTests>> | undefined;
  let initializationSignal: AbortSignal | undefined;

  void __runDistributedCacheInitializationForTests("api", {
    transformCache: (signal?: AbortSignal) => {
      initializationSignal = signal;
      return new Promise<boolean>(() => {});
    },
    ssrModuleCache: async () => true,
    fileCache: async () => true,
    projectCSSCache: async () => true,
    httpModuleCache: async () => true,
  }).then((value) => {
    status = value;
  });

  await time.tickAsync(30_000);
  await time.tickAsync(0);

  assertEquals(status, {
    backend: "api",
    transformCache: false,
    ssrModuleCache: true,
    fileCache: true,
    projectCSSCache: true,
    httpModuleCache: true,
  });
  assertEquals(initializationSignal?.aborted, true);
});
