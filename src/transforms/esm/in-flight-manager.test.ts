import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __clearInFlightHttpFetches,
  inFlightHttpFetches,
  waitForInFlightFetch,
} from "./in-flight-manager.ts";

describe("transforms/esm/in-flight-manager", () => {
  describe("__clearInFlightHttpFetches", () => {
    it("clears the in-flight map", () => {
      inFlightHttpFetches.set("test-key", Promise.resolve("value"));
      assertEquals(inFlightHttpFetches.size, 1);
      __clearInFlightHttpFetches();
      assertEquals(inFlightHttpFetches.size, 0);
    });
  });

  describe("inFlightHttpFetches", () => {
    it("is a Map instance", () => {
      assertEquals(inFlightHttpFetches instanceof Map, true);
    });

    it("can store and retrieve promises", () => {
      __clearInFlightHttpFetches();
      const p = Promise.resolve("result");
      inFlightHttpFetches.set("key1", p);
      assertEquals(inFlightHttpFetches.get("key1"), p);
      __clearInFlightHttpFetches();
    });
  });

  describe("waitForInFlightFetch", () => {
    it("resolves with the promise result", async () => {
      const result = await waitForInFlightFetch(Promise.resolve("/path/to/file.mjs"), "key");
      assertEquals(result, "/path/to/file.mjs");
    });

    it("resolves with null when promise resolves null", async () => {
      const result = await waitForInFlightFetch(Promise.resolve(null), "key");
      assertEquals(result, null);
    });

    it("propagates rejection", async () => {
      let caught: Error | null = null;
      try {
        await waitForInFlightFetch(Promise.reject(new Error("fetch failed")), "key");
      } catch (e) {
        caught = e as Error;
      }
      assertEquals(caught?.message, "fetch failed");
    });

    it("resolves quickly when promise resolves before timeout", async () => {
      const start = Date.now();
      await waitForInFlightFetch(Promise.resolve("fast"), "key");
      const elapsed = Date.now() - start;
      assertEquals(elapsed < 1000, true);
    });
  });
});
