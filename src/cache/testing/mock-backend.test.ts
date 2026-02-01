import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createFailingMock,
  createPopulatedMock,
  createSlowMock,
  MockCacheBackend,
} from "./mock-backend.ts";

describe("cache/testing/mock-backend", () => {
  describe("MockCacheBackend", () => {
    it("stores and retrieves values", async () => {
      const mock = new MockCacheBackend();
      await mock.set("key", "value");
      assertEquals(await mock.get("key"), "value");
    });

    it("returns null for missing keys", async () => {
      const mock = new MockCacheBackend();
      assertEquals(await mock.get("nonexistent"), null);
    });

    it("records operations", async () => {
      const mock = new MockCacheBackend();
      await mock.set("k1", "v1");
      await mock.get("k1");
      await mock.get("k2");

      assertEquals(mock.operations.length, 3);
      assertEquals(mock.getCallCount("set"), 1);
      assertEquals(mock.getCallCount("get"), 2);
    });

    it("tracks operations for specific keys", async () => {
      const mock = new MockCacheBackend();
      await mock.set("target-key", "value");
      await mock.get("target-key");
      await mock.set("other-key", "value");

      const ops = mock.getOperationsForKey("target-key");
      assertEquals(ops.length, 2);
    });

    it("respects TTL expiry", async () => {
      const mock = new MockCacheBackend();
      await mock.set("key", "value", 0.001); // 1ms TTL

      await new Promise((r) => setTimeout(r, 50));
      assertEquals(await mock.get("key"), null);
    });

    it("deletes keys", async () => {
      const mock = new MockCacheBackend();
      await mock.set("key", "value");
      await mock.del("key");
      assertEquals(await mock.get("key"), null);
    });

    it("deletes by pattern", async () => {
      const mock = new MockCacheBackend();
      await mock.set("user:1", "a");
      await mock.set("user:2", "b");
      await mock.set("product:1", "c");

      const deleted = await mock.delByPattern("user:*");
      assertEquals(deleted, 2);
      assertEquals(await mock.get("user:1"), null);
      assertEquals(await mock.get("user:2"), null);
      assertEquals(await mock.get("product:1"), "c");
    });

    it("supports batch get", async () => {
      const mock = new MockCacheBackend();
      await mock.set("k1", "v1");
      await mock.set("k2", "v2");

      const results = await mock.getBatch(["k1", "k2", "k3"]);
      assertEquals(results.get("k1"), "v1");
      assertEquals(results.get("k2"), "v2");
      assertEquals(results.get("k3"), null);
    });

    it("supports batch set", async () => {
      const mock = new MockCacheBackend();
      await mock.setBatch([
        { key: "k1", value: "v1" },
        { key: "k2", value: "v2", ttl: 3600 },
      ]);

      assertEquals(await mock.get("k1"), "v1");
      assertEquals(await mock.get("k2"), "v2");
    });

    it("provides store snapshot", async () => {
      const mock = new MockCacheBackend();
      await mock.set("k1", "v1");
      await mock.set("k2", "v2");

      const snapshot = mock.getStoreSnapshot();
      assertEquals(snapshot.size, 2);
      assertEquals(snapshot.get("k1"), "v1");
    });

    it("clears operations without clearing store", async () => {
      const mock = new MockCacheBackend();
      await mock.set("k1", "v1");
      mock.clearOperations();

      assertEquals(mock.operations.length, 0);
      assertEquals(await mock.get("k1"), "v1");
    });

    it("resets both store and operations", async () => {
      const mock = new MockCacheBackend();
      await mock.set("k1", "v1");
      mock.reset();

      assertEquals(mock.operations.length, 0);
      assertEquals(await mock.get("k1"), null);
    });

    it("tracks size", async () => {
      const mock = new MockCacheBackend();
      assertEquals(mock.size, 0);

      await mock.set("k1", "v1");
      assertEquals(mock.size, 1);

      await mock.set("k2", "v2");
      assertEquals(mock.size, 2);
    });
  });

  describe("createPopulatedMock", () => {
    it("creates mock with initial data", async () => {
      const mock = createPopulatedMock({
        "user:1": "Alice",
        "user:2": "Bob",
      });

      assertEquals(await mock.get("user:1"), "Alice");
      assertEquals(await mock.get("user:2"), "Bob");
    });
  });

  describe("createFailingMock", () => {
    it("fails all operations when failAll is true", async () => {
      const mock = createFailingMock({ failAll: true });

      await assertRejects(
        () => mock.get("any-key"),
        Error,
      );
    });

    it("fails only specific keys on get", async () => {
      const mock = createFailingMock({ failOnGet: ["bad-key"] });

      await mock.set("good-key", "value");
      assertEquals(await mock.get("good-key"), "value");

      await assertRejects(
        () => mock.get("bad-key"),
        Error,
      );
    });

    it("fails only specific keys on set", async () => {
      const mock = createFailingMock({ failOnSet: ["bad-key"] });

      await mock.set("good-key", "value"); // Should succeed
      assertEquals(await mock.get("good-key"), "value");

      await assertRejects(
        () => mock.set("bad-key", "value"),
        Error,
      );
    });

    it("uses custom error message", async () => {
      const mock = createFailingMock({
        failAll: true,
        errorMessage: "Custom error",
      });

      try {
        await mock.get("key");
      } catch (e) {
        assertEquals((e as Error).message, "Custom error");
      }
    });
  });

  describe("createSlowMock", () => {
    it("adds latency to operations", async () => {
      const mock = createSlowMock(50); // 50ms latency

      const start = performance.now();
      await mock.set("key", "value");
      const elapsed = performance.now() - start;

      assertEquals(elapsed >= 45, true, `Expected ~50ms latency, got ${elapsed}ms`);
    });
  });
});
