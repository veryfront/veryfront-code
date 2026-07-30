import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#std/assert";
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

Deno.test("distributed cache init fails closed after every initializer settles", async () => {
  const completed: string[] = [];
  await assertRejects(
    () =>
      __runDistributedCacheInitializationForTests("api", {
        transformCache: async () => true,
        ssrModuleCache: async () => true,
        fileCache: async () => {
          completed.push("file");
          throw new Error("boom");
        },
        projectCSSCache: async () => {
          completed.push("css");
          return true;
        },
        httpModuleCache: async () => {
          completed.push("http");
          return false;
        },
      }),
    AggregateError,
    "Failed to initialize 1 distributed cache component",
  );

  assertEquals(completed.toSorted(), ["css", "file", "http"]);
});
