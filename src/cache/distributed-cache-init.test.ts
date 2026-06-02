import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#std/assert";
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
