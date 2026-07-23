import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DevUiModuleCache,
  type DevUiModuleDependencies,
  loadDevUiModule,
  parseDevUiModulePath,
} from "./dev-ui-module-service.ts";

const request = {
  uiDirectory: "/ui",
  relativePath: "index",
  sourcePath: "dashboard/index",
  manifestFiles: {},
  transform: { spanName: "test.transform", importBasePath: "/_dev/ui" },
};

function dependencies(
  overrides: Partial<DevUiModuleDependencies> = {},
): DevUiModuleDependencies {
  return {
    realPath: (path) => Promise.resolve(path.replace("/ui", "/canonical/ui")),
    stat: () => Promise.resolve({ isFile: true, size: 20 }),
    readTextFile: () => Promise.resolve("export default true;"),
    transformUiModule: () => Promise.resolve("export default true;"),
    ...overrides,
  };
}

describe("dev UI module service", () => {
  it("parses only bounded safe paths under the exact prefix", () => {
    assertEquals(
      parseDevUiModulePath("/_dev/ui/components/Card.js", "/_dev/ui/"),
      "components/Card",
    );
    assertEquals(parseDevUiModulePath("/_other/ui/index.js", "/_dev/ui/"), null);
    assertEquals(parseDevUiModulePath("/_dev/ui/..%2Fsecret.js", "/_dev/ui/"), null);
    assertEquals(parseDevUiModulePath(`/_dev/ui/${"a".repeat(257)}.js`, "/_dev/ui/"), null);
  });

  it("rejects oversized file metadata before allocating the source", async () => {
    let reads = 0;
    let transforms = 0;
    const result = await loadDevUiModule(
      request,
      dependencies({
        stat: () => Promise.resolve({ isFile: true, size: 1_048_577 }),
        readTextFile: () => {
          reads++;
          return Promise.resolve("unreachable");
        },
        transformUiModule: () => {
          transforms++;
          return Promise.resolve("unreachable");
        },
      }),
      new DevUiModuleCache(),
    );

    assertEquals(result.kind, "unavailable");
    assertEquals(reads, 0);
    assertEquals(transforms, 0);
  });

  it("coalesces concurrent transforms for the same canonical module", async () => {
    const transform = Promise.withResolvers<string>();
    let transforms = 0;
    const cache = new DevUiModuleCache();
    const deps = dependencies({
      transformUiModule: () => {
        transforms++;
        return transform.promise;
      },
    });

    const first = loadDevUiModule(request, deps, cache);
    const second = loadDevUiModule(request, deps, cache);
    await Promise.resolve();
    transform.resolve("export default 1;");

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assertEquals(firstResult.kind, "loaded");
    assertEquals(secondResult.kind, "loaded");
    assertEquals(transforms, 1);
    assertEquals(cache.size, 1);
  });

  it("does not let an invalidated in-flight transform repopulate the cache", async () => {
    const started = Promise.withResolvers<void>();
    const transform = Promise.withResolvers<string>();
    const cache = new DevUiModuleCache();
    const loading = loadDevUiModule(
      request,
      dependencies({
        transformUiModule: () => {
          started.resolve();
          return transform.promise;
        },
      }),
      cache,
    );

    await started.promise;
    cache.clear();
    transform.resolve("export default 1;");
    assertEquals((await loading).kind, "loaded");
    assertEquals(cache.size, 0);
  });
});
