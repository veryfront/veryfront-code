import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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
    it("does not accept cache identities that could be written to timeout logs", () => {
      assertEquals(waitForInFlightFetch.length, 3);
    });

    it("resolves with the promise result", async () => {
      const result = await waitForInFlightFetch(Promise.resolve("/path/to/file.mjs"));
      assertEquals(result, "/path/to/file.mjs");
    });

    it("resolves with null when promise resolves null", async () => {
      const result = await waitForInFlightFetch(Promise.resolve(null));
      assertEquals(result, null);
    });

    it("propagates rejection", async () => {
      let caught: Error | null = null;
      try {
        await waitForInFlightFetch(Promise.reject(new Error("fetch failed")));
      } catch (e) {
        caught = e as Error;
      }
      assertEquals(caught?.message, "fetch failed");
    });

    it("resolves quickly when promise resolves before timeout", async () => {
      const start = Date.now();
      await waitForInFlightFetch(Promise.resolve("fast"));
      const elapsed = Date.now() - start;
      assertEquals(elapsed < 1000, true);
    });

    it("honors a caller-provided wait window", async () => {
      const originalRandom = Math.random;
      let randomCalls = 0;
      let timer: ReturnType<typeof setTimeout>;
      const slowResult = new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("late"), 25);
      });

      try {
        Math.random = () => {
          randomCalls += 1;
          return 0.5;
        };
        const result = await waitForInFlightFetch(slowResult, 5);

        assertEquals(result, undefined);
        assertEquals(randomCalls, 0);
      } finally {
        Math.random = originalRandom;
        clearTimeout(timer!);
      }
    });

    it("stops waiting when the caller is cancelled", async () => {
      const controller = new AbortController();
      const abortReason = new DOMException("module loading cancelled", "AbortError");
      const pendingFetch = new Promise<string>(() => {});
      const pendingWait = waitForInFlightFetch(pendingFetch, 30_000, controller.signal);

      controller.abort(abortReason);

      const error = await assertRejects(() => pendingWait);
      assertEquals(error, abortReason);
    });
  });
});
