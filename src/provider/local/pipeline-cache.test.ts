import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createPipelineCache } from "./pipeline-cache.ts";

describe("provider/local/pipeline-cache", () => {
  it("caches falsey pipeline values", async () => {
    let loads = 0;
    const cache = createPipelineCache<number, string>(() => {
      loads++;
      return Promise.resolve(0);
    });

    assertEquals(await cache.load("model", "first"), 0);
    assertEquals(await cache.load("model", "second"), 0);
    assertEquals(loads, 1);
  });

  it("does not evict pipelines while active leases retain them", async () => {
    let loads = 0;
    const cache = createPipelineCache<string, string>((model) => {
      loads++;
      return Promise.resolve(model);
    });
    const leases = await Promise.all(
      ["a", "b", "c", "d"].map((model) => cache.acquire(model, model)),
    );

    await assertRejects(
      () => cache.load("e", "e"),
      RangeError,
      "capacity is currently in use",
    );
    leases[0]!.release();
    assertEquals(await cache.load("e", "e"), "e");
    for (const lease of leases.slice(1)) lease.release();
    assertEquals(loads, 5);
  });
});
