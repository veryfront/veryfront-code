import { delay } from "#std/async.ts";
import { assertEquals, assertObjectMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { scaleMs } from "#veryfront/testing/timing.ts";
import type { RenderResult } from "../orchestrator/types.ts";
import { CacheCoordinator } from "./cache-coordinator.ts";

function makeResult(html: string): RenderResult {
  return {
    html,
    frontmatter: {},
    headings: [],
    nodeMap: undefined,
    stream: null,
    ssrHash: "hash",
  };
}

describe("CacheCoordinator", () => {
  it("returns cached result on second lookup", async () => {
    const coordinator = new CacheCoordinator({ ttlMs: 10_000 });
    const slug = "home";

    const lookupMiss = await coordinator.checkCache(slug);
    assertEquals(lookupMiss.cachedResult, undefined);

    await coordinator.persistResult(makeResult("<html>hello</html>"), slug);

    const lookupHit = await coordinator.checkCache(slug);
    assertObjectMatch(lookupHit.cachedResult ?? {}, { html: "<html>hello</html>" });

    await coordinator.destroy();
  });

  it("respects TTL", async () => {
    const coordinator = new CacheCoordinator({ ttlMs: scaleMs(50) });
    const slug = "ttl-test";

    await coordinator.persistResult(makeResult("first"), slug);
    await delay(100);

    const lookup = await coordinator.checkCache(slug);
    assertEquals(lookup.cachedResult, undefined);

    await coordinator.destroy();
  });
});
