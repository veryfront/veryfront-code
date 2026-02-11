import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { jumpHash } from "./renderer-router.ts";

describe("jumpHash", () => {
  it("returns index within range", () => {
    for (let i = 0; i < 100; i++) {
      const idx = jumpHash(`project-${i}`, 10);
      assertEquals(idx >= 0 && idx < 10, true, `Index ${idx} out of range for project-${i}`);
    }
  });

  it("is deterministic for same input", () => {
    const idx1 = jumpHash("my-project", 5);
    const idx2 = jumpHash("my-project", 5);
    assertEquals(idx1, idx2);
  });

  it("different keys distribute across buckets", () => {
    const buckets = new Set<number>();
    for (let i = 0; i < 100; i++) {
      buckets.add(jumpHash(`project-${i}`, 10));
    }
    // With 100 keys and 10 buckets, we should hit most buckets
    assertEquals(buckets.size >= 5, true, `Only ${buckets.size} buckets used out of 10`);
  });

  it("handles single bucket", () => {
    assertEquals(jumpHash("anything", 1), 0);
  });

  it("minimal remapping when adding a bucket", () => {
    const numKeys = 1000;
    const oldBuckets = 5;
    const newBuckets = 6;
    let remapped = 0;

    for (let i = 0; i < numKeys; i++) {
      const key = `project-${i}`;
      const oldIdx = jumpHash(key, oldBuckets);
      const newIdx = jumpHash(key, newBuckets);
      if (oldIdx !== newIdx) remapped++;
    }

    // Jump hash guarantees at most ~1/n keys remap when adding one bucket
    // Expected: ~1000/6 ≈ 167 remapped, allow some tolerance
    const maxExpected = Math.ceil(numKeys / newBuckets) * 1.5;
    assertEquals(
      remapped <= maxExpected,
      true,
      `Too many remapped: ${remapped} (expected <= ${maxExpected})`,
    );
  });

  it("minimal remapping when removing a bucket", () => {
    const numKeys = 1000;
    const oldBuckets = 6;
    const newBuckets = 5;
    let remapped = 0;

    for (let i = 0; i < numKeys; i++) {
      const key = `project-${i}`;
      const oldIdx = jumpHash(key, oldBuckets);
      const newIdx = jumpHash(key, newBuckets);
      if (oldIdx !== newIdx) remapped++;
    }

    // When shrinking from 6→5, only keys that were on bucket 5 must move
    // plus some redistribution, so at most ~1/oldBuckets should remap
    const maxExpected = Math.ceil(numKeys / oldBuckets) * 1.5;
    assertEquals(
      remapped <= maxExpected,
      true,
      `Too many remapped: ${remapped} (expected <= ${maxExpected})`,
    );
  });
});

describe("RendererRouter", () => {
  it("falls back to ClusterIP URL when no slug", async () => {
    const { RendererRouter } = await import("./renderer-router.ts");
    const fallback = "http://veryfront-server:80";
    const router = new RendererRouter("nonexistent-headless.local", fallback, 60_000);

    try {
      assertEquals(router.resolve(undefined), fallback);
      assertEquals(router.resolve(""), fallback);
    } finally {
      router.close();
    }
  });

  it("falls back when DNS fails (no pods)", async () => {
    const { RendererRouter } = await import("./renderer-router.ts");
    const fallback = "http://veryfront-server:80";
    const router = new RendererRouter("nonexistent-headless.local", fallback, 60_000);

    // Give DNS time to fail
    await new Promise((r) => setTimeout(r, 200));

    try {
      assertEquals(router.resolve("my-project"), fallback);
    } finally {
      router.close();
    }
  });

  it("routes to specific pod when pods are available", async () => {
    const { RendererRouter } = await import("./renderer-router.ts");
    const fallback = "http://veryfront-server:80";
    const router = new RendererRouter("nonexistent-headless.local", fallback, 60_000);

    try {
      // Inject pods directly for testing
      router._setPods(["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]);
      assertEquals(router.podCount, 4);

      const url = router.resolve("my-project");
      // Should be a direct pod URL, not the fallback
      assertEquals(url.startsWith("http://10.0.0."), true, `Expected pod URL, got: ${url}`);
      assertEquals(url !== fallback, true, "Should not be the fallback URL");

      // Same slug always routes to same pod (deterministic)
      assertEquals(router.resolve("my-project"), url);
      assertEquals(router.resolve("my-project"), url);
    } finally {
      router.close();
    }
  });

  it("distributes different slugs across pods", async () => {
    const { RendererRouter } = await import("./renderer-router.ts");
    const router = new RendererRouter("nonexistent-headless.local", "http://fallback:80", 60_000);

    try {
      router._setPods(["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]);

      const urls = new Set<string>();
      for (let i = 0; i < 50; i++) {
        urls.add(router.resolve(`project-${i}`));
      }
      // 50 projects across 4 pods should hit multiple pods
      assertEquals(urls.size >= 2, true, `Only ${urls.size} unique pod URLs for 50 projects`);
    } finally {
      router.close();
    }
  });

  it("preserves pods on DNS failure", async () => {
    const { RendererRouter } = await import("./renderer-router.ts");
    const router = new RendererRouter("nonexistent-headless.local", "http://fallback:80", 60_000);

    try {
      // Inject pods, then let DNS fail — pods should be kept
      router._setPods(["10.0.0.1", "10.0.0.2"]);
      assertEquals(router.podCount, 2);

      // Wait for a DNS refresh attempt to fail
      await new Promise((r) => setTimeout(r, 200));

      // Pods should still be there (not wiped by DNS failure)
      assertEquals(router.podCount, 2);
      const url = router.resolve("test-project");
      assertEquals(url.startsWith("http://10.0.0."), true);
    } finally {
      router.close();
    }
  });

  it("still resolves after close()", async () => {
    const { RendererRouter } = await import("./renderer-router.ts");
    const fallback = "http://fallback:80";
    const router = new RendererRouter("nonexistent-headless.local", fallback, 60_000);

    router._setPods(["10.0.0.1"]);
    router.close();

    // Should still resolve using cached pods (close stops refresh, not resolution)
    const url = router.resolve("my-project");
    assertEquals(url.startsWith("http://10.0.0.1:"), true);
  });

  it("exposes podCount", async () => {
    const { RendererRouter } = await import("./renderer-router.ts");
    const router = new RendererRouter("nonexistent-headless.local", "http://fallback:80", 60_000);

    await new Promise((r) => setTimeout(r, 200));

    try {
      assertEquals(router.podCount, 0);
    } finally {
      router.close();
    }
  });
});
