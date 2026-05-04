import { assertEquals } from "#veryfront/testing/assert.ts";

const recoverableWarnSites = [
  {
    path: "src/transforms/esm/http-cache.ts",
    snippet: 'httpCacheLog.warn("Local cache has missing deps, will re-fetch"',
  },
  {
    path: "src/transforms/esm/http-cache.ts",
    snippet: 'httpCacheLog.warn("Cached code has missing bundle deps, will re-fetch"',
  },
  {
    path: "src/transforms/mdx/esm-module-loader/module-fetcher/distributed-cache.ts",
    snippet:
      "log.warn(\n          `${LOG_PREFIX_MDX_LOADER} Cached code has ${unresolvedDeps.length} missing file dependencies, invalidating`,",
  },
  {
    path: "src/transforms/pipeline/stages/ssr-vf-modules/index.ts",
    snippet: "logger.warn(`${LOG_PREFIX} Initialized`",
  },
  {
    path: "src/server/handlers/request/api/project-discovery.ts",
    snippet: 'logger.warn("Primitive discovery found 0 agents and 0 tools"',
  },
];

Deno.test("recoverable render cache events do not emit production warning logs", async () => {
  for (const site of recoverableWarnSites) {
    const source = await Deno.readTextFile(site.path);
    assertEquals(
      source.includes(site.snippet),
      false,
      `${site.path} should not warn for recoverable/no-op production events`,
    );
  }
});
