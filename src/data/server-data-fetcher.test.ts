import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ServerDataFetcher, type ServerDataFetchOptions } from "./server-data-fetcher.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { notFound, redirect } from "./helpers.ts";
import { __resetPoolForTests, getWorkerPool } from "#veryfront/security/sandbox/worker-pool.ts";
import {
  MAX_WORKER_BODY_BYTES,
  type WorkerResponse,
} from "#veryfront/security/sandbox/worker-types.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { join } from "node:path";
import { FakeTime } from "#std/testing/time";
import { DATA_FETCH_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { TimeoutError } from "#veryfront/utils/timeout.ts";
import { CircuitBreakerOpen } from "#veryfront/utils/circuit-breaker.ts";
import { SERVICE_OVERLOADED, VeryfrontError } from "#veryfront/errors";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { DataExecutionAdmission } from "./execution-admission.ts";

function runWithTestSourcePolicy<T>(fn: () => T): T {
  return runWithExactSourceIntegrationPolicy(
    { schemaVersion: 1, mode: "unrestricted" },
    fn,
  );
}

describe("ServerDataFetcher", () => {
  function createContext(overrides: Partial<DataContext> = {}): DataContext {
    return {
      params: {},
      query: new URLSearchParams(),
      request: new Request("http://localhost/test"),
      url: new URL("http://localhost/test"),
      ...overrides,
    };
  }

  describe("constructor", () => {
    it("should create instance without adapter", () => {
      assertExists(new ServerDataFetcher());
    });

    it("should create instance without arguments", () => {
      assertExists(new ServerDataFetcher());
    });
  });

  describe("fetch", () => {
    it("should return empty props when getServerData is not defined", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = { default: () => null };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.props, {});
      assertEquals(result.redirect, undefined);
      assertEquals(result.notFound, undefined);
    });

    it("should call getServerData with context", async () => {
      const fetcher = new ServerDataFetcher();
      let receivedContext: DataContext | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: (ctx) => {
          receivedContext = ctx;
          return { props: {} };
        },
      };

      const context = createContext({ params: { id: "123" } });
      await fetcher.fetch(pageModule, context);

      assertExists(receivedContext);
      assertEquals(receivedContext.params.id, "123");
    });

    it("should return props from getServerData", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData<{ title: string; count: number }> = {
        default: () => null,
        getServerData: () => ({ props: { title: "Hello", count: 42 } }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.props, { title: "Hello", count: 42 });
    });

    it("should handle redirect result", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          redirect: { destination: "/login", permanent: false },
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.redirect?.destination, "/login");
      assertEquals(result.redirect?.permanent, false);
      assertEquals(result.props, undefined);
    });

    it("should handle permanent redirect", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          redirect: { destination: "/new-url", permanent: true },
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.redirect?.permanent, true);
    });

    it("should handle notFound result", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ notFound: true }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.notFound, true);
      assertEquals(result.props, undefined);
      assertEquals(result.redirect, undefined);
    });

    it("should preserve revalidate option", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          props: { data: "test" },
          revalidate: 60,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.revalidate, 60);
    });

    it("counts conflicting outcomes as failures before breaker success", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `server-invalid-${crypto.randomUUID()}`;
      let calls = 0;
      const invalid = {
        default: () => null,
        getServerData: () => {
          calls++;
          return {
            notFound: true,
            redirect: { destination: "/other" },
          };
        },
      } as unknown as PageWithData;

      for (let attempt = 0; attempt < 5; attempt++) {
        await assertRejects(
          () =>
            fetcher.fetch(invalid, createContext(), {
              projectId,
            }),
          TypeError,
          "valid data result object",
        );
      }
      await assertRejects(
        () =>
          fetcher.fetch(invalid, createContext(), {
            projectId,
          }),
        CircuitBreakerOpen,
      );
      assertEquals(calls, 5);
    });

    it("isolates breaker state by immutable source while sharing it across source routes", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `server-source-breaker-${crypto.randomUUID()}`;
      const workerScopeId = `server-source-scope-${crypto.randomUUID()}`;
      let failingCalls = 0;
      const failing: PageWithData = {
        default: () => null,
        getServerData: () => {
          failingCalls++;
          throw new Error("source A dependency failure");
        },
      };
      const sourceA = {
        projectId,
        cacheScope: {
          projectId,
          mode: "preview" as const,
          versionId: "shared-cache-scope",
        },
        workerScopeId,
        workerGenerationId: "shared-release-label",
      };

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
          "source A dependency failure",
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
          getServerData: () => ({ props: { source: "b" } }),
        },
        createContext({
          url: new URL("https://example.test/source-b/healthy"),
        }),
        {
          projectId,
          cacheScope: {
            projectId,
            mode: "preview",
            versionId: "shared-cache-scope",
          },
          workerScopeId: `server-source-b-scope-${crypto.randomUUID()}`,
          workerGenerationId: "shared-release-label",
        },
      );

      assertEquals(healthy.props, { source: "b" });
      assertEquals(failingCalls, 5);
    });

    it("isolates breaker state by cache scope when no worker source is available", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `server-scope-breaker-${crypto.randomUUID()}`;
      let failingCalls = 0;
      const failing: PageWithData = {
        default: () => null,
        getServerData: () => {
          failingCalls++;
          throw new Error("preview cache scope failed");
        },
      };
      const previewScope = {
        projectId,
        mode: "preview" as const,
        versionId: "branch-a",
      };
      const sourceA = {
        projectId,
        cacheScope: previewScope,
      } satisfies ServerDataFetchOptions;

      for (let attempt = 0; attempt < 5; attempt++) {
        await assertRejects(
          () =>
            fetcher.fetch(
              failing,
              createContext({
                url: new URL(`https://example.test/preview-a/${attempt}`),
              }),
              sourceA,
            ),
          Error,
          "preview cache scope failed",
        );
      }
      await assertRejects(
        () =>
          fetcher.fetch(
            failing,
            createContext({
              url: new URL("https://example.test/preview-a/another-route"),
            }),
            sourceA,
          ),
        CircuitBreakerOpen,
      );

      const healthy = await fetcher.fetch(
        {
          default: () => null,
          getServerData: () => ({ props: { source: "production" } }),
        },
        createContext({
          url: new URL("https://example.test/production/healthy"),
        }),
        {
          projectId,
          cacheScope: {
            projectId,
            mode: "production",
            versionId: "release-b",
          },
        },
      );

      assertEquals(healthy.props, { source: "production" });
      assertEquals(failingCalls, 5);
    });

    it("isolates ambient server breaker identity on a shared hostname", async () => {
      const fetcher = new ServerDataFetcher();
      const projectA = {
        projectId: `server-ambient-a-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const projectB = {
        projectId: `server-ambient-b-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const failing: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw new Error("ambient server A failure");
        },
      };
      const context = createContext({
        request: new Request("https://shared.example.test/page"),
        url: new URL("https://shared.example.test/page"),
      });

      for (let attempt = 0; attempt < 5; attempt++) {
        await assertRejects(() =>
          runWithCacheKeyContext(
            projectA,
            () => fetcher.fetch(failing, context),
          )
        );
      }

      const healthy = await runWithCacheKeyContext(
        projectB,
        () =>
          fetcher.fetch(
            {
              default: () => null,
              getServerData: () => ({ props: { project: "b" } }),
            },
            context,
          ),
      );
      assertEquals(healthy.props, { project: "b" });
    });

    it("does not let rotating request headers evade anonymous admission", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 2,
        maxConcurrentPerProject: 1,
      });
      const fetcher = new ServerDataFetcher(admission);
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let resolveRaw!: (result: DataResult) => void;
      const raw = new Promise<DataResult>((resolve) => {
        resolveRaw = resolve;
      });
      let calls = 0;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          calls++;
          markStarted();
          return raw;
        },
      };
      const first = fetcher.fetch(
        pageModule,
        createContext({
          request: new Request("http://localhost/test", {
            headers: { "x-project-id": "attacker-selected-a" },
          }),
        }),
      );

      try {
        await started;
        assertEquals(admission.snapshot("default"), {
          active: 1,
          activeForProject: 1,
        });

        const rejected = await assertRejects(() =>
          fetcher.fetch(
            pageModule,
            createContext({
              request: new Request("http://localhost/test", {
                headers: { "x-project-id": "attacker-selected-b" },
              }),
            }),
          )
        );
        assertInstanceOf(rejected, VeryfrontError);
        assertEquals(rejected.slug, SERVICE_OVERLOADED.slug);
        assertEquals(calls, 1);
        assertEquals(admission.snapshot("attacker-selected-a").activeForProject, 0);
        assertEquals(admission.snapshot("attacker-selected-b").activeForProject, 0);

        resolveRaw({ props: { ok: true } });
        assertEquals((await first).props, { ok: true });
        assertEquals(admission.snapshot("default"), {
          active: 0,
          activeForProject: 0,
        });
      } finally {
        resolveRaw({ props: { ok: true } });
        await first.catch(() => undefined);
      }
    });

    it("rejects non-string project IDs before admission or breaker hashing", async () => {
      const fetcher = new ServerDataFetcher();
      let failingCalls = 0;
      const failingPage: PageWithData = {
        default: () => null,
        getServerData: () => {
          failingCalls++;
          throw new Error("must not run");
        },
      };

      for (let attempt = 0; attempt < 5; attempt++) {
        await assertRejects(
          () =>
            fetcher.fetch(failingPage, createContext(), {
              projectId: 1 as unknown as string,
            }),
          TypeError,
          "must be a non-empty string",
        );
      }
      assertEquals(failingCalls, 0);

      const healthy = await fetcher.fetch(
        {
          default: () => null,
          getServerData: () => ({ props: { ok: true } }),
        },
        createContext(),
        { projectId: "2" },
      );
      assertEquals(healthy.props, { ok: true });
    });

    it("should handle revalidate: false", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          props: {},
          revalidate: false,
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.revalidate, false);
    });

    it("should default props to empty object if undefined", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({}),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.props, {});
    });

    it("snapshots an accessor-backed server hook exactly once", async () => {
      const fetcher = new ServerDataFetcher();
      let reads = 0;
      const pageModule = {
        default: () => null,
        get getServerData() {
          const generation = ++reads;
          return () => ({ props: { generation } });
        },
      } satisfies PageWithData<{ generation: number }>;

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.props, { generation: 1 });
      assertEquals(reads, 1);
    });

    it("should throw when getServerData throws", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw new Error("Database connection failed");
        },
      };

      await assertRejects(
        () => fetcher.fetch(pageModule, createContext()),
        Error,
        "Database connection failed",
      );
    });

    it("should support synchronous getServerData", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData<{ sync: boolean }> = {
        default: () => null,
        getServerData: () => ({ props: { sync: true } }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.props, { sync: true });
    });

    it("should use a bounded opaque breaker identity for long project IDs", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `/projects/${"x".repeat(512)}\ninternal`;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: { ok: true } }),
      };

      const result = await fetcher.fetch(pageModule, createContext(), {
        projectId,
      });

      assertEquals(result.props, { ok: true });
    });

    it("should record dependency timeouts and open the project circuit", async () => {
      const time = new FakeTime();
      try {
        const fetcher = new ServerDataFetcher();
        const projectId = `server-timeout-${crypto.randomUUID()}`;
        let calls = 0;
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => {
            calls++;
            return new Promise<DataResult>(() => {});
          },
        };

        for (let i = 0; i < 5; i++) {
          const pending = fetcher.fetch(pageModule, createContext(), {
            projectId,
          });
          const rejected = assertRejects(
            () => pending,
            TimeoutError,
            `timed out after ${DATA_FETCH_TIMEOUT_MS}ms`,
          );

          await time.tickAsync(DATA_FETCH_TIMEOUT_MS);
          await rejected;
          assertEquals(calls, i + 1);
        }

        await assertRejects(
          () => fetcher.fetch(pageModule, createContext(), { projectId }),
          CircuitBreakerOpen,
          "Circuit breaker",
        );
        assertEquals(calls, 5);
      } finally {
        time.restore();
      }
    });

    it("should reject a pre-aborted request without invoking the loader", async () => {
      const fetcher = new ServerDataFetcher();
      const controller = new AbortController();
      const reason = new Error("request was already cancelled");
      controller.abort(reason);
      let calls = 0;

      const error = await assertRejects(() =>
        fetcher.fetch(
          {
            default: () => null,
            getServerData: () => {
              calls++;
              return { props: {} };
            },
          },
          createContext({
            request: new Request("http://localhost/test", {
              signal: controller.signal,
            }),
          }),
        )
      );

      assertStrictEquals(error, reason);
      assertEquals(calls, 0);
    });

    it("should stop waiting on abort while observing detached dependency work", async () => {
      const fetcher = new ServerDataFetcher();
      const controller = new AbortController();
      const reason = new Error("client disconnected after dispatch");
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let resolveDependency!: (result: DataResult<{ ok: boolean }>) => void;
      const dependency = new Promise<DataResult<{ ok: boolean }>>((resolve) => {
        resolveDependency = resolve;
      });
      const projectId = `detached-success-${crypto.randomUUID()}`;
      const pageModule: PageWithData<{ ok: boolean }> = {
        default: () => null,
        getServerData: () => {
          markStarted();
          return dependency;
        },
      };
      const pending = fetcher.fetch(
        pageModule,
        createContext({
          request: new Request("http://localhost/test", {
            signal: controller.signal,
          }),
        }),
        { projectId },
      );
      await started;

      controller.abort(reason);
      const error = await assertRejects(() => pending);
      assertStrictEquals(error, reason);

      resolveDependency({ props: { ok: true } });
      for (let flush = 0; flush < 8; flush++) await Promise.resolve();
      const healthy = await fetcher.fetch(
        {
          default: () => null,
          getServerData: () => ({ props: { ok: true } }),
        },
        createContext(),
        { projectId },
      );
      assertEquals(healthy.props, { ok: true });
    });

    it("should keep caller-caused loader cancellation neutral to the circuit", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `neutral-abort-${crypto.randomUUID()}`;

      for (let index = 0; index < 5; index++) {
        const controller = new AbortController();
        const reason = new Error(`caller abort ${index}`);
        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const pending = fetcher.fetch(
          {
            default: () => null,
            getServerData: (context) =>
              new Promise((_resolve, reject) => {
                markStarted();
                context.request?.signal.addEventListener(
                  "abort",
                  () => reject(context.request!.signal.reason),
                  { once: true },
                );
              }),
          },
          createContext({
            request: new Request("http://localhost/test", {
              signal: controller.signal,
            }),
          }),
          { projectId },
        );
        await started;
        controller.abort(reason);
        assertStrictEquals(await assertRejects(() => pending), reason);
        for (let flush = 0; flush < 4; flush++) await Promise.resolve();
      }

      const healthy = await fetcher.fetch(
        {
          default: () => null,
          getServerData: () => ({ props: { healthy: true } }),
        },
        createContext(),
        { projectId },
      );
      assertEquals(healthy.props, { healthy: true });
    });

    it("keeps exact caller cancellation neutral at the deadline boundary", async () => {
      const time = new FakeTime();
      const fetcher = new ServerDataFetcher();
      const projectId = `deadline-abort-${crypto.randomUUID()}`;

      try {
        for (let index = 0; index < 5; index++) {
          const controller = new AbortController();
          const reason = new Error(`boundary caller abort ${index}`);
          const abortTimer = setTimeout(
            () => controller.abort(reason),
            DATA_FETCH_TIMEOUT_MS,
          );
          let markStarted!: () => void;
          const started = new Promise<void>((resolve) => {
            markStarted = resolve;
          });
          const pending = fetcher.fetch(
            {
              default: () => null,
              getServerData: (context) =>
                new Promise((_resolve, reject) => {
                  markStarted();
                  context.request.signal.addEventListener(
                    "abort",
                    () => reject(context.request.signal.reason),
                    { once: true },
                  );
                }),
            },
            createContext({
              request: new Request("http://localhost/test", {
                signal: controller.signal,
              }),
            }),
            { projectId },
          );

          await started;
          await time.tickAsync(DATA_FETCH_TIMEOUT_MS);
          clearTimeout(abortTimer);
          assertStrictEquals(await assertRejects(() => pending), reason);
          for (let flush = 0; flush < 8; flush++) await Promise.resolve();
        }

        const healthy = await fetcher.fetch(
          {
            default: () => null,
            getServerData: () => ({ props: { healthy: true } }),
          },
          createContext(),
          { projectId },
        );
        assertEquals(healthy.props, { healthy: true });
      } finally {
        time.restore();
      }
    });

    it("should count an independent AbortError that coincides with caller abort", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `independent-abort-${crypto.randomUUID()}`;

      for (let index = 0; index < 5; index++) {
        const controller = new AbortController();
        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const pending = fetcher.fetch(
          {
            default: () => null,
            getServerData: (context) =>
              new Promise((_resolve, reject) => {
                markStarted();
                context.request?.signal.addEventListener(
                  "abort",
                  () =>
                    reject(
                      new DOMException(
                        "dependency cancelled itself",
                        "AbortError",
                      ),
                    ),
                  { once: true },
                );
              }),
          },
          createContext({
            request: new Request("http://localhost/test", {
              signal: controller.signal,
            }),
          }),
          { projectId },
        );
        await started;
        controller.abort(new Error(`caller abort ${index}`));
        await assertRejects(() => pending);
        for (let flush = 0; flush < 8; flush++) await Promise.resolve();
      }

      await assertRejects(
        () =>
          fetcher.fetch(
            {
              default: () => null,
              getServerData: () => ({ props: { shouldNotRun: true } }),
            },
            createContext(),
            { projectId },
          ),
        CircuitBreakerOpen,
        "Circuit breaker",
      );
    });

    it("should pass request object in context", async () => {
      const fetcher = new ServerDataFetcher();
      let receivedRequest: Request | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: (ctx) => {
          receivedRequest = ctx.request;
          return { props: {} };
        },
      };

      const request = new Request("http://localhost/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      await fetcher.fetch(pageModule, createContext({ request }));

      assertExists(receivedRequest);
      assertEquals(receivedRequest.method, "POST");
    });

    it("gives concurrent direct hooks independent request bodies and headers", async () => {
      try {
        Deno.env.delete("WORKER_ISOLATION_ENABLED");
        Deno.env.delete("WORKER_ISOLATION_DATA");
      } catch { /* environment permission is available in the focused gate */ }
      await __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const body = "shared request payload";
      const request = new Request("http://localhost/direct-siblings", {
        method: "POST",
        headers: { "x-original": "yes" },
        body,
      });
      let invocation = 0;
      let markFirstMutation!: () => void;
      const firstMutation = new Promise<void>((resolve) => {
        markFirstMutation = resolve;
      });
      let secondObservedHeader: string | null | undefined;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: async ({ request }) => {
          const current = ++invocation;
          if (current === 1) {
            request.headers.set("x-sibling-only", "first");
            markFirstMutation();
          } else {
            await firstMutation;
            secondObservedHeader = request.headers.get("x-sibling-only");
          }
          return {
            props: {
              current,
              body: await request.text(),
            },
          };
        },
      };
      const context = createContext({
        request,
        url: new URL(request.url),
      });

      const [first, second] = await Promise.all([
        fetcher.fetch(pageModule, context),
        fetcher.fetch(pageModule, context),
      ]);

      assertEquals(first.props, { current: 1, body });
      assertEquals(second.props, { current: 2, body });
      assertEquals(secondObservedHeader, null);
      assertEquals(request.headers.get("x-sibling-only"), null);
      assertEquals(await request.text(), body);
    });

    it("exposes the framework deadline on direct request signals and retains admission", async () => {
      const time = new FakeTime();
      const admission = new DataExecutionAdmission({
        maxConcurrent: 1,
        maxConcurrentPerProject: 1,
      });
      const fetcher = new ServerDataFetcher(admission);
      const projectId = `server-timeout-admission-${crypto.randomUUID()}`;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let resolveRaw!: (result: DataResult) => void;
      const raw = new Promise<DataResult>((resolve) => {
        resolveRaw = resolve;
      });
      let hookSignal: AbortSignal | undefined;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: (context) => {
          hookSignal = context.request.signal;
          markStarted();
          return raw;
        },
      };
      const pending = fetcher.fetch(
        pageModule,
        createContext(),
        { projectId },
      );

      try {
        await started;
        assertExists(hookSignal);
        assertEquals(hookSignal.aborted, false);
        await time.tickAsync(DATA_FETCH_TIMEOUT_MS);
        const timeoutError = await assertRejects(
          () => pending,
          TimeoutError,
          `timed out after ${DATA_FETCH_TIMEOUT_MS}ms`,
        );
        assertEquals(hookSignal.aborted, true);
        assertInstanceOf(hookSignal.reason, TimeoutError);
        assertStrictEquals(hookSignal.reason, timeoutError);
        assertEquals(admission.snapshot(projectId), {
          active: 1,
          activeForProject: 1,
        });

        const overload = await assertRejects(() =>
          fetcher.fetch(
            {
              default: () => null,
              getServerData: () => ({ props: { mustNotRun: true } }),
            },
            createContext(),
            { projectId },
          )
        );
        assertEquals(overload instanceof VeryfrontError, true);
        assertEquals((overload as VeryfrontError).slug, "service-overloaded");

        resolveRaw({ props: { late: true } });
        await time.tickAsync(0);
        assertEquals(admission.snapshot(projectId), {
          active: 0,
          activeForProject: 0,
        });
      } finally {
        resolveRaw({ props: { late: true } });
        await time.tickAsync(0);
        time.restore();
      }
    });

    it("should pass query params in context", async () => {
      const fetcher = new ServerDataFetcher();
      let receivedQuery: URLSearchParams | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: (ctx) => {
          receivedQuery = ctx.query;
          return { props: {} };
        },
      };

      const query = new URLSearchParams("?search=test&page=2");
      await fetcher.fetch(pageModule, createContext({ query }));

      assertExists(receivedQuery);
      assertEquals(receivedQuery.get("search"), "test");
      assertEquals(receivedQuery.get("page"), "2");
    });
  });

  describe("fetchIsolated body size guard", () => {
    afterEach(async () => {
      try {
        Deno.env.delete("WORKER_ISOLATION_ENABLED");
      } catch { /* ok */ }
      try {
        Deno.env.delete("WORKER_ISOLATION_DATA");
      } catch { /* ok */ }
      await __resetPoolForTests();
    });

    it("should reject oversized request bodies in isolated data fetch", async () => {
      // Enable data isolation
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      await __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: { data: "test" } }),
      };

      // Create a body larger than 10 MB
      const largeBody = new Uint8Array(11 * 1024 * 1024);
      const request = new Request("http://localhost/test", {
        method: "POST",
        body: largeBody,
      });

      const error = await assertRejects(
        () =>
          runWithTestSourcePolicy(() =>
            fetcher.fetch(
              pageModule,
              createContext({ request }),
              { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
            )
          ),
        Error,
        "too large",
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "input-validation-failed");
      assertEquals(error.status, 400);
      assertInstanceOf(error.cause, VeryfrontError);
    });

    it("should fail closed when isolation is enabled without both worker paths", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      await __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      let calls = 0;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          calls++;
          return { props: {} };
        },
      };
      const invalidOptions = [
        undefined,
        {},
        { modulePath: "/tmp/project/page.ts" },
        { projectDir: "/tmp/project" },
        { modulePath: "", projectDir: "/tmp/project" },
        { modulePath: "/tmp/project/page.ts", projectDir: "" },
      ];

      for (const options of invalidOptions) {
        await assertRejects(
          () => fetcher.fetch(pageModule, createContext(), options),
          Error,
          "requires non-empty modulePath and projectDir",
        );
      }
      assertEquals(calls, 0);
    });

    it("should share one overall deadline between body preparation and worker execution", async () => {
      const time = new FakeTime();
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      await __resetPoolForTests();
      const pool = getWorkerPool();
      const originalExecute = pool.execute;
      let workerCalls = 0;
      let pending: Promise<DataResult> | undefined;
      pool.execute = () => {
        workerCalls++;
        return new Promise<WorkerResponse>(() => {});
      };

      try {
        const request = new Request("http://localhost/test", {
          method: "POST",
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(new Uint8Array([1]));
                controller.close();
              }, 6_000);
            },
          }),
        });
        const fetcher = new ServerDataFetcher();
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({ props: {} }),
        };
        const fetchPromise = runWithTestSourcePolicy(
          () =>
            fetcher.fetch(
              pageModule,
              createContext({ request }),
              {
                modulePath: "/tmp/project/page.ts",
                projectDir: "/tmp/project",
                projectId: `overall-deadline-${crypto.randomUUID()}`,
              },
            ),
        );
        pending = fetchPromise;
        let settled = false;
        void fetchPromise.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );

        await time.tickAsync(6_000);
        for (let flush = 0; workerCalls === 0 && flush < 32; flush++) {
          await time.tickAsync(0);
        }
        assertEquals(workerCalls, 1);
        assertEquals(settled, false);

        await time.tickAsync(DATA_FETCH_TIMEOUT_MS - 6_001);
        assertEquals(settled, false);

        const rejected = assertRejects(
          () => fetchPromise,
          TimeoutError,
          `timed out after ${DATA_FETCH_TIMEOUT_MS}ms`,
        );
        await time.tickAsync(1);
        await rejected;
        assertEquals(settled, true);
      } finally {
        if (pending) {
          await time.tickAsync(DATA_FETCH_TIMEOUT_MS);
          await pending.catch(() => undefined);
        }
        pool.execute = originalExecute;
        await __resetPoolForTests();
        time.restore();
      }
    });

    it("should reject via Content-Length header before buffering", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      await __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };

      // Small body but Content-Length claims 20 MB
      const request = new Request("http://localhost/test", {
        method: "POST",
        body: "small",
        headers: { "content-length": String(20 * 1024 * 1024) },
      });

      await assertRejects(
        () =>
          runWithTestSourcePolicy(() =>
            fetcher.fetch(
              pageModule,
              createContext({ request }),
              { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
            )
          ),
        Error,
        "too large",
      );
    });

    it("should reject a malformed Content-Length instead of parsing its prefix", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      await __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };
      const request = new Request("http://localhost/test", {
        method: "POST",
        body: "small",
        headers: { "content-length": "5 trailing-junk" },
      });

      await assertRejects(
        () =>
          runWithTestSourcePolicy(() =>
            fetcher.fetch(
              pageModule,
              createContext({ request }),
              { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
            )
          ),
        Error,
        "Invalid Content-Length header",
      );
    });

    it("should cancel a streaming body as soon as its actual size exceeds the limit", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      await __resetPoolForTests();

      let cancelled = false;
      const request = new Request("http://localhost/test", {
        method: "POST",
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(MAX_WORKER_BODY_BYTES + 1));
            setTimeout(() => {
              if (!cancelled) controller.close();
            }, 25);
          },
          cancel() {
            cancelled = true;
          },
        }),
      });
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };

      await assertRejects(
        () =>
          runWithTestSourcePolicy(() =>
            fetcher.fetch(
              pageModule,
              createContext({ request }),
              { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
            )
          ),
        Error,
        "too large",
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      assertEquals(cancelled, true);
    });

    it("should keep rejected request bodies out of the project circuit breaker", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      await __resetPoolForTests();

      const projectId = `body-validation-${crypto.randomUUID()}`;
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: { ok: true } }),
      };

      for (let i = 0; i < 5; i++) {
        const oversizedRequest = new Request("http://localhost/test", {
          method: "POST",
          body: "small",
          headers: {
            "content-length": String(MAX_WORKER_BODY_BYTES + 1),
          },
        });

        await assertRejects(
          () =>
            runWithTestSourcePolicy(() =>
              fetcher.fetch(
                pageModule,
                createContext({ request: oversizedRequest }),
                {
                  modulePath: "/tmp/test/page.ts",
                  projectDir: "/tmp/test",
                  projectId,
                },
              )
            ),
          Error,
          "too large",
        );
      }

      const validContext = createContext();
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_DATA");
      await __resetPoolForTests();
      const result = await fetcher.fetch(pageModule, validContext, {
        projectId,
      });

      assertEquals(result.props, { ok: true });
    });

    it("should reject a missing source policy before consuming the request body", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      await __resetPoolForTests();
      const pool = getWorkerPool();
      const originalExecute = pool.execute;
      let workerCalls = 0;
      pool.execute = (..._args) => {
        workerCalls++;
        return Promise.resolve({
          type: "data-result",
          id: "unexpected",
          result: { props: {} },
        });
      };

      const request = new Request("http://localhost/test", {
        method: "POST",
        body: "must-not-be-read",
      });
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };

      try {
        await assertRejects(
          () =>
            fetcher.fetch(
              pageModule,
              createContext({ request }),
              { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
            ),
          Error,
          "requires an exact source integration policy",
        );
        assertEquals(workerCalls, 0);
        assertEquals(await request.text(), "must-not-be-read");
      } finally {
        pool.execute = originalExecute;
      }
    });

    it("should cancel body preparation when the incoming Request aborts", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      await __resetPoolForTests();
      const pool = getWorkerPool();
      const originalExecute = pool.execute;
      let workerCalls = 0;
      let cancelReason: unknown;
      pool.execute = (..._args) => {
        workerCalls++;
        return Promise.resolve({
          type: "data-result",
          id: "unexpected",
          result: { props: {} },
        });
      };

      const controller = new AbortController();
      const reason = new Error("client disconnected");
      const request = new Request("http://localhost/test", {
        method: "POST",
        signal: controller.signal,
        body: new ReadableStream<Uint8Array>({
          cancel(receivedReason) {
            cancelReason = receivedReason;
          },
        }),
      });
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };
      const pending = runWithTestSourcePolicy(() =>
        fetcher.fetch(
          pageModule,
          createContext({ request }),
          { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
        )
      );

      try {
        for (let flush = 0; !request.body?.locked && flush < 32; flush++) {
          await Promise.resolve();
        }
        assertEquals(request.body?.locked, true);

        controller.abort(reason);

        const error = await assertRejects(() => pending);
        assertStrictEquals(error, reason);
        assertStrictEquals(cancelReason, reason);
        assertEquals(workerCalls, 0);
      } finally {
        await pending.catch(() => undefined);
        pool.execute = originalExecute;
      }
    });

    it("should skip body size guard when request has no body", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      await __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: { ok: true } }),
      };

      // GET request with no body
      const request = new Request("http://localhost/test", { method: "GET" });

      // The worker boundary is strict: isolated project code cannot run without
      // the exact source policy established by request middleware.
      await assertRejects(
        () =>
          fetcher.fetch(
            pageModule,
            createContext({ request }),
            { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
          ),
        Error,
        "requires an exact source integration policy",
      );
    });
  });

  describe("thrown control results", () => {
    // `throw notFound()` reads naturally and is what people coming from other
    // frameworks reach for. It used to reach the SSR error handler as a plain
    // object, get stringified to "[object Object]", and return a 500.
    it("treats a thrown notFound() as a 404 result", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw notFound();
        },
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.notFound, true);
      assertEquals(result.redirect, undefined);
    });

    it("treats a thrown redirect() as a redirect result", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw redirect("/login", true);
        },
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.redirect?.destination, "/login");
      assertEquals(result.redirect?.permanent, true);
      assertEquals(result.notFound, undefined);
    });

    it("still propagates a genuine Error", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `thrown-control-results-${crypto.randomUUID()}`;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw new Error("intentional test error from getServerData");
        },
      };

      await assertRejects(
        () => fetcher.fetch(pageModule, createContext(), { projectId }),
        Error,
        "intentional test error from getServerData",
      );
    });

    // Regression: normalising the thrown result in the outer `catch` let the
    // circuit breaker record it as a failure first. Five 404s on one project
    // opened the shared breaker and every data route after that failed fast
    // for 30 seconds, turning a working 404 page into a site-wide outage.
    it("does not open the circuit breaker on repeated 404s", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `repeated-not-found-${crypto.randomUUID()}`;
      const context = createContext();

      const notFoundPage: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw notFound();
        },
      };

      // The breaker's failureThreshold is 5, so the sixth call is the one that
      // used to fail fast.
      for (let i = 0; i < 6; i++) {
        const result = await fetcher.fetch(notFoundPage, context, {
          projectId,
        });
        assertEquals(result.notFound, true, `call ${i + 1} should still reach getServerData`);
      }

      // An unrelated route on the same project still works.
      const okPage: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: { ok: true } }),
      };

      const result = await fetcher.fetch(okPage, context, { projectId });
      assertEquals(result.props, { ok: true });
    });

    it("does not open the circuit breaker on repeated redirects", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `repeated-redirect-${crypto.randomUUID()}`;
      const context = createContext();

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw redirect("/login");
        },
      };

      for (let i = 0; i < 6; i++) {
        const result = await fetcher.fetch(pageModule, context, {
          projectId,
        });
        assertEquals(result.redirect?.destination, "/login", `call ${i + 1} should still redirect`);
      }
    });

    it("keeps marked prefetch failures out of the foreground circuit breaker", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `prefetch-breaker-isolation-${crypto.randomUUID()}`;
      const prefetchContext = createContext({
        request: new Request("http://localhost/test", {
          headers: {
            "x-veryfront-prefetch": "1",
          },
        }),
      });
      const foregroundContext = createContext();

      const failingPage: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw new Error("intentional prefetch failure");
        },
      };

      for (let i = 0; i < 5; i++) {
        await assertRejects(() => fetcher.fetch(failingPage, prefetchContext, { projectId }));
      }

      const okPage: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: { ok: true } }),
      };

      const result = await fetcher.fetch(okPage, foregroundContext, {
        projectId,
      });
      assertEquals(result.props, { ok: true });
    });

    it("prefers the trusted project option over a spoofable request header", async () => {
      const fetcher = new ServerDataFetcher();
      const headerProjectId = `spoofed-${crypto.randomUUID()}`;
      const failingProjectId = `trusted-failing-${crypto.randomUUID()}`;
      const healthyProjectId = `trusted-healthy-${crypto.randomUUID()}`;
      const context = createContext({
        request: new Request("http://localhost/test", {
          headers: { "x-project-id": headerProjectId },
        }),
      });
      const failingPage: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw new Error("intentional trusted-project failure");
        },
      };

      for (let i = 0; i < 5; i++) {
        await assertRejects(
          () => fetcher.fetch(failingPage, context, { projectId: failingProjectId }),
          Error,
          "intentional trusted-project failure",
        );
      }

      await assertRejects(
        () => fetcher.fetch(failingPage, context, { projectId: failingProjectId }),
        Error,
        "Circuit breaker",
      );

      const healthyPage: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: { ok: true } }),
      };
      const result = await fetcher.fetch(healthyPage, context, {
        projectId: healthyProjectId,
      });

      assertEquals(result.props, { ok: true });
    });

    it("counts a direct project hook's service-overloaded error as a dependency failure", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `direct-project-overload-${crypto.randomUUID()}`;
      let calls = 0;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          calls++;
          throw SERVICE_OVERLOADED.create({
            detail: "Project dependency reported overload",
          });
        },
      };

      for (let attempt = 0; attempt < 5; attempt++) {
        const error = await assertRejects(() =>
          fetcher.fetch(pageModule, createContext(), { projectId })
        );
        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.slug, SERVICE_OVERLOADED.slug);
      }

      await assertRejects(
        () => fetcher.fetch(pageModule, createContext(), { projectId }),
        CircuitBreakerOpen,
      );
      assertEquals(calls, 5);
    });

    // Worker isolation is the configuration operators are told to use for
    // untrusted project code, so the in-process path alone is not enough. A
    // control result thrown inside the worker is a plain object, and the worker
    // error path serialized it with String(), producing "[object Object]" and a
    // 500 on the host.
    describe("under worker isolation", () => {
      let projectDir: string | null = null;

      afterEach(async () => {
        try {
          Deno.env.delete("WORKER_ISOLATION_ENABLED");
        } catch { /* ok */ }
        try {
          Deno.env.delete("WORKER_ISOLATION_DATA");
        } catch { /* ok */ }
        await __resetPoolForTests();

        if (projectDir) {
          await Deno.remove(projectDir, { recursive: true }).catch(() => {});
          projectDir = null;
        }
      });

      async function writeIsolatedPage(source: string): Promise<
        { modulePath: string; projectDir: string }
      > {
        const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "vf-isolated-data-" }));
        projectDir = dir;
        const modulePath = join(dir, "page.ts");
        await Deno.writeTextFile(modulePath, source);

        Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
        Deno.env.set("WORKER_ISOLATION_DATA", "1");
        await __resetPoolForTests();

        return { modulePath, projectDir: dir };
      }

      // The worker cannot import the framework helpers: its read permission is
      // scoped to the project directory. `notFound()` brands its result with a
      // registered symbol precisely so a result built anywhere is recognised
      // everywhere, so the fixture rebuilds the same public brand.
      const BRAND_SOURCE =
        `Object.defineProperty(result, Symbol.for("veryfront.dataControlResult"), { value: true });`;

      function isolatedFetch(
        modulePath: string,
        dir: string,
        workerGeneration?: {
          workerScopeId: string;
          workerGenerationId: string;
        },
      ): Promise<DataResult> {
        const fetcher = new ServerDataFetcher();
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({ props: {} }),
        };

        return runWithExactSourceIntegrationPolicy(
          { schemaVersion: 1, mode: "unrestricted" },
          () =>
            fetcher.fetch(pageModule, createContext(), {
              modulePath,
              projectDir: dir,
              ...workerGeneration,
            }),
        );
      }

      it("treats a thrown notFound() as a 404 result", async () => {
        const { modulePath, projectDir: dir } = await writeIsolatedPage(
          `export function getServerData() {
             const result = { notFound: true };
             ${BRAND_SOURCE}
             throw result;
           }
           export default function Page() { return null; }`,
        );

        const result = await isolatedFetch(modulePath, dir);

        assertEquals(result.notFound, true);
        assertEquals(result.redirect, undefined);
      });

      it("treats a thrown redirect() as a redirect result", async () => {
        const { modulePath, projectDir: dir } = await writeIsolatedPage(
          `export function getServerData() {
             const result = { redirect: { destination: "/login", permanent: true } };
             ${BRAND_SOURCE}
             throw result;
           }
           export default function Page() { return null; }`,
        );

        const result = await isolatedFetch(modulePath, dir);

        assertEquals(result.redirect?.destination, "/login");
        assertEquals(result.redirect?.permanent, true);
        assertEquals(result.notFound, undefined);
      });

      it("still propagates a genuine Error thrown in the worker", async () => {
        const { modulePath, projectDir: dir } = await writeIsolatedPage(
          `export function getServerData() {
             throw new Error("intentional test error from isolated getServerData");
           }
           export default function Page() { return null; }`,
        );

        await assertRejects(
          () => isolatedFetch(modulePath, dir),
          Error,
          "intentional test error from isolated getServerData",
        );
      });

      it("rejects conflicting outcomes inside the worker boundary", async () => {
        const { modulePath, projectDir: dir } = await writeIsolatedPage(
          `export function getServerData() {
             return {
               props: { mustNotEscape: true },
               redirect: { destination: "/other" },
             };
           }
           export default function Page() { return null; }`,
        );

        const error = await assertRejects(() => isolatedFetch(modulePath, dir));

        assertInstanceOf(error, Error);
        assertEquals(error.message.includes("Invalid isolated data result"), true);
      });

      it("preserves registered worker error identity and diagnostics", async () => {
        const { modulePath, projectDir: dir } = await writeIsolatedPage(
          `export function getServerData() {
             return { props: { shouldNotRun: true } };
           }
           export default function Page() { return null; }`,
        );
        const pool = getWorkerPool();
        const originalExecute = pool.execute;
        const fetcher = new ServerDataFetcher();
        const projectId = `worker-registered-error-${crypto.randomUUID()}`;
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({ props: { shouldNotRun: true } }),
        };

        pool.execute = async () => ({
          type: "error",
          id: "worker-registered-error",
          error: {
            message: "dependency overloaded",
            name: "VeryfrontError",
            stack:
              "VeryfrontError: dependency overloaded\n    at postgres://admin:secret@db.internal/query:1:1",
            problem: {
              slug: SERVICE_OVERLOADED.slug,
              category: SERVICE_OVERLOADED.category,
              status: 429,
              title: SERVICE_OVERLOADED.title,
              suggestion: SERVICE_OVERLOADED.suggestion,
              detail: "upstream capacity exhausted",
              cause: "queue is full",
              instance: "/requests/data-1",
            },
          },
        });

        try {
          const error = await assertRejects(() =>
            runWithTestSourcePolicy(() =>
              fetcher.fetch(pageModule, createContext(), {
                modulePath,
                projectDir: dir,
                projectId,
              })
            )
          );

          assertInstanceOf(error, VeryfrontError);
          assertEquals(error.slug, SERVICE_OVERLOADED.slug);
          assertEquals(error.status, 429);
          assertEquals(error.detail, "upstream capacity exhausted");
          assertEquals(error.cause, "queue is full");
          assertEquals(error.instance, "/requests/data-1");
          assertEquals(
            error.stack?.includes("postgres://admin:[REDACTED]@db.internal/query"),
            true,
          );
          assertEquals(error.stack?.includes("secret"), false);
        } finally {
          pool.execute = originalExecute;
        }
      });

      it("counts malformed worker responses before breaker success", async () => {
        const { modulePath, projectDir: dir } = await writeIsolatedPage(
          `export function getServerData() {
             return { props: { shouldNotRun: true } };
           }
           export default function Page() { return null; }`,
        );
        const pool = getWorkerPool();
        const originalExecute = pool.execute;
        const fetcher = new ServerDataFetcher();
        const projectId = `worker-invalid-result-${crypto.randomUUID()}`;
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({ props: { shouldNotRun: true } }),
        };
        let workerCalls = 0;
        const fetch = () =>
          runWithTestSourcePolicy(() =>
            fetcher.fetch(pageModule, createContext(), {
              modulePath,
              projectDir: dir,
              projectId,
            })
          );

        pool.execute = async () => {
          workerCalls++;
          return {
            type: "data-result",
            id: "worker-invalid-result",
            result: {
              props: { invalid: true },
              notFound: true,
            },
          };
        };

        try {
          for (let attempt = 0; attempt < 5; attempt++) {
            await assertRejects(fetch, TypeError, "valid data result object");
          }
          await assertRejects(fetch, CircuitBreakerOpen);
          assertEquals(workerCalls, 5);
        } finally {
          pool.execute = originalExecute;
        }
      });

      it("counts a serialized worker service overload as a dependency failure", async () => {
        const { modulePath, projectDir: dir } = await writeIsolatedPage(
          `export function getServerData() {
             return { props: { shouldNotRun: true } };
           }
           export default function Page() { return null; }`,
        );
        const pool = getWorkerPool();
        const originalExecute = pool.execute;
        const fetcher = new ServerDataFetcher();
        const projectId = `worker-project-overload-${crypto.randomUUID()}`;
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({ props: { shouldNotRun: true } }),
        };
        let workerCalls = 0;
        const fetch = () =>
          runWithTestSourcePolicy(() =>
            fetcher.fetch(pageModule, createContext(), {
              modulePath,
              projectDir: dir,
              projectId,
            })
          );

        pool.execute = async () => {
          workerCalls++;
          return {
            type: "error",
            id: "worker-project-overload",
            error: {
              message: "project dependency overloaded",
              name: "VeryfrontError",
              problem: {
                slug: SERVICE_OVERLOADED.slug,
                category: SERVICE_OVERLOADED.category,
                status: SERVICE_OVERLOADED.status,
                title: SERVICE_OVERLOADED.title,
                suggestion: SERVICE_OVERLOADED.suggestion,
                detail: "Project dependency reported overload",
              },
            },
          };
        };

        try {
          for (let attempt = 0; attempt < 5; attempt++) {
            const error = await assertRejects(fetch);
            assertInstanceOf(error, VeryfrontError);
            assertEquals(error.slug, SERVICE_OVERLOADED.slug);
          }
          await assertRejects(fetch, CircuitBreakerOpen);
          assertEquals(workerCalls, 5);
        } finally {
          pool.execute = originalExecute;
        }
      });

      it("does not reuse an unversioned dependency graph across requests", async () => {
        const { modulePath, projectDir: dir } = await writeIsolatedPage(
          `import { version } from "./dependency.ts";
           export function getServerData() {
             return { props: { version } };
           }
           export default function Page() { return null; }`,
        );
        const dependencyPath = join(dir, "dependency.ts");
        await Deno.writeTextFile(dependencyPath, "export const version = 1;\n");

        const first = await isolatedFetch(modulePath, dir);
        await Deno.writeTextFile(dependencyPath, "export const version = 2;\n");
        const second = await isolatedFetch(modulePath, dir);

        assertEquals(first.props, { version: 1 });
        assertEquals(second.props, { version: 2 });
      });

      it("uses a fresh worker for each trusted source generation", async () => {
        const { modulePath, projectDir: dir } = await writeIsolatedPage(
          `import { version } from "./dependency.ts";
           export function getServerData() {
             return { props: { version } };
           }
           export default function Page() { return null; }`,
        );
        const dependencyPath = join(dir, "dependency.ts");
        const workerScopeId = `data-generation-${crypto.randomUUID()}`;
        await Deno.writeTextFile(dependencyPath, "export const version = 1;\n");

        const first = await isolatedFetch(modulePath, dir, {
          workerScopeId,
          workerGenerationId: "release-1",
        });
        await Deno.writeTextFile(dependencyPath, "export const version = 2;\n");
        const second = await isolatedFetch(modulePath, dir, {
          workerScopeId,
          workerGenerationId: "release-2",
        });

        assertEquals(first.props, { version: 1 });
        assertEquals(second.props, { version: 2 });
        getWorkerPool().evictWorkerScope(workerScopeId);
      });

      it("keeps local worker-pool overload neutral to the project circuit", async () => {
        const { modulePath, projectDir: dir } = await writeIsolatedPage(
          `export function getServerData() {
             return { props: { shouldNotRun: true } };
           }
           export default function Page() { return null; }`,
        );
        const pool = getWorkerPool();
        const originalExecute = pool.execute;
        const fetcher = new ServerDataFetcher();
        const projectId = `worker-pool-overload-${crypto.randomUUID()}`;
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({ props: { shouldNotRun: true } }),
        };
        let workerCalls = 0;
        const fetch = () =>
          runWithTestSourcePolicy(() =>
            fetcher.fetch(pageModule, createContext(), {
              modulePath,
              projectDir: dir,
              projectId,
            })
          );

        pool.execute = () => {
          workerCalls++;
          return Promise.reject(
            SERVICE_OVERLOADED.create({
              detail: "Worker active request capacity reached",
            }),
          );
        };

        try {
          for (let attempt = 0; attempt < 6; attempt++) {
            const error = await assertRejects(fetch);
            assertInstanceOf(error, VeryfrontError);
            assertEquals(error.slug, SERVICE_OVERLOADED.slug);
          }
          assertEquals(workerCalls, 6);

          pool.execute = () => {
            workerCalls++;
            return Promise.resolve<WorkerResponse>({
              type: "data-result",
              id: "worker-capacity-recovered",
              result: { props: { recovered: true } },
            });
          };
          assertEquals((await fetch()).props, { recovered: true });
          assertEquals(workerCalls, 7);
        } finally {
          pool.execute = originalExecute;
        }
      });
    });

    it("still opens the circuit breaker on repeated genuine errors", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `repeated-genuine-errors-${crypto.randomUUID()}`;
      const context = createContext();

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw new Error("intentional test error from getServerData");
        },
      };

      for (let i = 0; i < 5; i++) {
        await assertRejects(() => fetcher.fetch(pageModule, context, { projectId }));
      }

      // The sixth call fails fast rather than running the handler again.
      await assertRejects(
        () => fetcher.fetch(pageModule, context, { projectId }),
        Error,
        "Circuit breaker",
      );
    });
  });
});
