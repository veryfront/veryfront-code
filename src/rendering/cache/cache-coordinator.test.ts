import { assertEquals, assertObjectMatch } from "@std/assert";
import { CacheCoordinator } from "./cache-coordinator.ts";
import type { RenderResult } from "../orchestrator/types.ts";

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

Deno.test("CacheCoordinator returns cached result on second lookup", async () => {
  const coordinator = new CacheCoordinator({
    ttlMs: 10_000,
  });

  const slug = "home";

  const lookupMiss = await coordinator.checkCache(slug);
  assertEquals(lookupMiss.cachedResult, undefined);

  const render = makeResult("<html>hello</html>");
  await coordinator.persistResult(render, slug);

  const lookupHit = await coordinator.checkCache(slug);
  assertObjectMatch(lookupHit.cachedResult ?? {}, { html: "<html>hello</html>" });

  await coordinator.destroy();
});

Deno.test("CacheCoordinator respects TTL", async () => {
  const coordinator = new CacheCoordinator({
    ttlMs: 1,
  });

  const slug = "ttl-test";
  await coordinator.persistResult(makeResult("first"), slug);

  await new Promise((resolve) => setTimeout(resolve, 5));

  const lookup = await coordinator.checkCache(slug);
  assertEquals(lookup.cachedResult, undefined);

  await coordinator.destroy();
});
