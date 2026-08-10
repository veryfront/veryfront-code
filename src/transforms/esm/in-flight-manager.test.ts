import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
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
    it("keeps a committed publication current after its last caller cancels", async () => {
      const cacheKey = "committed-publication";
      const publicationStarted = Promise.withResolvers<void>();
      const releasePublication = Promise.withResolvers<void>();
      const ownerController = new AbortController();
      let sharedSignal: AbortSignal | undefined;
      const promise = createInFlightHttpFetch(
        cacheKey,
        async (abortSignal, _reportProgress, control) => {
          sharedSignal = abortSignal;
          assertEquals(control.commit(1_000), true);
          publicationStarted.resolve();
          await releasePublication.promise;
          abortSignal.throwIfAborted();
          return "/path/to/committed-publication.mjs";
        },
      );
      const owner = waitForSharedInFlightHttpFetch(
        cacheKey,
        promise,
        null,
        ownerController.signal,
      );

      try {
        await publicationStarted.promise;
        ownerController.abort(new DOMException("owner cancelled", "AbortError"));
        await assertRejects(() => owner, DOMException, "owner cancelled");

        assertEquals(sharedSignal?.aborted, false);
        assertEquals(inFlightHttpFetches.get(cacheKey), promise);

        const follower = waitForSharedInFlightHttpFetch(cacheKey, promise, null);
        releasePublication.resolve();
        assertEquals(await follower, "/path/to/committed-publication.mjs");
        await promise;
        assertEquals(inFlightHttpFetches.has(cacheKey), false);
      } finally {
        releasePublication.resolve();
        await Promise.allSettled([owner, promise]);
        __clearInFlightHttpFetches();
      }
    });

    it("retires a committed publication when its deadline expires", async () => {
      const cacheKey = "committed-publication-timeout";
      const publicationStarted = Promise.withResolvers<void>();
      const publicationFinished = Promise.withResolvers<void>();
      const releasePublication = Promise.withResolvers<void>();
      let sharedSignal: AbortSignal | undefined;
      const promise = createInFlightHttpFetch(
        cacheKey,
        async (abortSignal, _reportProgress, control) => {
          sharedSignal = abortSignal;
          assertEquals(control.commit(5), true);
          publicationStarted.resolve();
          await releasePublication.promise;
          publicationFinished.resolve();
          return "/path/to/late-publication.mjs";
        },
      );
      const owner = waitForSharedInFlightHttpFetch(cacheKey, promise, null);

      try {
        await publicationStarted.promise;
        const error = await assertRejects(
          () => owner,
          DOMException,
          "HTTP bundle publication timed out",
        );
        assertInstanceOf(error, DOMException);
        assertEquals(error.name, "TimeoutError");
        assertEquals(sharedSignal?.aborted, true);
        assertEquals(inFlightHttpFetches.has(cacheKey), false);

        releasePublication.resolve();
        await publicationFinished.promise;
      } finally {
        releasePublication.resolve();
        await Promise.allSettled([owner, promise]);
        __clearInFlightHttpFetches();
      }
    });

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

    it("keeps a live follower attached across bounded wait intervals", async () => {
      const cacheKey = "live-follower-timeout";
      const release = Promise.withResolvers<void>();
      const callerController = new AbortController();
      let sharedSignal: AbortSignal | undefined;
      const promise = createInFlightHttpFetch(cacheKey, async (abortSignal) => {
        sharedSignal = abortSignal;
        await release.promise;
        abortSignal.throwIfAborted();
        return "/path/to/live-follower-timeout.mjs";
      });
      const originalOwnerController = new AbortController();
      const originalOwner = waitForSharedInFlightHttpFetch(
        cacheKey,
        promise,
        null,
        originalOwnerController.signal,
      );
      const originalOwnerOutcome = originalOwner.catch((error) => error);
      const follower = waitForSharedInFlightHttpFetch(
        cacheKey,
        promise,
        5,
        callerController.signal,
      );
      let followerSettled = false;
      void follower.then(() => followerSettled = true);

      try {
        originalOwnerController.abort(
          new DOMException("original caller cancelled", "AbortError"),
        );
        await originalOwnerOutcome;
        await new Promise((resolve) => setTimeout(resolve, 20));

        assertEquals(followerSettled, false);
        assertEquals(sharedSignal?.aborted, false);
        assertEquals(inFlightHttpFetches.get(cacheKey), promise);

        release.resolve();
        assertEquals(await follower, "/path/to/live-follower-timeout.mjs");
      } finally {
        release.resolve();
        await Promise.allSettled([originalOwner, follower, promise]);
        __clearInFlightHttpFetches();
      }
    });

    it("returns after the wait window for callers without cancellation", async () => {
      const cacheKey = "uncancelled-follower-timeout";
      const release = Promise.withResolvers<void>();
      const followerController = new AbortController();
      let sharedSignal: AbortSignal | undefined;
      const promise = createInFlightHttpFetch(cacheKey, async (abortSignal) => {
        sharedSignal = abortSignal;
        await release.promise;
        abortSignal.throwIfAborted();
        return "/path/to/uncancelled-follower-timeout.mjs";
      });
      const liveFollower = waitForSharedInFlightHttpFetch(
        cacheKey,
        promise,
        5,
        followerController.signal,
      );
      const signalLessFollower = waitForSharedInFlightHttpFetch(cacheKey, promise, 5);
      let watchdogTimer: ReturnType<typeof setTimeout>;

      try {
        const outcome = await Promise.race([
          signalLessFollower.then((result) => ({ result, status: "settled" as const })),
          new Promise<{ status: "hung" }>((resolve) => {
            watchdogTimer = setTimeout(() => resolve({ status: "hung" }), 30);
          }),
        ]);

        assertEquals(outcome, { result: undefined, status: "settled" });
        assertEquals(sharedSignal?.aborted, false);
        assertEquals(inFlightHttpFetches.get(cacheKey), promise);

        release.resolve();
        assertEquals(
          await liveFollower,
          "/path/to/uncancelled-follower-timeout.mjs",
        );
      } finally {
        clearTimeout(watchdogTimer!);
        release.resolve();
        await Promise.allSettled([promise, liveFollower, signalLessFollower]);
        __clearInFlightHttpFetches();
      }
    });

    it("returns a timeout before waiting for retained cycle peers", async () => {
      const cycleDetected = Promise.withResolvers<void>();
      const firstWaitStarted = Promise.withResolvers<void>();
      const releaseSecond = Promise.withResolvers<void>();
      const startCycle = Promise.withResolvers<void>();
      const secondFlight: { promise?: Promise<string | null> } = {};
      const secondOwnerController = new AbortController();

      const firstPromise = createInFlightHttpFetch("bounded-cycle-a", async () => {
        await startCycle.promise;
        const dependency = waitForSharedInFlightHttpFetch(
          "bounded-cycle-b",
          secondFlight.promise!,
          1_000,
        );
        firstWaitStarted.resolve();
        await dependency;
        return "/path/to/bounded-cycle-a.mjs";
      });
      secondFlight.promise = createInFlightHttpFetch("bounded-cycle-b", async () => {
        startCycle.resolve();
        await firstWaitStarted.promise;
        assertEquals(
          await waitForSharedInFlightHttpFetch(
            "bounded-cycle-a",
            firstPromise,
            1_000,
          ),
          IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE,
        );
        cycleDetected.resolve();
        await releaseSecond.promise;
        return "/path/to/bounded-cycle-b.mjs";
      });
      const secondOwner = waitForSharedInFlightHttpFetch(
        "bounded-cycle-b",
        secondFlight.promise,
        null,
        secondOwnerController.signal,
      );
      let watchdogTimer: ReturnType<typeof setTimeout>;

      try {
        await cycleDetected.promise;
        const follower = waitForSharedInFlightHttpFetch(
          "bounded-cycle-b",
          secondFlight.promise,
          5,
        );
        const outcome = await Promise.race([
          follower.then((result) => ({ result, status: "settled" as const })),
          new Promise<{ status: "hung" }>((resolve) => {
            watchdogTimer = setTimeout(() => resolve({ status: "hung" }), 30);
          }),
        ]);

        assertEquals(outcome, { result: undefined, status: "settled" });
        await follower;
      } finally {
        clearTimeout(watchdogTimer!);
        releaseSecond.resolve();
        await Promise.allSettled([firstPromise, secondOwner, secondFlight.promise]);
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

    it("keeps a cycle-closing owner pending until its peer finishes", async () => {
      const firstWaitStarted = Promise.withResolvers<void>();
      const allowSecondWait = Promise.withResolvers<void>();
      const firstDependencyResolved = Promise.withResolvers<void>();
      const releaseFirst = Promise.withResolvers<void>();
      const secondFlight: { promise?: Promise<string | null> } = {};

      const firstPromise = createInFlightHttpFetch("ready-cycle-a", async () => {
        firstWaitStarted.resolve();
        await waitForSharedInFlightHttpFetch(
          "ready-cycle-b",
          secondFlight.promise!,
          1_000,
        );
        firstDependencyResolved.resolve();
        await releaseFirst.promise;
        return "/path/to/ready-cycle-a.mjs";
      });
      secondFlight.promise = createInFlightHttpFetch("ready-cycle-b", async () => {
        await allowSecondWait.promise;
        assertEquals(
          await waitForSharedInFlightHttpFetch(
            "ready-cycle-a",
            firstPromise,
            1_000,
          ),
          IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE,
        );
        return "/path/to/ready-cycle-b.mjs";
      });

      const firstOwner = waitForSharedInFlightHttpFetch(
        "ready-cycle-a",
        firstPromise,
        null,
      );
      const secondOwner = waitForSharedInFlightHttpFetch(
        "ready-cycle-b",
        secondFlight.promise,
        null,
      );
      let secondOwnerSettled = false;
      void secondOwner.then(() => secondOwnerSettled = true);

      try {
        await firstWaitStarted.promise;
        allowSecondWait.resolve();
        await firstDependencyResolved.promise;
        await Promise.resolve();
        assertEquals(secondOwnerSettled, false);

        releaseFirst.resolve();
        assertEquals(await firstOwner, "/path/to/ready-cycle-a.mjs");
        assertEquals(await secondOwner, "/path/to/ready-cycle-b.mjs");
      } finally {
        allowSecondWait.resolve();
        releaseFirst.resolve();
        await Promise.allSettled([firstOwner, secondOwner]);
        __clearInFlightHttpFetches();
      }
    });

    it("keeps a cycle peer alive when its original caller cancels", async () => {
      const allowSecondWait = Promise.withResolvers<void>();
      const cycleDetected = Promise.withResolvers<void>();
      const releaseSecond = Promise.withResolvers<void>();
      const firstDependencyResolved = Promise.withResolvers<void>();
      const releaseFirst = Promise.withResolvers<void>();
      const secondFlight: { promise?: Promise<string | null> } = {};
      const firstCallerController = new AbortController();
      const secondCallerController = new AbortController();
      const firstCallerAbort = new DOMException("first caller cancelled", "AbortError");
      const secondCallerAbort = new DOMException("second caller cancelled", "AbortError");
      let firstSharedSignal: AbortSignal | undefined;

      const firstPromise = createInFlightHttpFetch(
        "cancel-cycle-a",
        async (abortSignal) => {
          firstSharedSignal = abortSignal;
          await waitForSharedInFlightHttpFetch(
            "cancel-cycle-b",
            secondFlight.promise!,
            1_000,
          );
          firstDependencyResolved.resolve();
          await releaseFirst.promise;
          abortSignal.throwIfAborted();
          return "/path/to/cancel-cycle-a.mjs";
        },
      );
      secondFlight.promise = createInFlightHttpFetch("cancel-cycle-b", async () => {
        await allowSecondWait.promise;
        assertEquals(
          await waitForSharedInFlightHttpFetch(
            "cancel-cycle-a",
            firstPromise,
            1_000,
          ),
          IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE,
        );
        cycleDetected.resolve();
        await releaseSecond.promise;
        return "/path/to/cancel-cycle-b.mjs";
      });

      const firstOwner = waitForSharedInFlightHttpFetch(
        "cancel-cycle-a",
        firstPromise,
        null,
        firstCallerController.signal,
      );
      const firstOwnerOutcome = firstOwner.catch((error) => error);
      const secondOwner = waitForSharedInFlightHttpFetch(
        "cancel-cycle-b",
        secondFlight.promise,
        null,
        secondCallerController.signal,
      );
      const secondOwnerOutcome = secondOwner.catch((error) => error);
      const secondFollower = waitForSharedInFlightHttpFetch(
        "cancel-cycle-b",
        secondFlight.promise,
        1_000,
      );

      try {
        allowSecondWait.resolve();
        await cycleDetected.promise;
        firstCallerController.abort(firstCallerAbort);

        assertEquals(await firstOwnerOutcome, firstCallerAbort);
        secondCallerController.abort(secondCallerAbort);
        assertEquals(await secondOwnerOutcome, secondCallerAbort);
        assertEquals(firstSharedSignal?.aborted, false);

        releaseSecond.resolve();
        await firstDependencyResolved.promise;
        releaseFirst.resolve();
        assertEquals(await secondFollower, "/path/to/cancel-cycle-b.mjs");
      } finally {
        allowSecondWait.resolve();
        releaseSecond.resolve();
        releaseFirst.resolve();
        await Promise.allSettled([firstOwner, secondOwner, secondFollower]);
        __clearInFlightHttpFetches();
      }
    });

    it("releases cycle retention after every caller cancels", async () => {
      const allowSecondWait = Promise.withResolvers<void>();
      const cycleDetected = Promise.withResolvers<void>();
      const releaseSecond = Promise.withResolvers<void>();
      const secondFlight: { promise?: Promise<string | null> } = {};
      const firstCaller = new AbortController();
      const secondCaller = new AbortController();
      let firstSharedSignal: AbortSignal | undefined;
      let secondSharedSignal: AbortSignal | undefined;

      const firstPromise = createInFlightHttpFetch("orphan-cycle-a", async (abortSignal) => {
        firstSharedSignal = abortSignal;
        await waitForSharedInFlightHttpFetch(
          "orphan-cycle-b",
          secondFlight.promise!,
          1_000,
          abortSignal,
        );
        return "/path/to/orphan-cycle-a.mjs";
      });
      secondFlight.promise = createInFlightHttpFetch(
        "orphan-cycle-b",
        async (abortSignal) => {
          secondSharedSignal = abortSignal;
          await allowSecondWait.promise;
          assertEquals(
            await waitForSharedInFlightHttpFetch(
              "orphan-cycle-a",
              firstPromise,
              1_000,
              abortSignal,
            ),
            IN_FLIGHT_HTTP_FETCH_DEPENDENCY_CYCLE,
          );
          cycleDetected.resolve();
          await waitForInFlightFetch(
            releaseSecond.promise.then(() => "released"),
            30_000,
            abortSignal,
          );
          return "/path/to/orphan-cycle-b.mjs";
        },
      );

      const firstOwner = waitForSharedInFlightHttpFetch(
        "orphan-cycle-a",
        firstPromise,
        null,
        firstCaller.signal,
      );
      const secondOwner = waitForSharedInFlightHttpFetch(
        "orphan-cycle-b",
        secondFlight.promise,
        null,
        secondCaller.signal,
      );
      const firstOutcome = firstOwner.catch((error) => error);
      const secondOutcome = secondOwner.catch((error) => error);

      try {
        allowSecondWait.resolve();
        await cycleDetected.promise;
        firstCaller.abort(new DOMException("first caller cancelled", "AbortError"));
        await firstOutcome;
        assertEquals(firstSharedSignal?.aborted, false);

        secondCaller.abort(new DOMException("second caller cancelled", "AbortError"));
        await secondOutcome;
        let retentionTimer: ReturnType<typeof setTimeout>;
        const retained = new Promise<"retained">((resolve) => {
          retentionTimer = setTimeout(() => resolve("retained"), 20);
        });
        const sharedWork = await Promise.race([
          Promise.allSettled([firstPromise, secondFlight.promise]).then(() => "settled" as const),
          retained,
        ]).finally(() => clearTimeout(retentionTimer));

        assertEquals(sharedWork, "settled");
        assertEquals(firstSharedSignal?.aborted, true);
        assertEquals(secondSharedSignal?.aborted, true);
        assertEquals(inFlightHttpFetches.size, 0);
      } finally {
        allowSecondWait.resolve();
        releaseSecond.resolve();
        await Promise.allSettled([firstOwner, secondOwner, firstPromise, secondFlight.promise]);
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
