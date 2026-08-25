import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { MemoryCacheStore } from "#veryfront/rendering/cache/stores/memory-store.ts";
import type { CachePayload } from "#veryfront/rendering/cache/types.ts";

function makePayload(html = "<p>test</p>"): CachePayload {
  return {
    result: { html, frontmatter: {} },
    storedAt: Date.now(),
  };
}

// VF_DISABLE_LRU_INTERVAL, and its __vfDisableLruInterval global twin, turn off
// store-level TTL along with the LRU cleanup timer. Setting that global is a
// host effect, so this case lives here rather than in the colocated unit test.
describe("rendering/cache/stores/memory-store disable-interval flag", () => {
  it("suppresses store TTL under the disable-interval flag", async () => {
    const globalWithFlag = globalThis as Record<string, unknown>;
    const previous = globalWithFlag.__vfDisableLruInterval;
    globalWithFlag.__vfDisableLruInterval = true;

    try {
      using time = new FakeTime();
      const store = new MemoryCacheStore({ ttlMs: 10 });
      await store.set("k", makePayload());

      await time.tickAsync(1000);

      assertEquals(
        (await store.get("k"))?.result.html,
        "<p>test</p>",
        "the disable-interval flag must suppress store-level TTL eviction",
      );
      await store.destroy();
    } finally {
      if (previous === undefined) delete globalWithFlag.__vfDisableLruInterval;
      else globalWithFlag.__vfDisableLruInterval = previous;
    }
  });
});
