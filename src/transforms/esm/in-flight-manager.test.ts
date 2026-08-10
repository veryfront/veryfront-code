import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __clearInFlightHttpFetches,
  createInFlightHttpFetch,
  IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE,
  inFlightHttpFetches,
  waitForInFlightFetch,
  waitForSharedInFlightHttpFetch,
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

  describe("waitForSharedInFlightHttpFetch", () => {
    it("does not apply the follower timeout to the flight owner", async () => {
      const cacheKey = "owner-with-recursive-work";
      const release = Promise.withResolvers<void>();
      const promise = createInFlightHttpFetch(cacheKey, async () => {
        await release.promise;
        return "/path/to/complete-graph.mjs";
      });

      try {
        const owner = waitForSharedInFlightHttpFetch(cacheKey, promise, null);
        await new Promise((resolve) => setTimeout(resolve, 10));
        release.resolve();

        assertEquals(await owner, "/path/to/complete-graph.mjs");
      } finally {
        __clearInFlightHttpFetches();
      }
    });

    it("breaks dependency cycles between independent fetch owners", async () => {
      const startCycle = Promise.withResolvers<void>();
      const secondFlight: { promise?: Promise<string | null> } = {};
      let cycleDetections = 0;

      const firstPromise = createInFlightHttpFetch("cycle-a", async () => {
        await startCycle.promise;
        const result = await waitForSharedInFlightHttpFetch(
          "cycle-b",
          secondFlight.promise!,
          1_000,
        );
        if (result === IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE) cycleDetections++;
        return "/path/to/cycle-a.mjs";
      });
      secondFlight.promise = createInFlightHttpFetch("cycle-b", async () => {
        startCycle.resolve();
        const result = await waitForSharedInFlightHttpFetch(
          "cycle-a",
          firstPromise,
          1_000,
        );
        if (result === IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE) cycleDetections++;
        return "/path/to/cycle-b.mjs";
      });

      try {
        assertEquals(
          await Promise.all([
            waitForSharedInFlightHttpFetch("cycle-a", firstPromise, null),
            waitForSharedInFlightHttpFetch("cycle-b", secondFlight.promise, null),
          ]),
          ["/path/to/cycle-a.mjs", "/path/to/cycle-b.mjs"],
        );
        assertEquals(cycleDetections, 1);
        assertEquals(inFlightHttpFetches.size, 0);
      } finally {
        __clearInFlightHttpFetches();
      }
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
