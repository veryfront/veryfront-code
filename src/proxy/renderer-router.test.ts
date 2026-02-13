import { assertEquals, assertNotEquals } from "@std/assert";
import { jumpHash, RendererRouter } from "./renderer-router.ts";

Deno.test("jumpHash", async (t) => {
  await t.step("returns value in range [0, numBuckets)", () => {
    for (let n = 1; n <= 20; n++) {
      for (let i = 0; i < 50; i++) {
        const result = jumpHash(`key-${i}`, n);
        assertEquals(result >= 0, true, `expected >= 0, got ${result}`);
        assertEquals(result < n, true, `expected < ${n}, got ${result}`);
      }
    }
  });

  await t.step("is deterministic", () => {
    assertEquals(jumpHash("test", 10), jumpHash("test", 10));
    assertEquals(jumpHash("project-abc", 5), jumpHash("project-abc", 5));
  });

  await t.step("distributes keys across buckets", () => {
    const buckets = new Map<number, number>();
    const numBuckets = 10;
    const numKeys = 10_000;
    for (let i = 0; i < numKeys; i++) {
      const b = jumpHash(`key-${i}`, numBuckets);
      buckets.set(b, (buckets.get(b) || 0) + 1);
    }
    // Every bucket should be hit
    assertEquals(buckets.size, numBuckets);
    // Each bucket should get roughly 1/numBuckets of keys (within 50% tolerance)
    const expected = numKeys / numBuckets;
    for (const [bucket, count] of buckets) {
      assertEquals(
        count > expected * 0.5 && count < expected * 1.5,
        true,
        `bucket ${bucket} got ${count} keys, expected ~${expected}`,
      );
    }
  });

  await t.step("single bucket always returns 0", () => {
    for (let i = 0; i < 100; i++) {
      assertEquals(jumpHash(`key-${i}`, 1), 0);
    }
  });

  await t.step("minimal remapping when adding a bucket", () => {
    const numKeys = 1000;
    let changed = 0;
    for (let i = 0; i < numKeys; i++) {
      const key = `key-${i}`;
      if (jumpHash(key, 10) !== jumpHash(key, 11)) changed++;
    }
    // At most ~1/11 of keys should remap
    assertEquals(changed < numKeys * 0.2, true, `too many remapped: ${changed}/${numKeys}`);
  });

  await t.step("minimal remapping when removing a bucket", () => {
    const numKeys = 1000;
    let changed = 0;
    for (let i = 0; i < numKeys; i++) {
      const key = `key-${i}`;
      if (jumpHash(key, 10) !== jumpHash(key, 9)) changed++;
    }
    // At most ~1/10 of keys should remap
    assertEquals(changed < numKeys * 0.2, true, `too many remapped: ${changed}/${numKeys}`);
  });
});

Deno.test({ name: "RendererRouter", sanitizeOps: false, sanitizeResources: false }, async (t) => {
  const fallback = "http://fallback:3001";

  await t.step("returns fallback when no slug", () => {
    const router = new RendererRouter("dummy-service", fallback, 999999);
    router._setPods(["10.0.0.1", "10.0.0.2"]);
    assertEquals(router.resolve(undefined), fallback);
    router.close();
  });

  await t.step("returns fallback when no pods", () => {
    const router = new RendererRouter("dummy-service", fallback, 999999);
    assertEquals(router.resolve("my-project"), fallback);
    router.close();
  });

  await t.step("routes to a pod when slug and pods available", () => {
    const router = new RendererRouter("dummy-service", fallback, 999999);
    router._setPods(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    const url = router.resolve("my-project");
    assertNotEquals(url, fallback);
    assertEquals(url.startsWith("http://10.0.0."), true);
    router.close();
  });

  await t.step("is deterministic for same slug", () => {
    const router = new RendererRouter("dummy-service", fallback, 999999);
    router._setPods(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    const url1 = router.resolve("my-project");
    const url2 = router.resolve("my-project");
    assertEquals(url1, url2);
    router.close();
  });

  await t.step("distributes across pods", () => {
    const router = new RendererRouter("dummy-service", fallback, 999999);
    const pods = ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"];
    router._setPods(pods);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(router.resolve(`project-${i}`)!);
    }
    // Should hit at least 3 out of 5 pods
    assertEquals(seen.size >= 3, true, `only hit ${seen.size} pods`);
    router.close();
  });

  await t.step("podCount reflects injected pods", () => {
    const router = new RendererRouter("dummy-service", fallback, 999999);
    assertEquals(router.podCount, 0);
    router._setPods(["10.0.0.1", "10.0.0.2"]);
    assertEquals(router.podCount, 2);
    router.close();
  });

  await t.step("resolve still works after close", () => {
    const router = new RendererRouter("dummy-service", fallback, 999999);
    router._setPods(["10.0.0.1"]);
    router.close();
    // Should still resolve with cached pods
    const url = router.resolve("some-project");
    assertEquals(url.startsWith("http://10.0.0.1:"), true);
  });

  await t.step("ready() resolves (first refresh completes)", async () => {
    const router = new RendererRouter("dummy-service", fallback, 999999);
    // ready() should resolve without throwing even if DNS fails
    await router.ready();
    router.close();
  });

  await t.step("falls back when pod list is stale", () => {
    const router = new RendererRouter("dummy-service", fallback, 999999);
    router._setPods(["10.0.0.1", "10.0.0.2"]);
    // Set last refresh to 6 minutes ago (exceeds 5-minute staleness threshold)
    router._setLastRefresh(Date.now() - 6 * 60 * 1000);
    assertEquals(router.resolve("my-project"), fallback);
    router.close();
  });

  await t.step("routes normally when pod list is fresh", () => {
    const router = new RendererRouter("dummy-service", fallback, 999999);
    router._setPods(["10.0.0.1", "10.0.0.2"]);
    // _setPods sets lastSuccessfulRefresh to now, so it should be fresh
    const url = router.resolve("my-project");
    assertNotEquals(url, fallback);
    router.close();
  });

  await t.step("uses static pod IPs from env var", async () => {
    Deno.env.set("VERYFRONT_SERVER_POD_IPS", "10.0.1.1,10.0.1.2,10.0.1.3");
    try {
      const router = new RendererRouter("unused-service", fallback, 999999);
      assertEquals(router.podCount, 3);
      const url = router.resolve("my-project");
      assertNotEquals(url, fallback);
      assertEquals(url.startsWith("http://10.0.1."), true);
      // Should be immediately ready (no DNS)
      await router.ready();
      router.close();
    } finally {
      Deno.env.delete("VERYFRONT_SERVER_POD_IPS");
    }
  });
});
