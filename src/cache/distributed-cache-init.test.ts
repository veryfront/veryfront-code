import { assertEquals } from "#std/assert";
import { __runDistributedCacheInitializationForTests } from "./distributed-cache-init.ts";

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
