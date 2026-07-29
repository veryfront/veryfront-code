import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { CacheManager } from "./data-fetching-cache.ts";
import {
  StaticDataFetcher,
  type StaticDataFetcherOptions,
  type StaticDataFetchOptions,
} from "./static-data-fetcher.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { notFound, redirect } from "./helpers.ts";
import {
  _resetShimForTests,
  type AttributeValue,
  setGlobalTracerProvider,
  type Span,
  type Tracer,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { CircuitBreakerOpen } from "#veryfront/utils/circuit-breaker.ts";
import { FakeTime } from "#std/testing/time";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError } from "#veryfront/rendering/utils/stream-utils.ts";
import { REVALIDATION_TIMEOUT_MS } from "#veryfront/utils/constants/cache.ts";
import { DataExecutionAdmission } from "./execution-admission.ts";
import { Semaphore } from "#veryfront/utils/semaphore.ts";
import { VeryfrontError } from "#veryfront/errors";

function withProductionContext<T>(fn: () => T): T {
  return runWithCacheKeyContext(
    { projectId: "test-project", mode: "production", versionId: "rel_123" },
    fn,
  );
}

function createContext(overrides: Partial<DataContext> = {}): DataContext {
  return {
    params: {},
    query: new URLSearchParams(),
    request: new Request("http://localhost/test"),
    url: new URL("http://localhost/test"),
    ...overrides,
  };
}

const TEST_MODULE_PATH = "/project/pages/static-data-test.tsx";

class TestStaticDataFetcher extends StaticDataFetcher {
  override fetch(
    pageModule: PageWithData,
    context: DataContext,
    options: StaticDataFetchOptions = {},
  ): Promise<DataResult> {
    return super.fetch(pageModule, context, {
      modulePath: TEST_MODULE_PATH,
      ...options,
    });
  }
}

function createFetcher(
  options: StaticDataFetcherOptions = {},
): { cache: CacheManager; fetcher: StaticDataFetcher } {
  const cache = new CacheManager();
  const fetcher = new TestStaticDataFetcher(cache, options);
  return { cache, fetcher };
}

interface RecordedSpan {
  name: string;
  attributes: Record<string, AttributeValue>;
}

function createRecordingSpan(record: RecordedSpan): Span {
  return {
    setAttribute(key, value) {
      record.attributes[key] = value;
      return this;
    },
    setAttributes(attributes) {
      Object.assign(record.attributes, attributes);
      return this;
    },
    setStatus() {
      return this;
    },
    recordException() {},
    addEvent() {
      return this;
    },
    end() {},
    spanContext() {
      return {
        traceId: "0".repeat(32),
        spanId: "0".repeat(16),
        traceFlags: 0,
      };
    },
    updateName() {},
  };
}

function installRecordingTracer(records: RecordedSpan[]): void {
  const tracer = {
    startSpan(name: string, options?: { attributes?: Record<string, AttributeValue> }) {
      const record = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
      };
      records.push(record);
      return createRecordingSpan(record);
    },
  } as unknown as Tracer;
  setGlobalTracerProvider({ getTracer: () => tracer });
}

describe("StaticDataFetcher", () => {
  afterEach(() => {
    _resetShimForTests();
    __resetLogRecordEmitterForTests();
  });

  describe("constructor", () => {
    it("should create instance with cache manager", () => {
      const { fetcher } = createFetcher();
      assertExists(fetcher);
    });

    it("should create instance with cache manager only", () => {
      const cache = new CacheManager();
      const fetcher = new StaticDataFetcher(cache);
      assertExists(fetcher);
    });
  });

  describe("fetch", () => {
    it("should return empty props when getStaticData is not defined", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData = { default: () => null };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.props, {});
    });

    it("rejects an invalid runtime project identity before hook dispatch", async () => {
      const { fetcher } = createFetcher();
      let calls = 0;

      await assertRejects(
        () =>
          fetcher.fetch(
            {
              default: () => null,
              getStaticData: () => {
                calls++;
                return { props: {} };
              },
            },
            createContext(),
            { projectId: 1 as unknown as string },
          ),
        TypeError,
        "must be a non-empty string",
      );
      assertEquals(calls, 0);
    });

    it("should call getStaticData with params and url", async () => {
      const { fetcher } = createFetcher();
      let receivedParams: Record<string, string | string[]> | undefined;
      let receivedUrl: URL | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: (ctx) => {
          receivedParams = ctx.params;
          receivedUrl = ctx.url;
          return { props: {} };
        },
      };

      const context = createContext({
        params: { id: "123" },
        url: new URL("http://localhost/posts/123"),
      });

      await fetcher.fetch(pageModule, context);

      assertExists(receivedParams);
      assertEquals(receivedParams.id, "123");
      assertExists(receivedUrl);
      assertEquals(receivedUrl.pathname, "/posts/123");
    });

    it("should NOT pass request or query to getStaticData", async () => {
      const { fetcher } = createFetcher();
      let receivedContext:
        | { params?: unknown; url?: unknown; request?: unknown; query?: unknown }
        | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: (ctx) => {
          receivedContext = ctx;
          return { props: {} };
        },
      };

      await fetcher.fetch(pageModule, createContext());

      assertExists(receivedContext);
      assertEquals(receivedContext.request, undefined);
      assertEquals(receivedContext.query, undefined);
    });

    it("should return props from getStaticData", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData<{ title: string }> = {
        default: () => null,
        getStaticData: () => ({ props: { title: "Static Title" } }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals((result.props as { title: string }).title, "Static Title");
    });

    it("should cache result after fetch in production mode", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        let callCount = 0;

        const pageModule: PageWithData<{ count: number }> = {
          default: () => null,
          getStaticData: () => {
            callCount++;
            return { props: { count: callCount } };
          },
        };

        const context = createContext({ url: new URL("http://localhost/cached-page") });

        const result1 = await fetcher.fetch(pageModule, context);
        assertEquals((result1.props as { count: number }).count, 1);

        const result2 = await fetcher.fetch(pageModule, context);
        assertEquals((result2.props as { count: number }).count, 1);
        assertEquals(callCount, 1);
      });
    });

    it("should coalesce concurrent cold-cache loads for the same key", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        let callCount = 0;
        let releaseLoad!: () => void;
        const loadGate = new Promise<void>((resolve) => {
          releaseLoad = resolve;
        });

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: async () => {
            callCount++;
            await loadGate;
            return { props: { version: callCount }, revalidate: 60 };
          },
        };
        const context = createContext({ url: new URL("http://localhost/cold-page") });

        const pending = [
          fetcher.fetch(pageModule, context),
          fetcher.fetch(pageModule, context),
          fetcher.fetch(pageModule, context),
        ];

        for (let i = 0; i < 20 && callCount === 0; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        assertEquals(callCount, 1);

        releaseLoad();
        const results = await Promise.all(pending);

        assertEquals(callCount, 1);
        assertEquals(
          results.map((result) => (result.props as { version: number }).version),
          [1, 1, 1],
        );
      });
    });

    it("keeps a timed-out cold-load marker until raw project code settles", async () => {
      const time = new FakeTime();
      const admission = new DataExecutionAdmission({
        maxConcurrent: 2,
        maxConcurrentPerProject: 2,
      });
      const { fetcher } = createFetcher({ executionAdmission: admission });
      const scope = {
        projectId: `static-singleflight-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const context = createContext({
        url: new URL("https://example.test/timed-out-singleflight"),
      });
      let calls = 0;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let resolveRaw!: (result: DataResult) => void;
      const raw = new Promise<DataResult>((resolve) => {
        resolveRaw = resolve;
      });
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => {
          calls++;
          if (calls === 1) {
            markStarted();
            return raw;
          }
          return { props: { version: calls }, revalidate: 60 };
        },
      };
      const options = {
        projectId: scope.projectId,
        cacheScope: scope,
      };
      const first = fetcher.fetch(pageModule, context, options);

      try {
        await started;
        await time.tickAsync(DATA_FETCH_TIMEOUT_MS);
        await assertRejects(
          () => first,
          TimeoutError,
          `timed out after ${DATA_FETCH_TIMEOUT_MS}ms`,
        );
        assertEquals(admission.snapshot(scope.projectId), {
          active: 1,
          activeForProject: 1,
        });

        for (let retry = 0; retry < 3; retry++) {
          await assertRejects(
            () => fetcher.fetch(pageModule, context, options),
            TimeoutError,
            `timed out after ${DATA_FETCH_TIMEOUT_MS}ms`,
          );
          await time.tickAsync(DATA_FETCH_TIMEOUT_MS);
        }
        assertEquals(calls, 1);
        assertEquals(admission.snapshot(scope.projectId), {
          active: 1,
          activeForProject: 1,
        });

        resolveRaw({ props: { late: true }, revalidate: 60 });
        await time.tickAsync(0);
        assertEquals(admission.snapshot(scope.projectId), {
          active: 0,
          activeForProject: 0,
        });

        const fresh = await fetcher.fetch(pageModule, context, options);
        assertEquals(fresh.props, { version: 2 });
        assertEquals(calls, 2);
      } finally {
        resolveRaw({ props: { late: true }, revalidate: 60 });
        await time.tickAsync(0);
        time.restore();
      }
    });

    it("does not trust request headers as admission identity", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 2,
        maxConcurrentPerProject: 1,
      });
      const { fetcher } = createFetcher({ executionAdmission: admission });
      let calls = 0;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let resolveRaw!: (result: DataResult) => void;
      const raw = new Promise<DataResult>((resolve) => {
        resolveRaw = resolve;
      });
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => {
          calls++;
          markStarted();
          return raw;
        },
      };
      const contextForHeader = (projectId: string) =>
        createContext({
          request: new Request("https://example.test/header-identity", {
            headers: { "x-project-id": projectId },
          }),
          url: new URL("https://example.test/header-identity"),
        });
      const first = fetcher.fetch(
        pageModule,
        contextForHeader("rotated-a"),
        { cacheScope: null },
      );

      try {
        await started;
        const error = await assertRejects(() =>
          fetcher.fetch(
            pageModule,
            contextForHeader("rotated-b"),
            { cacheScope: null },
          )
        );
        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.slug, "service-overloaded");
        assertEquals(calls, 1);
        assertEquals(admission.snapshot("default"), {
          active: 1,
          activeForProject: 1,
        });

        resolveRaw({ props: { ok: true } });
        assertEquals((await first).props, { ok: true });
        assertEquals(admission.snapshot("default"), {
          active: 0,
          activeForProject: 0,
        });
      } finally {
        resolveRaw({ props: { ok: true } });
        await Promise.allSettled([first]);
      }
    });

    it("should create unique cache keys per path in production mode", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        let callCount = 0;

        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: (ctx) => {
            callCount++;
            return { props: { path: ctx.url.pathname } };
          },
        };

        const context1 = createContext({
          params: { id: "1" },
          url: new URL("http://localhost/posts/1"),
        });
        const context2 = createContext({
          params: { id: "2" },
          url: new URL("http://localhost/posts/2"),
        });

        await fetcher.fetch(pageModule, context1);
        await fetcher.fetch(pageModule, context2);

        assertEquals(callCount, 2);
      });
    });

    it("should isolate cached static data by the full URL origin", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        let callCount = 0;
        const pageModule: PageWithData<{ origin: string }> = {
          default: () => null,
          getStaticData: ({ url }) => {
            callCount++;
            return { props: { origin: url.origin } };
          },
        };

        const alpha = await fetcher.fetch(
          pageModule,
          createContext({ url: new URL("https://alpha.example.test/page") }),
        );
        const beta = await fetcher.fetch(
          pageModule,
          createContext({ url: new URL("https://beta.example.test/page") }),
        );

        assertEquals(callCount, 2);
        assertEquals(alpha.props, { origin: "https://alpha.example.test" });
        assertEquals(beta.props, { origin: "https://beta.example.test" });
      });
    });

    it("should handle redirect result", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => ({ redirect: { destination: "/moved", permanent: true } }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.redirect?.destination, "/moved");
      assertEquals(result.redirect?.permanent, true);
    });

    it("preserves an empty redirect destination through the static cache", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        let calls = 0;
        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: () => {
            calls++;
            return { redirect: { destination: "", permanent: false } };
          },
        };

        const first = await fetcher.fetch(pageModule, createContext());
        const second = await fetcher.fetch(pageModule, createContext());

        assertEquals(first.redirect?.destination, "");
        assertEquals(second.redirect?.destination, "");
        assertEquals(calls, 1);
      });
    });

    it("retains non-serializable props by reference in the in-memory cache", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        const marker = Symbol("marker");
        const props: Record<string, unknown> & { self?: unknown } = {
          date: new Date("2026-01-02T03:04:05.000Z"),
          map: new Map([["answer", 42]]),
          big: 9_007_199_254_740_993n,
          marker,
        };
        props.self = props;
        let calls = 0;
        const pageModule: PageWithData<typeof props> = {
          default: () => null,
          getStaticData: () => {
            calls++;
            return { props };
          },
        };

        const first = await fetcher.fetch(pageModule, createContext());
        const second = await fetcher.fetch(pageModule, createContext());

        assertStrictEquals(first.props, props);
        assertStrictEquals(second.props, props);
        assertStrictEquals((second.props as typeof props).self, props);
        assertStrictEquals((second.props as typeof props).marker, marker);
        assertEquals(calls, 1);
      });
    });

    it("derives breaker isolation from an explicit cache scope", async () => {
      const { fetcher } = createFetcher();
      const projectA = {
        projectId: `scope-a-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const projectB = {
        projectId: `scope-b-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const failing: PageWithData = {
        default: () => null,
        getStaticData: () => {
          throw new Error("project A dependency failure");
        },
      };

      for (let index = 0; index < 5; index++) {
        await assertRejects(() =>
          fetcher.fetch(
            failing,
            createContext({
              url: new URL(`https://shared.test/failure-${index}`),
            }),
            { cacheScope: projectA },
          )
        );
      }

      const healthy = await fetcher.fetch(
        {
          default: () => null,
          getStaticData: () => ({ props: { project: "b" } }),
        },
        createContext({
          url: new URL("https://shared.test/healthy"),
        }),
        { cacheScope: projectB },
      );
      assertEquals(healthy.props, { project: "b" });
    });

    it("rejects conflicting direct project and cache-scope identities", async () => {
      const { fetcher } = createFetcher();
      await assertRejects(
        () =>
          fetcher.fetch(
            {
              default: () => null,
              getStaticData: () => ({ props: {} }),
            },
            createContext(),
            {
              projectId: "project-a",
              cacheScope: {
                projectId: "project-b",
                mode: "production",
                versionId: "rel-1",
              },
            },
          ),
        TypeError,
        "must match",
      );
    });

    it("snapshots mutable cache identity before deferred static execution", async () => {
      const { fetcher } = createFetcher();
      const scope = {
        projectId: `snapshot-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      let calls = 0;
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: ({ params, url }) => {
          calls++;
          return {
            props: {
              id: params.id,
              segments: params.segments,
              pathname: url.pathname,
            },
          };
        },
      };
      const segments = ["one", "two"];
      const context = createContext({
        params: { id: "original", segments },
        url: new URL("https://example.test/original"),
      });

      const pending = fetcher.fetch(pageModule, context, {
        cacheScope: scope,
      });
      context.params.id = "mutated";
      segments.push("mutated");
      context.url.pathname = "/mutated";

      const first = await pending;
      const cached = await fetcher.fetch(
        pageModule,
        createContext({
          params: { id: "original", segments: ["one", "two"] },
          url: new URL("https://example.test/original"),
        }),
        { cacheScope: scope },
      );

      assertEquals(first.props, {
        id: "original",
        segments: ["one", "two"],
        pathname: "/original",
      });
      assertEquals(cached.props, first.props);
      assertEquals(calls, 1);
    });

    it("counts conflicting outcomes as dependency failures and never caches them", async () => {
      const { fetcher } = createFetcher();
      const scope = {
        projectId: `invalid-result-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      let calls = 0;
      const invalid = {
        default: () => null,
        getStaticData: () => {
          calls++;
          return {
            props: { unsafe: true },
            redirect: { destination: "/other" },
          };
        },
      } as unknown as PageWithData;
      const context = createContext({
        url: new URL("https://example.test/invalid-result"),
      });

      for (let attempt = 0; attempt < 5; attempt++) {
        await assertRejects(
          () => fetcher.fetch(invalid, context, { cacheScope: scope }),
          TypeError,
          "valid data result object",
        );
      }
      await assertRejects(
        () => fetcher.fetch(invalid, context, { cacheScope: scope }),
        CircuitBreakerOpen,
      );
      assertEquals(calls, 5);
    });

    it("shares the project circuit breaker when caching is explicitly disabled", async () => {
      const { fetcher } = createFetcher();
      const projectId = `no-cache-breaker-${crypto.randomUUID()}`;
      let calls = 0;
      const failing: PageWithData = {
        default: () => null,
        getStaticData: () => {
          calls++;
          throw new Error("uncached dependency failure");
        },
      };
      const context = createContext({
        url: new URL("https://example.test/no-cache-breaker"),
      });

      for (let attempt = 0; attempt < 5; attempt++) {
        await assertRejects(
          () => fetcher.fetch(failing, context, { projectId, cacheScope: null }),
          Error,
          "uncached dependency failure",
        );
      }
      await assertRejects(
        () => fetcher.fetch(failing, context, { projectId, cacheScope: null }),
        CircuitBreakerOpen,
      );
      assertEquals(calls, 5);
    });

    it("isolates uncached breaker state by source while sharing it across source routes", async () => {
      const { fetcher } = createFetcher();
      const projectId = `uncached-source-breaker-${crypto.randomUUID()}`;
      let failingCalls = 0;
      const failing: PageWithData = {
        default: () => null,
        getStaticData: () => {
          failingCalls++;
          throw new Error("preview source A dependency failure");
        },
      };
      const sourceA = {
        projectId,
        cacheScope: null,
        workerScopeId: `preview-source-a-scope-${crypto.randomUUID()}`,
        workerGenerationId: "shared-release-label",
      } satisfies StaticDataFetchOptions;

      for (let attempt = 0; attempt < 5; attempt++) {
        await assertRejects(
          () =>
            fetcher.fetch(
              failing,
              createContext({
                url: new URL(`https://example.test/source-a/${attempt}`),
              }),
              sourceA,
            ),
          Error,
          "preview source A dependency failure",
        );
      }
      await assertRejects(
        () =>
          fetcher.fetch(
            failing,
            createContext({
              url: new URL("https://example.test/source-a/another-route"),
            }),
            sourceA,
          ),
        CircuitBreakerOpen,
      );

      const healthy = await fetcher.fetch(
        {
          default: () => null,
          getStaticData: () => ({ props: { source: "b" } }),
        },
        createContext({
          url: new URL("https://example.test/source-b/healthy"),
        }),
        {
          projectId,
          cacheScope: null,
          workerScopeId: `preview-source-b-scope-${crypto.randomUUID()}`,
          workerGenerationId: "shared-release-label",
        },
      );

      assertEquals(healthy.props, { source: "b" });
      assertEquals(failingCalls, 5);
    });

    it("isolates ambient cache and breaker identity on a shared hostname", async () => {
      const { fetcher } = createFetcher();
      const projectA = {
        projectId: `ambient-a-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const projectB = {
        projectId: `ambient-b-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const failing: PageWithData = {
        default: () => null,
        getStaticData: () => {
          throw new Error("ambient project A failure");
        },
      };

      for (let attempt = 0; attempt < 5; attempt++) {
        await assertRejects(() =>
          runWithCacheKeyContext(projectA, () =>
            fetcher.fetch(
              failing,
              createContext({
                url: new URL(`https://shared.example.test/failure-${attempt}`),
              }),
            ))
        );
      }

      const healthy = await runWithCacheKeyContext(projectB, () =>
        fetcher.fetch(
          {
            default: () => null,
            getStaticData: () => ({ props: { project: "b" } }),
          },
          createContext({
            url: new URL("https://shared.example.test/healthy"),
          }),
        ));
      assertEquals(healthy.props, { project: "b" });
    });

    it("retains execution admission through cache publication", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 1,
        maxConcurrentPerProject: 1,
      });
      const { fetcher } = createFetcher({ executionAdmission: admission });
      const projectId = `publication-admission-${crypto.randomUUID()}`;
      const publicationSnapshots: Array<{
        active: number;
        activeForProject: number;
      }> = [];
      const props = new Proxy(
        { value: 1 },
        {
          ownKeys(target) {
            publicationSnapshots.push(admission.snapshot(projectId));
            return Reflect.ownKeys(target);
          },
        },
      );

      const result = await fetcher.fetch(
        {
          default: () => null,
          getStaticData: () => ({ props }),
        },
        createContext({
          url: new URL("https://example.test/publication-admission"),
        }),
        {
          projectId,
          cacheScope: {
            projectId,
            mode: "production",
            versionId: "rel-1",
          },
        },
      );

      assertStrictEquals(result.props, props);
      assertEquals(publicationSnapshots.length > 0, true);
      assertEquals(
        publicationSnapshots.every((snapshot) =>
          snapshot.active === 1 && snapshot.activeForProject === 1
        ),
        true,
      );
      assertEquals(admission.snapshot(projectId), {
        active: 0,
        activeForProject: 0,
      });
    });

    it("returns valid data when cache publication exceeds estimator complexity", async () => {
      const { fetcher } = createFetcher();
      const scope = {
        projectId: `complex-cache-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const items = Array.from({ length: 100_001 }, (_, index) => index);
      let calls = 0;
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => {
          calls++;
          return { props: { items } };
        },
      };
      const context = createContext({
        url: new URL("https://example.test/complex-cache-value"),
      });

      const first = await fetcher.fetch(pageModule, context, {
        cacheScope: scope,
      });
      const second = await fetcher.fetch(pageModule, context, {
        cacheScope: scope,
      });

      assertStrictEquals(
        (first.props as { items: number[] }).items,
        items,
      );
      assertStrictEquals(
        (second.props as { items: number[] }).items,
        items,
      );
      assertEquals(calls, 2);
    });

    it("should handle notFound result", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => ({ notFound: true }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.notFound, true);
    });

    it("should throw when getStaticData throws", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => {
          throw new Error("CMS API failed");
        },
      };

      await assertRejects(
        () => fetcher.fetch(pageModule, createContext()),
        Error,
        "CMS API failed",
      );
    });

    it("should not expose raw cache identity in spans or structured logs", async () => {
      const spans: RecordedSpan[] = [];
      const logs: LogEntry[] = [];
      installRecordingTracer(spans);
      __registerLogRecordEmitter((entry) => logs.push(entry));
      const { fetcher } = createFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => {
          throw new Error("intentional loader failure");
        },
      };
      const querySecret = "alice-private@example.test";
      const paramSecret = "customer-private-42";
      const projectSecret = `/private/${"project-secret-".repeat(24)}\ninternal`;
      const context = createContext({
        params: { customer: paramSecret },
        request: new Request(
          `http://localhost/private-data?email=${encodeURIComponent(querySecret)}`,
        ),
        url: new URL(
          `http://localhost/private-data?email=${encodeURIComponent(querySecret)}`,
        ),
      });

      await assertRejects(
        () =>
          runWithCacheKeyContext(
            {
              projectId: projectSecret,
              mode: "production",
              versionId: "rel_123",
            },
            () => fetcher.fetch(pageModule, context, { projectId: projectSecret }),
          ),
        Error,
        "intentional loader failure",
      );

      const telemetry = JSON.stringify({ spans, logs });
      assertEquals(telemetry.includes(querySecret), false);
      assertEquals(telemetry.includes(encodeURIComponent(querySecret)), false);
      assertEquals(telemetry.includes(paramSecret), false);
      assertEquals(telemetry.includes(projectSecret), false);
    });

    it("should support synchronous getStaticData", async () => {
      const { fetcher } = createFetcher();
      const pageModule: PageWithData<{ sync: boolean }> = {
        default: () => null,
        getStaticData: () => ({ props: { sync: true } }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals((result.props as { sync: boolean }).sync, true);
    });

    it("should cache with revalidate time in production mode", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher();
        const pageModule: PageWithData = {
          default: () => null,
          getStaticData: () => ({ props: { data: "cached" }, revalidate: 60 }),
        };

        const context = createContext({ url: new URL("http://localhost/isr-page") });

        await fetcher.fetch(pageModule, context);

        const cacheKey = cache.createCacheKey(context, TEST_MODULE_PATH);
        assertExists(cacheKey);

        const entry = cache.get(cacheKey);
        assertExists(entry);
        assertEquals(entry.revalidate, 60);
      });
    });

    it("should use a bounded opaque breaker identity for long project IDs", async () => {
      const projectId = `/projects/${"y".repeat(512)}\ninternal`;
      await runWithCacheKeyContext(
        { projectId, mode: "production", versionId: "rel_123" },
        async () => {
          const { fetcher } = createFetcher();
          const pageModule: PageWithData = {
            default: () => null,
            getStaticData: () => ({ props: { ok: true } }),
          };

          const result = await fetcher.fetch(
            pageModule,
            createContext({ url: new URL("http://localhost/long-project") }),
            { projectId },
          );

          assertEquals(result.props, { ok: true });
        },
      );
    });

    it("should not cache in preview mode", async () => {
      await runWithCacheKeyContext(
        { projectId: "test", mode: "preview", versionId: "main" },
        async () => {
          const { fetcher } = createFetcher();
          let callCount = 0;

          const pageModule: PageWithData<{ count: number }> = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { count: callCount } };
            },
          };

          const context = createContext({ url: new URL("http://localhost/preview-page") });

          const result1 = await fetcher.fetch(pageModule, context);
          assertEquals((result1.props as { count: number }).count, 1);

          const result2 = await fetcher.fetch(pageModule, context);
          assertEquals((result2.props as { count: number }).count, 2);
          assertEquals(callCount, 2);
        },
      );
    });

    it("should return cached data when fresh in production mode", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        let callCount = 0;

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => {
            callCount++;
            return { props: { version: callCount }, revalidate: 3600 };
          },
        };

        const context = createContext({ url: new URL("http://localhost/fresh-page") });

        const result1 = await fetcher.fetch(pageModule, context);
        assertEquals((result1.props as { version: number }).version, 1);

        const result2 = await fetcher.fetch(pageModule, context);
        assertEquals((result2.props as { version: number }).version, 1);
        assertEquals(callCount, 1);
      });
    });

    it("should trigger only one background revalidation for the same stale cache entry", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher();
        let callCount = 0;
        let resolveRevalidation!: (
          result: { props: { version: number }; revalidate: number },
        ) => void;

        const revalidationResult = new Promise<{ props: { version: number }; revalidate: number }>(
          (resolve) => {
            resolveRevalidation = resolve;
          },
        );

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => {
            callCount++;
            return revalidationResult;
          },
        };

        const context = createContext({ url: new URL("http://localhost/stale-page") });
        const cacheKey = cache.createCacheKey(context, TEST_MODULE_PATH);
        assertExists(cacheKey);

        cache.set(cacheKey, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });

        const firstResult = await fetcher.fetch(pageModule, context);
        const secondResult = await fetcher.fetch(pageModule, context);

        assertEquals((firstResult.props as { version: number }).version, 1);
        assertEquals((secondResult.props as { version: number }).version, 1);
        assertEquals(callCount, 1);

        resolveRevalidation({ props: { version: 2 }, revalidate: 60 });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const refreshedEntry = cache.get(cacheKey);
        assertExists(refreshedEntry);
        assertEquals((refreshedEntry.data.props as { version: number }).version, 2);
      });
    });
  });

  describe("background revalidation", () => {
    async function settleRevalidation(): Promise<void> {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }

    it("shares one project circuit breaker across stale routes", async () => {
      const { cache, fetcher } = createFetcher({
        revalidationFailureRetryMs: 0,
      });
      const scope = {
        projectId: `revalidation-breaker-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      let calls = 0;
      const failing: PageWithData<{ version: number }> = {
        default: () => null,
        getStaticData: () => {
          calls++;
          throw new Error("revalidation dependency failure");
        },
      };
      const contexts = Array.from(
        { length: 6 },
        (_, index) =>
          createContext({
            url: new URL(`https://example.test/revalidation-breaker-${index}`),
          }),
      );
      for (const context of contexts) {
        const key = cache.createCacheKey(context, TEST_MODULE_PATH, scope);
        assertExists(key);
        cache.set(key, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });
      }

      for (const context of contexts) {
        const served = await fetcher.fetch(failing, context, {
          projectId: scope.projectId,
          cacheScope: scope,
        });
        assertEquals(served.props, { version: 1 });
        await settleRevalidation();
      }

      assertEquals(calls, 5);
    });

    it("keeps a timed-out revalidation marker until raw project code settles", async () => {
      const time = new FakeTime();
      const admission = new DataExecutionAdmission({
        maxConcurrent: 2,
        maxConcurrentPerProject: 2,
      });
      const { cache, fetcher } = createFetcher({
        executionAdmission: admission,
        revalidationFailureRetryMs: 0,
      });
      const scope = {
        projectId: `static-revalidation-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const context = createContext({
        url: new URL("https://example.test/timed-out-revalidation"),
      });
      const cacheKey = cache.createCacheKey(
        context,
        TEST_MODULE_PATH,
        scope,
      );
      assertExists(cacheKey);
      cache.set(cacheKey, {
        data: { props: { version: 1 }, revalidate: 0 },
        timestamp: Date.now() - 10_000,
        revalidate: 0,
      });

      let calls = 0;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let resolveRaw!: (result: DataResult) => void;
      const raw = new Promise<DataResult>((resolve) => {
        resolveRaw = resolve;
      });
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => {
          calls++;
          if (calls === 1) {
            markStarted();
            return raw;
          }
          return { props: { version: calls }, revalidate: 60 };
        },
      };
      const options = {
        projectId: scope.projectId,
        cacheScope: scope,
      };

      try {
        const first = await fetcher.fetch(pageModule, context, options);
        assertEquals(first.props, { version: 1 });
        await started;
        await time.tickAsync(REVALIDATION_TIMEOUT_MS);

        for (let retry = 0; retry < 3; retry++) {
          const stale = await fetcher.fetch(pageModule, context, options);
          assertEquals(stale.props, { version: 1 });
          await time.tickAsync(REVALIDATION_TIMEOUT_MS);
        }
        assertEquals(calls, 1);
        assertEquals(admission.snapshot(scope.projectId), {
          active: 1,
          activeForProject: 1,
        });

        resolveRaw({ props: { version: 99 }, revalidate: 60 });
        await time.tickAsync(0);
        assertEquals(admission.snapshot(scope.projectId), {
          active: 0,
          activeForProject: 0,
        });

        const stale = await fetcher.fetch(pageModule, context, options);
        assertEquals(stale.props, { version: 1 });
        await time.tickAsync(0);
        assertEquals(calls, 2);

        const refreshed = cache.get(cacheKey);
        assertExists(refreshed);
        assertEquals(refreshed.data.props, { version: 2 });
      } finally {
        resolveRaw({ props: { version: 99 }, revalidate: 60 });
        await time.tickAsync(0);
        time.restore();
      }
    });

    it("holds the global revalidation permit until timed-out project code settles", async () => {
      const time = new FakeTime();
      const admission = new DataExecutionAdmission({
        maxConcurrent: 2,
        maxConcurrentPerProject: 1,
      });
      const semaphore = new Semaphore(1, {
        acquireTimeoutMs: 5_000,
        maxQueueSize: 1,
        name: `static-revalidation-test-${crypto.randomUUID()}`,
      });
      const { cache, fetcher } = createFetcher({
        executionAdmission: admission,
        revalidationFailureRetryMs: 0,
        revalidationSemaphore: semaphore,
      });
      const scopeA = {
        projectId: `static-revalidation-a-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const scopeB = {
        projectId: `static-revalidation-b-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const contextA = createContext({
        url: new URL("https://example.test/revalidation-a"),
      });
      const contextB = createContext({
        url: new URL("https://example.test/revalidation-b"),
      });
      for (
        const [scope, context] of [
          [scopeA, contextA],
          [scopeB, contextB],
        ] as const
      ) {
        const key = cache.createCacheKey(context, TEST_MODULE_PATH, scope);
        assertExists(key);
        cache.set(key, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });
      }

      let releaseA!: () => void;
      const gateA = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let releaseB!: () => void;
      const gateB = new Promise<void>((resolve) => {
        releaseB = resolve;
      });
      let markAStarted!: () => void;
      const startedA = new Promise<void>((resolve) => {
        markAStarted = resolve;
      });
      let markBStarted!: () => void;
      const startedB = new Promise<void>((resolve) => {
        markBStarted = resolve;
      });
      let calls = 0;
      let active = 0;
      let maxActive = 0;
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: async ({ url }) => {
          calls++;
          active++;
          maxActive = Math.max(maxActive, active);
          try {
            if (url.pathname === "/revalidation-a") {
              markAStarted();
              await gateA;
            } else {
              markBStarted();
              await gateB;
            }
            return { props: { version: 2 }, revalidate: 60 };
          } finally {
            active--;
          }
        },
      };

      try {
        await fetcher.fetch(pageModule, contextA, {
          projectId: scopeA.projectId,
          cacheScope: scopeA,
        });
        await startedA;
        await time.tickAsync(REVALIDATION_TIMEOUT_MS);
        assertEquals(active, 1);
        assertEquals(semaphore.active, 1);

        await fetcher.fetch(pageModule, contextB, {
          projectId: scopeB.projectId,
          cacheScope: scopeB,
        });
        await time.tickAsync(0);
        assertEquals(calls, 1);
        assertEquals(active, 1);
        assertEquals(maxActive, 1);
        assertEquals(admission.snapshot(scopeA.projectId), {
          active: 1,
          activeForProject: 1,
        });
        assertEquals(admission.snapshot(scopeB.projectId), {
          active: 1,
          activeForProject: 0,
        });

        releaseA();
        await startedB;
        assertEquals(calls, 2);
        assertEquals(active, 1);
        assertEquals(maxActive, 1);

        releaseB();
        await time.tickAsync(0);
        assertEquals(active, 0);
        assertEquals(semaphore.active, 0);
        assertEquals(admission.snapshot(scopeA.projectId), {
          active: 0,
          activeForProject: 0,
        });
        assertEquals(admission.snapshot(scopeB.projectId), {
          active: 0,
          activeForProject: 0,
        });
      } finally {
        releaseA();
        releaseB();
        await time.tickAsync(0);
        time.restore();
      }
    });

    it("rejects a negative revalidate interval without caching it", async () => {
      await withProductionContext(async () => {
        const { fetcher } = createFetcher();
        let calls = 0;
        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => ({
            props: { version: ++calls },
            revalidate: -100,
          }),
        };
        const context = createContext({
          url: new URL("https://example.test/negative-revalidate"),
        });

        await assertRejects(
          () => fetcher.fetch(pageModule, context),
          TypeError,
          "getStaticData must return a valid data result object",
        );
        await assertRejects(
          () => fetcher.fetch(pageModule, context),
          TypeError,
          "getStaticData must return a valid data result object",
        );
        assertEquals(calls, 2);
      });
    });

    it("should retry a cache key skipped by the per-project limit", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher({
          revalidationPerProjectLimit: 1,
        });
        let releaseHeldRevalidation!: (
          result: { props: { version: number }; revalidate: number },
        ) => void;
        const heldRevalidation = new Promise<
          { props: { version: number }; revalidate: number }
        >((resolve) => {
          releaseHeldRevalidation = resolve;
        });
        let heldCalls = 0;
        let skippedCalls = 0;

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: (context) => {
            if (context.url.pathname === "/held-revalidation") {
              heldCalls++;
              return heldRevalidation;
            }
            skippedCalls++;
            return { props: { version: 2 }, revalidate: 60 };
          },
        };
        const requestHeaders = { "x-project-id": "revalidation-limit-race" };
        const heldContext = createContext({
          request: new Request("http://localhost/held-revalidation", {
            headers: requestHeaders,
          }),
          url: new URL("http://localhost/held-revalidation"),
        });
        const skippedContext = createContext({
          request: new Request("http://localhost/skipped-revalidation", {
            headers: requestHeaders,
          }),
          url: new URL("http://localhost/skipped-revalidation"),
        });
        const heldKey = cache.createCacheKey(heldContext, TEST_MODULE_PATH);
        const skippedKey = cache.createCacheKey(skippedContext, TEST_MODULE_PATH);
        assertExists(heldKey);
        assertExists(skippedKey);

        for (const key of [heldKey, skippedKey]) {
          cache.set(key, {
            data: { props: { version: 1 }, revalidate: 0 },
            timestamp: Date.now() - 10_000,
            revalidate: 0,
          });
        }

        await fetcher.fetch(pageModule, heldContext);
        for (let i = 0; i < 20 && heldCalls === 0; i++) await Promise.resolve();
        assertEquals(heldCalls, 1);

        let callsWhileLimited: number;
        try {
          await fetcher.fetch(pageModule, skippedContext);
          await Promise.resolve();
          callsWhileLimited = skippedCalls;
        } finally {
          releaseHeldRevalidation({ props: { version: 2 }, revalidate: 60 });
          await settleRevalidation();
        }

        assertEquals(callsWhileLimited, 0);

        await fetcher.fetch(pageModule, skippedContext);
        await settleRevalidation();

        assertEquals(skippedCalls, 1);
        const refreshed = cache.get(skippedKey);
        assertExists(refreshed);
        assertEquals((refreshed.data.props as { version: number }).version, 2);
      });
    });

    it("should keep unlimited and limited fetcher slot accounting balanced", async () => {
      const projectId = `mixed-revalidation-limits-${crypto.randomUUID()}`;
      await runWithCacheKeyContext(
        { projectId, mode: "production", versionId: "rel_123" },
        async () => {
          const limited = createFetcher({ revalidationPerProjectLimit: 1 });
          const unlimited = createFetcher({ revalidationPerProjectLimit: 0 });

          let releaseHeld!: (
            result: { props: { version: number }; revalidate: number },
          ) => void;
          const heldResult = new Promise<
            { props: { version: number }; revalidate: number }
          >((resolve) => {
            releaseHeld = resolve;
          });
          let heldCalls = 0;
          let probeCalls = 0;
          let unlimitedCalls = 0;

          const limitedPage: PageWithData<{ version: number }> = {
            default: () => null,
            getStaticData: (context) => {
              if (context.url.pathname === "/mixed-held") {
                heldCalls++;
                return heldResult;
              }
              probeCalls++;
              return { props: { version: 2 }, revalidate: 60 };
            },
          };
          const unlimitedPage: PageWithData<{ version: number }> = {
            default: () => null,
            getStaticData: () => {
              unlimitedCalls++;
              return { props: { version: 2 }, revalidate: 60 };
            },
          };
          const heldContext = createContext({
            url: new URL("http://localhost/mixed-held"),
          });
          const probeContext = createContext({
            url: new URL("http://localhost/mixed-probe"),
          });
          const unlimitedContext = createContext({
            url: new URL("http://localhost/mixed-unlimited"),
          });

          for (
            const [cache, context] of [
              [limited.cache, heldContext],
              [limited.cache, probeContext],
              [unlimited.cache, unlimitedContext],
            ] as const
          ) {
            const key = cache.createCacheKey(context, TEST_MODULE_PATH);
            assertExists(key);
            cache.set(key, {
              data: { props: { version: 1 }, revalidate: 0 },
              timestamp: Date.now() - 10_000,
              revalidate: 0,
            });
          }

          await limited.fetcher.fetch(limitedPage, heldContext, { projectId });
          for (let i = 0; i < 20 && heldCalls === 0; i++) await Promise.resolve();
          assertEquals(heldCalls, 1);

          try {
            await unlimited.fetcher.fetch(unlimitedPage, unlimitedContext, {
              projectId,
            });
            await settleRevalidation();
            assertEquals(unlimitedCalls, 1);

            await limited.fetcher.fetch(limitedPage, probeContext, { projectId });
            await Promise.resolve();
            assertEquals(probeCalls, 0);
          } finally {
            releaseHeld({ props: { version: 2 }, revalidate: 60 });
            await settleRevalidation();
          }

          await limited.fetcher.fetch(limitedPage, probeContext, { projectId });
          await settleRevalidation();
          assertEquals(probeCalls, 1);
        },
      );
    });

    // A background revalidation must never replace a live page with a control
    // result. The entry would be stored with `revalidate: undefined`, which
    // never qualifies for revalidation again, so every request served a 404
    // until the entry aged out of the cache.
    it("keeps the cached page when a revalidation throws notFound()", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher();

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => {
            throw notFound();
          },
        };

        const context = createContext({ url: new URL("http://localhost/isr-not-found") });
        const cacheKey = cache.createCacheKey(context, TEST_MODULE_PATH);
        assertExists(cacheKey);

        cache.set(cacheKey, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });

        const served = await fetcher.fetch(pageModule, context);
        assertEquals((served.props as { version: number }).version, 1);

        await settleRevalidation();

        const entry = cache.get(cacheKey);
        assertExists(entry);
        assertEquals((entry.data.props as { version: number }).version, 1);
        assertEquals(entry.data.notFound, undefined);
        // Still a number, so the entry stays eligible for the next revalidation.
        assertEquals(entry.revalidate, 0);

        const next = await fetcher.fetch(pageModule, context);
        assertEquals((next.props as { version: number }).version, 1);
        assertEquals(next.notFound, undefined);
      });
    });

    it("keeps the cached page when a revalidation throws redirect()", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher();

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => {
            throw redirect("/login");
          },
        };

        const context = createContext({ url: new URL("http://localhost/isr-redirect") });
        const cacheKey = cache.createCacheKey(context, TEST_MODULE_PATH);
        assertExists(cacheKey);

        cache.set(cacheKey, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });

        await fetcher.fetch(pageModule, context);
        await settleRevalidation();

        const entry = cache.get(cacheKey);
        assertExists(entry);
        assertEquals((entry.data.props as { version: number }).version, 1);
        assertEquals(entry.data.redirect, undefined);
        assertEquals(entry.revalidate, 0);
      });
    });

    it("backs off after a failed revalidation instead of retrying on every request", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher();
        let revalidationCalls = 0;
        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => {
            revalidationCalls++;
            throw new Error("CMS unavailable");
          },
        };
        const context = createContext({ url: new URL("http://localhost/isr-backoff") });
        const cacheKey = cache.createCacheKey(context, TEST_MODULE_PATH);
        assertExists(cacheKey);
        cache.set(cacheKey, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });

        const first = await fetcher.fetch(pageModule, context);
        await settleRevalidation();
        const second = await fetcher.fetch(pageModule, context);
        await settleRevalidation();

        assertEquals((first.props as { version: number }).version, 1);
        assertEquals((second.props as { version: number }).version, 1);
        assertEquals(revalidationCalls, 1);
      });
    });

    it("still replaces the cached page on a successful revalidation", async () => {
      await withProductionContext(async () => {
        const admission = new DataExecutionAdmission({
          maxConcurrent: 1,
          maxConcurrentPerProject: 1,
        });
        const { cache, fetcher } = createFetcher({
          executionAdmission: admission,
        });
        const publicationSnapshots: Array<{
          active: number;
          activeForProject: number;
        }> = [];
        const refreshedProps = new Proxy(
          { version: 2 },
          {
            ownKeys(target) {
              publicationSnapshots.push(admission.snapshot("test-project"));
              return Reflect.ownKeys(target);
            },
          },
        );

        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => ({ props: refreshedProps, revalidate: 60 }),
        };

        const context = createContext({ url: new URL("http://localhost/isr-success") });
        const cacheKey = cache.createCacheKey(context, TEST_MODULE_PATH);
        assertExists(cacheKey);

        cache.set(cacheKey, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });

        await fetcher.fetch(pageModule, context);
        await settleRevalidation();

        const entry = cache.get(cacheKey);
        assertExists(entry);
        assertEquals((entry.data.props as { version: number }).version, 2);
        assertEquals(entry.revalidate, 60);
        assertEquals(publicationSnapshots.length > 0, true);
        assertEquals(
          publicationSnapshots.every((snapshot) =>
            snapshot.active === 1 && snapshot.activeForProject === 1
          ),
          true,
        );
        assertEquals(admission.snapshot("test-project"), {
          active: 0,
          activeForProject: 0,
        });
      });
    });

    it("should not let an evicted revalidation overwrite a newer cold load", async () => {
      await withProductionContext(async () => {
        const { cache, fetcher } = createFetcher();
        let calls = 0;
        let releaseOld!: (
          result: { props: { version: number }; revalidate: number },
        ) => void;
        const oldRevalidation = new Promise<
          { props: { version: number }; revalidate: number }
        >((resolve) => {
          releaseOld = resolve;
        });
        const pageModule: PageWithData<{ version: number }> = {
          default: () => null,
          getStaticData: () => {
            calls++;
            if (calls === 1) return oldRevalidation;
            return { props: { version: 3 }, revalidate: 60 };
          },
        };
        const context = createContext({
          url: new URL("http://localhost/isr-eviction-generation"),
        });
        const key = cache.createCacheKey(context, TEST_MODULE_PATH);
        assertExists(key);
        cache.set(key, {
          data: { props: { version: 1 }, revalidate: 0 },
          timestamp: Date.now() - 10_000,
          revalidate: 0,
        });

        const served = await fetcher.fetch(pageModule, context);
        assertEquals((served.props as { version: number }).version, 1);
        for (let i = 0; i < 20 && calls === 0; i++) await Promise.resolve();
        assertEquals(calls, 1);

        cache.delete(key);
        const fresh = await fetcher.fetch(pageModule, context);
        assertEquals((fresh.props as { version: number }).version, 3);

        releaseOld({ props: { version: 2 }, revalidate: 60 });
        await settleRevalidation();

        const current = cache.get(key);
        assertExists(current);
        assertEquals((current.data.props as { version: number }).version, 3);
        assertEquals(calls, 2);
      });
    });
  });

  describe("thrown control results", () => {
    function throwing(error: unknown): PageWithData {
      return {
        default: () => null,
        getStaticData: () => {
          throw error;
        },
      };
    }

    it("treats a thrown notFound() as a 404 result without a cache context", async () => {
      const { fetcher } = createFetcher();
      const result = await fetcher.fetch(throwing(notFound()), createContext());

      assertEquals(result.notFound, true);
    });

    // Regression: only the no-cache path handled this, so `throw notFound()`
    // still returned a 500 in production, where a cache key always exists.
    it("treats a thrown notFound() as a 404 result with a production cache context", async () => {
      const { fetcher } = createFetcher();

      const result = await withProductionContext(() =>
        fetcher.fetch(throwing(notFound()), createContext())
      );

      assertEquals(result.notFound, true);
    });

    it("treats a thrown redirect() as a redirect without a cache context", async () => {
      const { fetcher } = createFetcher();

      const result = await fetcher.fetch(throwing(redirect("/login")), createContext());

      assertEquals(result.redirect?.destination, "/login");
      assertEquals(result.redirect?.permanent, false);
    });

    it("treats a thrown redirect() as a redirect with a production cache context", async () => {
      const { fetcher } = createFetcher();

      const result = await withProductionContext(() =>
        fetcher.fetch(throwing(redirect("/login", true)), createContext())
      );

      assertEquals(result.redirect?.destination, "/login");
      assertEquals(result.redirect?.permanent, true);
    });

    it("still propagates a genuine Error", async () => {
      const { fetcher } = createFetcher();

      await assertRejects(
        () =>
          withProductionContext(() =>
            fetcher.fetch(
              throwing(new Error("intentional test error from getStaticData")),
              createContext(),
            )
          ),
        Error,
        "intentional test error from getStaticData",
      );
    });

    // The cached path runs inside a circuit breaker, so a 404 that counted as a
    // failure would take the whole project's static data down after five.
    it("does not open the circuit breaker on repeated 404s", async () => {
      const { fetcher } = createFetcher();

      for (let i = 0; i < 6; i++) {
        // A distinct path each time, so every call is a cache miss and runs
        // the handler rather than replaying a cached 404.
        const context = createContext({
          url: new URL(`http://localhost/missing-${i}`),
          request: new Request(`http://localhost/missing-${i}`, {
            headers: { "x-project-id": "static-repeated-not-found" },
          }),
        });

        const result = await withProductionContext(() =>
          fetcher.fetch(throwing(notFound()), context)
        );

        assertEquals(result.notFound, true, `call ${i + 1} should still reach getStaticData`);
      }
    });
  });
});
