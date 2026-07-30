import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { StaticPathsFetcher, type StaticPathsFetcherOptions } from "./static-paths-fetcher.ts";
import type { PageWithData, StaticPathsResult } from "./types.ts";
import { TimeoutError } from "#veryfront/utils/timeout.ts";
import { FakeTime } from "#std/testing/time";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { DataExecutionAdmission } from "./execution-admission.ts";
import { VeryfrontError } from "#veryfront/errors";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";

function createFetcher(options: StaticPathsFetcherOptions = {}): StaticPathsFetcher {
  return new StaticPathsFetcher(options);
}

function createPageModule(
  getStaticPaths?: PageWithData["getStaticPaths"],
): PageWithData {
  return { default: () => null, ...(getStaticPaths ? { getStaticPaths } : {}) };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 4; index++) {
    await Promise.resolve();
  }
}

async function assertOverloaded(
  run: () => Promise<unknown>,
): Promise<VeryfrontError> {
  const error = await assertRejects(run);
  assertInstanceOf(error, VeryfrontError);
  assertEquals(error.slug, "service-overloaded");
  return error;
}

describe("StaticPathsFetcher", () => {
  it("should create a new instance", () => {
    assertExists(createFetcher());
  });

  describe("constructor", () => {
    it("should preserve the unbounded default and accept an explicit zero sentinel", () => {
      assertExists(createFetcher());
      assertExists(createFetcher({ timeoutMs: 0 }));
    });

    it("should reject invalid explicit timeout values", () => {
      for (const timeoutMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertThrows(
          () => createFetcher({ timeoutMs }),
          RangeError,
          "Static paths timeout",
        );
      }

      assertThrows(
        () => createFetcher({ timeoutMs: MAX_TIMER_DELAY_MS + 1 }),
        RangeError,
        "Static paths timeout",
      );
    });
  });

  describe("fetch", () => {
    it("should return null when getStaticPaths is not defined", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule();

      const result = await fetcher.fetch(pageModule);

      assertEquals(result, null);
    });

    it("rejects an invalid runtime project identity before hook dispatch", async () => {
      const fetcher = createFetcher();
      let calls = 0;

      await assertRejects(
        () =>
          fetcher.fetch(
            createPageModule(() => {
              calls++;
              return { paths: [], fallback: false };
            }),
            { projectId: 1 as unknown as string },
          ),
        TypeError,
        "must be a non-empty string",
      );
      assertEquals(calls, 0);
    });

    it("rejects executable, Proxy, unknown, and invalid-signal options", async () => {
      let accessorReads = 0;
      let proxyTraps = 0;
      let calls = 0;
      const accessor = Object.defineProperty({}, "maxPaths", {
        enumerable: true,
        get() {
          accessorReads++;
          return 1;
        },
      });
      const proxy = new Proxy({}, {
        getPrototypeOf(target) {
          proxyTraps++;
          return Reflect.getPrototypeOf(target);
        },
        ownKeys(target) {
          proxyTraps++;
          return Reflect.ownKeys(target);
        },
      });
      const pageModule = createPageModule(() => {
        calls++;
        return { paths: [], fallback: false };
      });

      for (
        const options of [
          accessor,
          proxy,
          { unknown: true },
          { signal: {} },
        ]
      ) {
        await assertRejects(
          () => createFetcher().fetch(pageModule, options as never),
          TypeError,
        );
      }
      assertEquals(accessorReads, 0);
      assertEquals(proxyTraps, 0);
      assertEquals(calls, 0);
    });

    it("should return paths from getStaticPaths", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [
          { params: { id: "1" } },
          { params: { id: "2" } },
          { params: { id: "3" } },
        ],
        fallback: false,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths.length, 3);
      assertEquals(result.paths[0]?.params.id, "1");
      assertEquals(result.paths[1]?.params.id, "2");
      assertEquals(result.paths[2]?.params.id, "3");
    });

    it("should return fallback: false", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [],
        fallback: false,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.fallback, false);
    });

    it("should return fallback: true", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [{ params: { slug: "test" } }],
        fallback: true,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.fallback, true);
    });

    it("should return fallback: blocking", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [],
        fallback: "blocking",
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.fallback, "blocking");
    });

    it("should handle array params for catch-all routes", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [
          { params: { slug: ["docs", "intro"] } },
          { params: { slug: ["docs", "getting-started"] } },
          { params: { slug: ["blog", "post-1"] } },
        ],
        fallback: false,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths[0]?.params.slug, ["docs", "intro"]);
      assertEquals(result.paths[1]?.params.slug, ["docs", "getting-started"]);
    });

    it("should handle empty paths array", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [],
        fallback: true,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths.length, 0);
    });

    it("should support synchronous getStaticPaths", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [{ params: { id: "sync" } }],
        fallback: false,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths[0]?.params.id, "sync");
    });

    it("should default nullish getStaticPaths results to an empty non-fallback response", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(
        () => undefined as unknown as StaticPathsResult,
      );

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths, []);
      assertEquals(result.fallback, false);
    });

    it("should return a fresh empty result for each nullish response", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(
        () => undefined as unknown as StaticPathsResult,
      );

      const first = await fetcher.fetch(pageModule);
      assertExists(first);
      first.paths.push({ params: { polluted: "true" } });

      const second = await fetcher.fetch(pageModule);
      assertExists(second);
      assertEquals(second.paths, []);
      assertEquals(second.fallback, false);
    });

    it("rejects malformed static path result shapes at the hook boundary", async () => {
      const malformed = [
        { paths: "not-an-array", fallback: false },
        { paths: [], fallback: "sometimes" },
        { paths: [null], fallback: false },
        { paths: [{}], fallback: false },
        { paths: [{ params: null }], fallback: false },
        {
          paths: [{ params: { slug: ["docs", 42] } }],
          fallback: false,
        },
      ];

      for (const result of malformed) {
        const fetcher = createFetcher();
        await assertRejects(
          () =>
            fetcher.fetch(
              createPageModule(
                () => result as unknown as StaticPathsResult,
              ),
            ),
          TypeError,
          "valid static paths result object",
        );
      }
    });

    it("should throw when getStaticPaths throws", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => {
        throw new Error("Failed to fetch paths from API");
      });

      await assertRejects(
        () => fetcher.fetch(pageModule),
        Error,
        "Failed to fetch paths from API",
      );
    });

    it("turns an export accessor failure into a rejected fetch promise", async () => {
      const failure = new Error("failed to read getStaticPaths export");
      const pageModule = {
        default: null,
        get getStaticPaths(): PageWithData["getStaticPaths"] {
          throw failure;
        },
      };

      const observed = await createFetcher().fetch(pageModule).then(
        () => undefined,
        (error: unknown) => error,
      );

      assertStrictEquals(observed, failure);
    });

    it("rejects a pre-aborted caller without admitting or invoking project code", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 1,
        maxConcurrentPerProject: 1,
      });
      const fetcher = createFetcher({ executionAdmission: admission });
      const controller = new AbortController();
      const reason = new DOMException("already gone", "AbortError");
      let calls = 0;
      controller.abort(reason);

      const observed = await fetcher.fetch(
        createPageModule(() => {
          calls++;
          return { paths: [], fallback: false };
        }),
        {
          projectId: "pre-aborted-project",
          signal: controller.signal,
        },
      ).then(
        () => undefined,
        (error: unknown) => error,
      );

      assertStrictEquals(observed, reason);
      assertEquals(calls, 0);
      assertEquals(admission.snapshot("pre-aborted-project"), {
        active: 0,
        activeForProject: 0,
      });
    });

    it("preserves an exact null caller-abort reason without dependency classification", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 1,
        maxConcurrentPerProject: 1,
      });
      const fetcher = createFetcher({ executionAdmission: admission });
      const gate = createDeferred<StaticPathsResult>();
      const controller = new AbortController();
      const pending = fetcher.fetch(
        createPageModule(() => gate.promise),
        {
          projectId: "null-abort-project",
          signal: controller.signal,
        },
      );
      const observed = pending.then(
        () => "resolved",
        (error: unknown) => error,
      );

      try {
        await flushMicrotasks();
        controller.abort(null);
        assertStrictEquals(await observed, null);
        assertEquals(admission.snapshot("null-abort-project"), {
          active: 1,
          activeForProject: 1,
        });
      } finally {
        gate.resolve({ paths: [], fallback: false });
        await flushMicrotasks();
      }
      assertEquals(admission.snapshot("null-abort-project"), {
        active: 0,
        activeForProject: 0,
      });
    });

    it("should time out a getStaticPaths call that does not settle in time", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 1,
        maxConcurrentPerProject: 1,
      });
      const fetcher = createFetcher({
        timeoutMs: 5,
        executionAdmission: admission,
      });
      const gate = createDeferred<StaticPathsResult>();
      const pageModule = createPageModule(() => gate.promise);

      try {
        await assertRejects(
          () => fetcher.fetch(pageModule),
          TimeoutError,
          "timed out after 5ms",
        );
      } finally {
        gate.resolve({ paths: [], fallback: false });
        await flushMicrotasks();
      }
    });

    it("uses explicit, ambient, and safe default project admission identities", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 2,
        maxConcurrentPerProject: 2,
      });
      const fetcher = createFetcher({ executionAdmission: admission });

      for (
        const identity of [
          { expected: "explicit-project", options: { projectId: "explicit-project" } },
          { expected: "default", options: undefined },
        ]
      ) {
        const gate = createDeferred<StaticPathsResult>();
        const pending = fetcher.fetch(
          createPageModule(() => gate.promise),
          identity.options,
        );
        await flushMicrotasks();
        assertEquals(admission.snapshot(identity.expected), {
          active: 1,
          activeForProject: 1,
        });
        gate.resolve({ paths: [], fallback: false });
        await pending;
      }

      const ambientProject = "ambient-project";
      const ambientGate = createDeferred<StaticPathsResult>();
      const ambientPending = runWithCacheKeyContext(
        {
          projectId: ambientProject,
          mode: "production",
          versionId: "release-1",
        },
        () =>
          fetcher.fetch(
            createPageModule(() => ambientGate.promise),
          ),
      );
      await flushMicrotasks();
      assertEquals(admission.snapshot(ambientProject), {
        active: 1,
        activeForProject: 1,
      });
      ambientGate.resolve({ paths: [], fallback: false });
      await ambientPending;
      assertEquals(admission.snapshot(ambientProject), {
        active: 0,
        activeForProject: 0,
      });
    });

    it("contains an exhausted project while an available peer project progresses", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 2,
        maxConcurrentPerProject: 1,
      });
      const fetcher = createFetcher({ executionAdmission: admission });
      const gateA = createDeferred<StaticPathsResult>();
      const gateB = createDeferred<StaticPathsResult>();
      let callsA = 0;
      let callsB = 0;
      const pageA = createPageModule(() => {
        callsA++;
        return gateA.promise;
      });
      const pageB = createPageModule(() => {
        callsB++;
        return gateB.promise;
      });

      try {
        const pendingA = fetcher.fetch(pageA, { projectId: "project-a" });
        await flushMicrotasks();
        assertEquals(callsA, 1);

        await assertOverloaded(
          () => fetcher.fetch(pageA, { projectId: "project-a" }),
        );
        assertEquals(callsA, 1);

        const pendingB = fetcher.fetch(pageB, { projectId: "project-b" });
        await flushMicrotasks();
        assertEquals(callsB, 1);
        assertEquals(admission.snapshot("project-a"), {
          active: 2,
          activeForProject: 1,
        });
        assertEquals(admission.snapshot("project-b"), {
          active: 2,
          activeForProject: 1,
        });

        gateA.resolve({ paths: [], fallback: false });
        gateB.resolve({ paths: [], fallback: false });
        await Promise.all([pendingA, pendingB]);
        assertEquals(admission.snapshot("project-a"), {
          active: 0,
          activeForProject: 0,
        });
      } finally {
        gateA.resolve({ paths: [], fallback: false });
        gateB.resolve({ paths: [], fallback: false });
        await flushMicrotasks();
      }
    });

    it("retains timed-out capacity until the raw hook settles without validating a late result", async () => {
      const time = new FakeTime();
      const admission = new DataExecutionAdmission({
        maxConcurrent: 1,
        maxConcurrentPerProject: 1,
      });
      const fetcher = createFetcher({
        timeoutMs: 5,
        executionAdmission: admission,
      });
      const gate = createDeferred<StaticPathsResult>();
      let validationReads = 0;
      const pending = fetcher.fetch(
        createPageModule(() => gate.promise),
        { projectId: "timed-out-project" },
      );

      try {
        await time.tickAsync(5);
        await assertRejects(
          () => pending,
          TimeoutError,
          "timed out after 5ms",
        );
        assertEquals(admission.snapshot("timed-out-project"), {
          active: 1,
          activeForProject: 1,
        });
        await assertOverloaded(() =>
          fetcher.fetch(
            createPageModule(() => ({ paths: [], fallback: false })),
            { projectId: "peer-project" },
          )
        );

        const validationResult = { paths: [], fallback: false } satisfies StaticPathsResult;
        gate.resolve(
          new Proxy(validationResult, {
            getOwnPropertyDescriptor(target, key) {
              if (key === "paths") {
                validationReads++;
              }
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
          }),
        );
        await time.tickAsync(0);
        await flushMicrotasks();
        assertEquals(validationReads, 0);
        assertEquals(admission.snapshot("timed-out-project"), {
          active: 0,
          activeForProject: 0,
        });

        assertEquals(
          await fetcher.fetch(
            createPageModule(() => ({ paths: [], fallback: false })),
            { projectId: "peer-project" },
          ),
          { paths: [], fallback: false },
        );
      } finally {
        gate.resolve({ paths: [], fallback: false });
        await time.tickAsync(0);
        time.restore();
      }
    });

    it("detaches an aborted caller while retaining raw execution capacity", async () => {
      const time = new FakeTime();
      const admission = new DataExecutionAdmission({
        maxConcurrent: 1,
        maxConcurrentPerProject: 1,
      });
      const fetcher = createFetcher({
        timeoutMs: 50,
        executionAdmission: admission,
      });
      const gate = createDeferred<StaticPathsResult>();
      const controller = new AbortController();
      const reason = new DOMException("caller left", "AbortError");
      const pending = fetcher.fetch(
        createPageModule(() => gate.promise),
        {
          projectId: "aborted-project",
          signal: controller.signal,
        },
      );
      const observed = pending.then(
        () => undefined,
        (error: unknown) => error,
      );

      try {
        await time.tickAsync(0);
        controller.abort(reason);
        await time.tickAsync(0);
        assertStrictEquals(await observed, reason);
        assertEquals(admission.snapshot("aborted-project"), {
          active: 1,
          activeForProject: 1,
        });

        await time.tickAsync(50);
        assertEquals(admission.snapshot("aborted-project"), {
          active: 1,
          activeForProject: 1,
        });
        await assertOverloaded(() =>
          fetcher.fetch(
            createPageModule(() => ({ paths: [], fallback: false })),
            { projectId: "peer-project" },
          )
        );

        gate.resolve({ paths: [], fallback: false });
        await time.tickAsync(0);
        assertEquals(admission.snapshot("aborted-project"), {
          active: 0,
          activeForProject: 0,
        });
      } finally {
        gate.resolve({ paths: [], fallback: false });
        await time.tickAsync(0);
        time.restore();
      }
    });

    it("releases execution capacity after validation rejects", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 1,
        maxConcurrentPerProject: 1,
      });
      const fetcher = createFetcher({ executionAdmission: admission });

      await assertRejects(
        () =>
          fetcher.fetch(
            createPageModule(
              () =>
                ({
                  paths: "invalid",
                  fallback: false,
                }) as unknown as StaticPathsResult,
            ),
            { projectId: "invalid-project" },
          ),
        TypeError,
        "valid static paths result object",
      );
      assertEquals(admission.snapshot("invalid-project"), {
        active: 0,
        activeForProject: 0,
      });
    });

    it("should replace an error thrown after the deadline with TimeoutError", async () => {
      const fetcher = createFetcher({ timeoutMs: 1 });
      const pageModule = createPageModule(() => {
        const startedAt = performance.now();
        while (performance.now() - startedAt < 10) {
          // Deliberately block the event loop past the timer deadline.
        }
        throw new Error("late-original");
      });

      await assertRejects(
        () => fetcher.fetch(pageModule),
        TimeoutError,
        "timed out after 1ms",
      );
    });

    it("should not impose the data-hook timeout unless explicitly configured", async () => {
      const time = new FakeTime();
      try {
        const fetcher = createFetcher();
        const pageModule = createPageModule(
          () =>
            new Promise<StaticPathsResult>((resolve) => {
              setTimeout(
                () => resolve({ paths: [], fallback: false }),
                DATA_FETCH_TIMEOUT_MS + 1,
              );
            }),
        );

        const pending = fetcher.fetch(pageModule);
        await time.tickAsync(DATA_FETCH_TIMEOUT_MS + 1);

        assertEquals(await pending, { paths: [], fallback: false });
      } finally {
        time.restore();
      }
    });

    it("should handle multiple params per path", async () => {
      const fetcher = createFetcher();
      const pageModule = createPageModule(() => ({
        paths: [
          { params: { category: "tech", slug: "post-1" } },
          { params: { category: "news", slug: "post-2" } },
        ],
        fallback: false,
      }));

      const result = await fetcher.fetch(pageModule);

      assertExists(result);
      assertEquals(result.paths[0]?.params.category, "tech");
      assertEquals(result.paths[0]?.params.slug, "post-1");
    });

    it("returns one hundred thousand paths as an isolated validated snapshot", async () => {
      const fetcher = createFetcher();
      const paths = Array.from({ length: 100_000 }, (_, index) => ({
        params: { id: String(index) },
      }));
      const expected: StaticPathsResult = {
        paths,
        fallback: "blocking",
      };
      const pageModule = createPageModule(() => expected);

      const result = await fetcher.fetch(pageModule);

      assertNotStrictEquals(result, expected);
      assertNotStrictEquals(result?.paths, paths);
      assertEquals(result?.paths.length, 100_000);
      assertEquals(result?.paths[99_999]?.params.id, "99999");
    });

    it("rejects an over-limit paths array before enumerating or materializing entries", async () => {
      let childTraps = 0;
      const guardedPath = new Proxy({ params: { id: "1" } }, {
        getPrototypeOf(target) {
          childTraps++;
          return Reflect.getPrototypeOf(target);
        },
      });
      const paths = [guardedPath, guardedPath, guardedPath];

      await assertRejects(
        () =>
          createFetcher().fetch(
            createPageModule(() => ({ paths, fallback: false })),
            { maxPaths: 2 },
          ),
        RangeError,
        "at most 2 paths",
      );
      assertEquals(childTraps, 0);
    });

    it("rejects an over-limit catch-all array before enumerating or copying segments", async () => {
      let childTraps = 0;
      const guardedSegment = new Proxy({}, {
        getPrototypeOf(target) {
          childTraps++;
          return Reflect.getPrototypeOf(target);
        },
      });
      const parts = [guardedSegment, guardedSegment, guardedSegment] as unknown as string[];

      await assertRejects(
        () =>
          createFetcher().fetch(
            createPageModule(() => ({
              paths: [{ params: { parts } }],
              fallback: false,
            })),
            { maxArrayParamSegments: 2 },
          ),
        RangeError,
        "at most 2 segments",
      );
      assertEquals(childTraps, 0);
    });

    it("rejects invalid admission limits before invoking project code", async () => {
      for (
        const options of [
          { maxPaths: -1 },
          { maxPaths: 1.5 },
          { maxArrayParamSegments: -1 },
          { maxArrayParamSegments: Number.POSITIVE_INFINITY },
        ]
      ) {
        let calls = 0;
        await assertRejects(
          () =>
            createFetcher().fetch(
              createPageModule(() => {
                calls++;
                return { paths: [], fallback: false };
              }),
              options,
            ),
          RangeError,
          "non-negative safe integer",
        );
        assertEquals(calls, 0);
      }
    });

    it("rejects accessor-backed result fields without invoking them", async () => {
      const paths = [{ params: { slug: ["docs", "intro"] } }];
      let pathsReads = 0;
      let fallbackReads = 0;
      const unstable = {
        get paths(): typeof paths | string {
          pathsReads++;
          return pathsReads === 1 ? paths : "invalid";
        },
        get fallback(): false | string {
          fallbackReads++;
          return fallbackReads === 1 ? false : "invalid";
        },
      };
      const pageModule = createPageModule(
        () => unstable as unknown as StaticPathsResult,
      );

      await assertRejects(
        () => createFetcher().fetch(pageModule),
        TypeError,
        "valid static paths result object",
      );

      assertEquals(pathsReads, 0);
      assertEquals(fallbackReads, 0);
    });

    it("rejects accessor-backed catch-all segments without invoking them", async () => {
      const segments: string[] = [];
      let segmentReads = 0;
      Object.defineProperty(segments, "0", {
        configurable: true,
        enumerable: true,
        get(): string {
          segmentReads++;
          return segmentReads === 1 ? "docs" : "changed";
        },
      });
      segments.length = 1;

      await assertRejects(
        () =>
          createFetcher().fetch(
            createPageModule(() => ({
              paths: [{ params: { slug: segments } }],
              fallback: false,
            })),
          ),
        TypeError,
        "valid static paths result object",
      );

      assertEquals(segmentReads, 0);
    });

    it("rejects sparse catch-all arrays", async () => {
      const sparse = new Array<string>(1);
      await assertRejects(
        () =>
          createFetcher().fetch(
            createPageModule(() => ({
              paths: [{ params: { slug: sparse } }],
              fallback: false,
            })),
          ),
        TypeError,
        "valid static paths result object",
      );
    });

    it("rejects prototype-backed params instead of inheriting route values", async () => {
      const params = Object.create({ slug: "inherited" }) as Record<
        string,
        string | string[]
      >;

      await assertRejects(
        () =>
          createFetcher().fetch(
            createPageModule(() => ({
              paths: [{ params }],
              fallback: false,
            })),
          ),
        TypeError,
        "valid static paths result object",
      );
    });

    it("preserves __proto__ as an own route parameter without changing prototypes", async () => {
      const params: Record<string, string | string[]> = {};
      Object.defineProperty(params, "__proto__", {
        configurable: true,
        enumerable: true,
        value: ["docs", "prototype"],
        writable: true,
      });

      const result = await createFetcher().fetch(
        createPageModule(() => ({
          paths: [{ params }],
          fallback: false,
        })),
      );
      const normalized = result?.paths[0]?.params;

      assertExists(normalized);
      assertEquals(Object.hasOwn(normalized, "__proto__"), true);
      assertEquals(normalized["__proto__"], ["docs", "prototype"]);
      assertStrictEquals(Object.getPrototypeOf(normalized), Object.prototype);
    });

    it("rejects Proxy results without executing reflection traps", async () => {
      let traps = 0;
      const result = new Proxy(
        { paths: [], fallback: false } satisfies StaticPathsResult,
        {
          getPrototypeOf(target) {
            traps++;
            return Reflect.getPrototypeOf(target);
          },
        },
      );

      await assertRejects(
        () => createFetcher().fetch(createPageModule(() => result)),
        TypeError,
        "valid static paths result object",
      );
      assertEquals(traps, 0);
    });

    it("includes large synchronous result validation in the explicit deadline", async () => {
      const result = {
        paths: Array.from({ length: 100_000 }, (_, index) => ({
          params: { id: String(index) },
        })),
        fallback: false,
      } satisfies StaticPathsResult;
      const pageModule = createPageModule(() => result);

      await assertRejects(
        () => createFetcher({ timeoutMs: 1 }).fetch(pageModule),
        TimeoutError,
        "timed out after 1ms",
      );
    });
  });
});
