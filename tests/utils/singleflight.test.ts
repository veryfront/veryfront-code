import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { Singleflight } from "../../src/utils/singleflight.ts";

describe("Singleflight", () => {
  it("should return same result for concurrent calls with same key", async () => {
    const flight = new Singleflight<string>();
    let callCount = 0;

    const operation = async (): Promise<string> => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return `result-${callCount}`;
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => flight.do("key1", operation)),
    );

    for (const result of results) {
      assertEquals(result, "result-1");
    }

    assertEquals(callCount, 1);
  });

  it("should run separate operations for different keys", async () => {
    const flight = new Singleflight<string>();
    const callCounts = new Map<string, number>();

    const operation = (key: string) => async (): Promise<string> => {
      const count = (callCounts.get(key) ?? 0) + 1;
      callCounts.set(key, count);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `${key}-${count}`;
    };

    const [result1, result2, result3] = await Promise.all([
      flight.do("key1", operation("key1")),
      flight.do("key2", operation("key2")),
      flight.do("key3", operation("key3")),
    ]);

    assertEquals(callCounts.get("key1"), 1);
    assertEquals(callCounts.get("key2"), 1);
    assertEquals(callCounts.get("key3"), 1);
    assertEquals(result1, "key1-1");
    assertEquals(result2, "key2-1");
    assertEquals(result3, "key3-1");
  });

  it("should propagate errors to all waiters", async () => {
    const flight = new Singleflight<string>();
    let callCount = 0;

    const failingOperation = async (): Promise<string> => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("Test error");
    };

    const promises = Array.from({ length: 3 }, () =>
      flight.do("key1", failingOperation),
    );

    await Promise.all(
      promises.map((promise) =>
        assertRejects(() => promise, Error, "Test error")
      ),
    );

    assertEquals(callCount, 1);
  });

  it("should allow new operations after previous completes", async () => {
    const flight = new Singleflight<string>();
    let callCount = 0;

    const operation = async (): Promise<string> => {
      callCount++;
      return `result-${callCount}`;
    };

    assertEquals(await flight.do("key1", operation), "result-1");
    assertEquals(await flight.do("key1", operation), "result-2");
    assertEquals(callCount, 2);
  });

  it("should track in-flight status correctly", async () => {
    const flight = new Singleflight<string>();

    assertEquals(flight.has("key1"), false);
    assertEquals(flight.size, 0);

    const promise = flight.do("key1", async (): Promise<string> => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "result";
    });

    assertEquals(flight.has("key1"), true);
    assertEquals(flight.size, 1);

    await promise;

    assertEquals(flight.has("key1"), false);
    assertEquals(flight.size, 0);
  });

  it("should clean up after error", async () => {
    const flight = new Singleflight<string>();

    const promise = flight.do("key1", async (): Promise<string> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("Test error");
    });

    assertEquals(flight.has("key1"), true);

    try {
      await promise;
    } catch {
      // Expected error
    }

    assertEquals(flight.has("key1"), false);
    assertEquals(flight.size, 0);
  });
});
