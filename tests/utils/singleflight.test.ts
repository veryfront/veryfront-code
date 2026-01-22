/**
 * Tests for Singleflight utility.
 */

import { assertEquals, assertRejects } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { Singleflight } from "../../src/utils/singleflight.ts";

describe("Singleflight", () => {
  it("should return same result for concurrent calls with same key", async () => {
    const flight = new Singleflight<string>();
    let callCount = 0;

    const operation = async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return `result-${callCount}`;
    };

    // Start 5 concurrent operations for the same key
    const promises = [
      flight.do("key1", operation),
      flight.do("key1", operation),
      flight.do("key1", operation),
      flight.do("key1", operation),
      flight.do("key1", operation),
    ];

    const results = await Promise.all(promises);

    // All results should be the same (from the single operation)
    assertEquals(results[0], "result-1");
    assertEquals(results[1], "result-1");
    assertEquals(results[2], "result-1");
    assertEquals(results[3], "result-1");
    assertEquals(results[4], "result-1");

    // Operation should only have been called once
    assertEquals(callCount, 1);
  });

  it("should run separate operations for different keys", async () => {
    const flight = new Singleflight<string>();
    const callCounts = new Map<string, number>();

    const operation = (key: string) => async () => {
      const count = (callCounts.get(key) || 0) + 1;
      callCounts.set(key, count);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `${key}-${count}`;
    };

    // Start operations for different keys concurrently
    const [result1, result2, result3] = await Promise.all([
      flight.do("key1", operation("key1")),
      flight.do("key2", operation("key2")),
      flight.do("key3", operation("key3")),
    ]);

    // Each key should have its own result (called once each)
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

    const failingOperation = async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("Test error");
    };

    // Start concurrent operations that will fail
    const promises = [
      flight.do("key1", failingOperation),
      flight.do("key1", failingOperation),
      flight.do("key1", failingOperation),
    ];

    // All promises should reject with the same error
    for (const promise of promises) {
      await assertRejects(
        () => promise,
        Error,
        "Test error",
      );
    }

    // Operation should only have been called once
    assertEquals(callCount, 1);
  });

  it("should allow new operations after previous completes", async () => {
    const flight = new Singleflight<string>();
    let callCount = 0;

    const operation = async () => {
      callCount++;
      return `result-${callCount}`;
    };

    // First operation
    const result1 = await flight.do("key1", operation);
    assertEquals(result1, "result-1");

    // Second operation for the same key (after first completes)
    const result2 = await flight.do("key1", operation);
    assertEquals(result2, "result-2");

    // Both operations should have run
    assertEquals(callCount, 2);
  });

  it("should track in-flight status correctly", async () => {
    const flight = new Singleflight<string>();

    assertEquals(flight.has("key1"), false);
    assertEquals(flight.size, 0);

    // Start an operation
    const promise = flight.do("key1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "result";
    });

    // Should be in-flight
    assertEquals(flight.has("key1"), true);
    assertEquals(flight.size, 1);

    await promise;

    // Should no longer be in-flight
    assertEquals(flight.has("key1"), false);
    assertEquals(flight.size, 0);
  });

  it("should clean up after error", async () => {
    const flight = new Singleflight<string>();

    // Start a failing operation
    const promise = flight.do("key1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("Test error");
    });

    assertEquals(flight.has("key1"), true);

    try {
      await promise;
    } catch {
      // Expected error
    }

    // Should be cleaned up after error
    assertEquals(flight.has("key1"), false);
    assertEquals(flight.size, 0);
  });
});
