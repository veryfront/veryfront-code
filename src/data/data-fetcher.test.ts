import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runWithCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { DataFetcher } from "./data-fetcher.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { TimeoutError } from "#veryfront/rendering/utils/stream-utils.ts";
import { DataExecutionAdmission } from "./execution-admission.ts";
import { VeryfrontError } from "#veryfront/errors";
import { CircuitBreakerOpen } from "#veryfront/utils/circuit-breaker.ts";

function createContext(overrides: Partial<DataContext> = {}): DataContext {
  return {
    params: {},
    query: new URLSearchParams(),
    request: new Request("http://localhost/test"),
    url: new URL("http://localhost/test"),
    ...overrides,
  };
}

function getProps<T>(result: DataResult): T {
  assertExists(result.props);
  return result.props as T;
}

describe("DataFetcher", () => {
  describe("constructor", () => {
    it("should create instance without adapter", () => {
      assertExists(new DataFetcher());
    });

    it("should create instance with adapter", () => {
      const mockAdapter = { env: { get: () => undefined } };
      assertExists(new DataFetcher(mockAdapter));
    });

    it("should forward an explicitly configured static-path deadline", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 1,
        maxConcurrentPerProject: 1,
      });
      const fetcher = new DataFetcher(undefined, {
        staticPathsTimeoutMs: 5,
        executionAdmission: admission,
      });
      let resolveRaw!: (result: {
        paths: Array<{ params: Record<string, string> }>;
        fallback: false;
      }) => void;
      const raw = new Promise<{
        paths: Array<{ params: Record<string, string> }>;
        fallback: false;
      }>((resolve) => {
        resolveRaw = resolve;
      });
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => raw,
      };
      const projectId = `paths-deadline-${crypto.randomUUID()}`;

      try {
        await assertRejects(
          () => fetcher.getStaticPaths(pageModule, { projectId }),
          TimeoutError,
          "timed out after 5ms",
        );
        assertEquals(admission.snapshot(projectId), {
          active: 1,
          activeForProject: 1,
        });
      } finally {
        resolveRaw({ paths: [], fallback: false });
        for (let flush = 0; flush < 4; flush++) await Promise.resolve();
      }
      assertEquals(admission.snapshot(projectId), {
        active: 0,
        activeForProject: 0,
      });
    });
  });

  describe("fetchData", () => {
    it("should return empty props when no data functions defined", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = { default: () => null };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(result.props, {});
    });

    it("rejects an invalid runtime project identity before selecting a hook", async () => {
      const fetcher = new DataFetcher();

      await assertRejects(
        () =>
          fetcher.fetchData(
            { default: () => null },
            createContext(),
            "production",
            { projectId: 1 as unknown as string },
          ),
        TypeError,
        "must be a non-empty string",
      );
    });

    it("snapshots mutable loader exports before selection and dispatch", async () => {
      const fetcher = new DataFetcher();
      let serverReads = 0;
      const serverModule = {
        default: () => null,
        get getServerData() {
          const generation = ++serverReads;
          return () => ({ props: { generation } });
        },
      } satisfies PageWithData<{ generation: number }>;
      const serverResult = await fetcher.fetchData(
        serverModule,
        createContext(),
        "development",
      );
      assertEquals(serverResult.props, { generation: 1 });
      assertEquals(serverReads, 1);

      let staticReads = 0;
      const staticModule = {
        default: () => null,
        get getStaticData() {
          const generation = ++staticReads;
          return () => ({ props: { generation } });
        },
      } satisfies PageWithData<{ generation: number }>;
      const staticResult = await fetcher.fetchData(
        staticModule,
        createContext(),
        "production",
        { cacheScope: null },
      );
      assertEquals(staticResult.props, { generation: 1 });
      assertEquals(staticReads, 1);
    });

    describe("development mode", () => {
      it("should prefer getServerData in development mode", async () => {
        const fetcher = new DataFetcher();
        const pageModule: PageWithData<{ source: string }> = {
          default: () => null,
          getServerData: () => ({ props: { source: "server" } }),
          getStaticData: () => ({ props: { source: "static" } }),
        };

        const result = await fetcher.fetchData(
          pageModule,
          createContext(),
          "development",
        );

        assertEquals(getProps<{ source: string }>(result).source, "server");
      });

      it("should fallback to getStaticData if getServerData not defined", async () => {
        const fetcher = new DataFetcher();
        const pageModule: PageWithData<{ source: string }> = {
          default: () => null,
          getStaticData: () => ({ props: { source: "static" } }),
        };

        const result = await fetcher.fetchData(
          pageModule,
          createContext(),
          "development",
        );

        assertEquals(getProps<{ source: string }>(result).source, "static");
      });

      it("should fallback to getStaticData when getServerData is not callable", async () => {
        const fetcher = new DataFetcher();
        const pageModule: PageWithData<{ source: string }> = {
          default: () => null,
          getServerData: "invalid" as unknown as PageWithData<
            { source: string }
          >["getServerData"],
          getStaticData: () => ({ props: { source: "static" } }),
        };

        const result = await fetcher.fetchData(
          pageModule,
          createContext(),
          "development",
        );

        assertEquals(getProps<{ source: string }>(result).source, "static");
      });
    });

    describe("production mode", () => {
      it("should prefer getStaticData in production mode", async () => {
        const fetcher = new DataFetcher();
        const pageModule: PageWithData<{ source: string }> = {
          default: () => null,
          getServerData: () => ({ props: { source: "server" } }),
          getStaticData: () => ({ props: { source: "static" } }),
        };

        const result = await fetcher.fetchData(
          pageModule,
          createContext(),
          "production",
        );

        assertEquals(getProps<{ source: string }>(result).source, "static");
      });

      it("should isolate cached getStaticData results by module path", async () => {
        const fetcher = new DataFetcher();
        const context = createContext({ url: new URL("http://localhost/dashboard") });
        const layoutModule: PageWithData<{ source: string }> = {
          default: () => null,
          getStaticData: () => ({ props: { source: "layout" } }),
        };
        const pageModule: PageWithData<{ source: string }> = {
          default: () => null,
          getStaticData: () => ({ props: { source: "page" } }),
        };

        const layoutResult = await fetcher.fetchData(
          layoutModule,
          context,
          "production",
          { modulePath: "/project/components/layout.tsx" },
        );
        const pageResult = await fetcher.fetchData(
          pageModule,
          context,
          "production",
          { modulePath: "/project/pages/index.tsx" },
        );

        assertEquals(getProps<{ source: string }>(layoutResult).source, "layout");
        assertEquals(getProps<{ source: string }>(pageResult).source, "page");
      });

      it("skips static caching when the module identity is absent or empty", async () => {
        for (
          const [label, modulePath] of [
            ["absent", undefined],
            ["empty", ""],
          ] as const
        ) {
          const fetcher = new DataFetcher();
          const context = createContext({
            url: new URL(`https://example.test/missing-module-${label}`),
          });
          const scope = {
            projectId: `missing-module-${label}`,
            mode: "production" as const,
            versionId: "rel-1",
          };
          let firstModuleCalls = 0;
          let secondModuleCalls = 0;
          const firstModule: PageWithData<{ source: string }> = {
            default: () => null,
            getStaticData: () => ({
              props: { source: `first-${++firstModuleCalls}` },
              revalidate: 3600,
            }),
          };
          const secondModule: PageWithData<{ source: string }> = {
            default: () => null,
            getStaticData: () => ({
              props: { source: `second-${++secondModuleCalls}` },
              revalidate: 3600,
            }),
          };
          const options = {
            projectId: scope.projectId,
            cacheScope: scope,
            modulePath,
          };

          try {
            const first = await fetcher.fetchData(
              firstModule,
              context,
              "production",
              options,
            );
            const second = await fetcher.fetchData(
              secondModule,
              context,
              "production",
              options,
            );
            const repeated = await fetcher.fetchData(
              firstModule,
              context,
              "production",
              options,
            );

            assertEquals(first.props, { source: "first-1" });
            assertEquals(second.props, { source: "second-1" });
            assertEquals(repeated.props, { source: "first-2" });
            assertEquals(firstModuleCalls, 2);
            assertEquals(secondModuleCalls, 1);
          } finally {
            fetcher.destroy();
          }
        }
      });

      it("should use getServerData if getStaticData not defined in production", async () => {
        const fetcher = new DataFetcher();
        const pageModule: PageWithData<{ source: string }> = {
          default: () => null,
          getServerData: () => ({ props: { source: "server" } }),
        };

        const result = await fetcher.fetchData(
          pageModule,
          createContext(),
          "production",
        );

        assertEquals(getProps<{ source: string }>(result).source, "server");
      });

      it("should use getServerData when getStaticData is not callable", async () => {
        const fetcher = new DataFetcher();
        const pageModule: PageWithData<{ source: string }> = {
          default: () => null,
          getServerData: () => ({ props: { source: "server" } }),
          getStaticData: "invalid" as unknown as PageWithData<
            { source: string }
          >["getStaticData"],
        };

        const result = await fetcher.fetchData(
          pageModule,
          createContext(),
          "production",
        );

        assertEquals(getProps<{ source: string }>(result).source, "server");
      });
    });

    it("should default to development mode", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData<{ source: string }> = {
        default: () => null,
        getServerData: () => ({ props: { source: "server" } }),
        getStaticData: () => ({ props: { source: "static" } }),
      };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(getProps<{ source: string }>(result).source, "server");
    });

    it("should reject an unsupported runtime mode", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = { default: () => null };

      await assertRejects(
        () =>
          fetcher.fetchData(
            pageModule,
            createContext(),
            "staging" as "development",
          ),
        TypeError,
        "Unsupported data fetching mode",
      );
    });

    it("caches under an explicit production scope without ambient context", async () => {
      const fetcher = new DataFetcher();
      let calls = 0;
      const pageModule: PageWithData<{ version: number }> = {
        default: () => null,
        getStaticData: () => ({
          props: { version: ++calls },
          revalidate: 3600,
        }),
      };
      const context = createContext({
        url: new URL("https://example.test/explicit-scope"),
      });
      const options = {
        modulePath: "/project/pages/explicit-scope.tsx",
        projectId: "explicit-project",
        cacheScope: {
          projectId: "explicit-project",
          mode: "production" as const,
          versionId: "rel-1",
        },
      };

      const first = await fetcher.fetchData(
        pageModule,
        context,
        "production",
        options,
      );
      const second = await fetcher.fetchData(
        pageModule,
        context,
        "production",
        options,
      );

      assertEquals(getProps<{ version: number }>(first).version, 1);
      assertEquals(getProps<{ version: number }>(second).version, 1);
      assertEquals(calls, 1);
    });

    it("snapshots a mutable cache scope before admission and publication", async () => {
      const fetcher = new DataFetcher();
      const context = createContext({
        url: new URL("https://example.test/scope-snapshot"),
      });
      let projectReads = 0;
      const mutableScope = new Proxy(
        {
          projectId: "project-a",
          mode: "production" as const,
          versionId: "rel-1",
        },
        {
          get(target, property, receiver) {
            if (property === "projectId") {
              projectReads++;
              return projectReads === 1 ? "project-a" : "project-b";
            }
            return Reflect.get(target, property, receiver);
          },
        },
      );
      let projectACalls = 0;
      let projectBCalls = 0;

      const projectAResult = await fetcher.fetchData(
        {
          default: () => null,
          getStaticData: () => ({
            props: { source: `a-${++projectACalls}` },
            revalidate: 3600,
          }),
        },
        context,
        "production",
        {
          modulePath: "/project/pages/scope-snapshot.tsx",
          cacheScope: mutableScope,
        },
      );
      const projectBResult = await fetcher.fetchData(
        {
          default: () => null,
          getStaticData: () => ({
            props: { source: `b-${++projectBCalls}` },
            revalidate: 3600,
          }),
        },
        context,
        "production",
        {
          modulePath: "/project/pages/scope-snapshot.tsx",
          cacheScope: {
            projectId: "project-b",
            mode: "production",
            versionId: "rel-1",
          },
        },
      );

      assertEquals(projectAResult.props, { source: "a-1" });
      assertEquals(projectBResult.props, { source: "b-1" });
      assertEquals(projectACalls, 1);
      assertEquals(projectBCalls, 1);
      assertEquals(projectReads, 1);
    });

    it("keeps ambient admission identity when an explicit null disables caching", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 2,
        maxConcurrentPerProject: 1,
      });
      const fetcher = new DataFetcher(undefined, {
        executionAdmission: admission,
      });
      const projectA = {
        projectId: `null-cache-a-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      const projectB = {
        projectId: `null-cache-b-${crypto.randomUUID()}`,
        mode: "production" as const,
        versionId: "rel-1",
      };
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let resolveA!: (result: DataResult) => void;
      const rawA = new Promise<DataResult>((resolve) => {
        resolveA = resolve;
      });
      const first = runWithCacheKeyContext(
        projectA,
        () =>
          fetcher.fetchData(
            {
              default: () => null,
              getStaticData: () => {
                markStarted();
                return rawA;
              },
            },
            createContext(),
            "production",
            { cacheScope: null },
          ),
      );

      try {
        await started;
        const peer = await runWithCacheKeyContext(
          projectB,
          () =>
            fetcher.fetchData(
              {
                default: () => null,
                getStaticData: () => ({ props: { project: "b" } }),
              },
              createContext(),
              "production",
              { cacheScope: null },
            ),
        );
        assertEquals(peer.props, { project: "b" });
        assertEquals(admission.snapshot(projectA.projectId), {
          active: 1,
          activeForProject: 1,
        });
        assertEquals(admission.snapshot(projectB.projectId), {
          active: 1,
          activeForProject: 0,
        });
        assertEquals(admission.snapshot("default").activeForProject, 0);

        resolveA({ props: { project: "a" } });
        assertEquals((await first).props, { project: "a" });
      } finally {
        resolveA({ props: { project: "a" } });
        await first.catch(() => undefined);
      }
    });

    it("preserves preview source identity when dispatching static data", async () => {
      const fetcher = new DataFetcher();
      const projectId = `static-preview-source-${crypto.randomUUID()}`;
      const workerScopeId = `static-preview-scope-${crypto.randomUUID()}`;
      let failingCalls = 0;
      const failing: PageWithData = {
        default: () => null,
        getStaticData: () => {
          failingCalls++;
          throw new Error("preview source A failed");
        },
      };
      const sourceA = {
        projectId,
        cacheScope: null,
        workerScopeId,
        workerGenerationId: "shared-release-label",
      } as const;

      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          await assertRejects(
            () =>
              fetcher.fetchData(
                failing,
                createContext({
                  url: new URL(`https://example.test/source-a/${attempt}`),
                }),
                "production",
                sourceA,
              ),
            Error,
            "preview source A failed",
          );
        }
        await assertRejects(
          () =>
            fetcher.fetchData(
              failing,
              createContext({
                url: new URL("https://example.test/source-a/another-route"),
              }),
              "production",
              sourceA,
            ),
          CircuitBreakerOpen,
        );

        const healthy = await fetcher.fetchData(
          {
            default: () => null,
            getStaticData: () => ({ props: { source: "b" } }),
          },
          createContext({
            url: new URL("https://example.test/source-b/healthy"),
          }),
          "production",
          {
            projectId,
            cacheScope: null,
            workerScopeId: `static-preview-b-scope-${crypto.randomUUID()}`,
            workerGenerationId: "shared-release-label",
          },
        );

        assertEquals(healthy.props, { source: "b" });
        assertEquals(failingCalls, 5);
      } finally {
        fetcher.destroy();
      }
    });

    it("accepts distinct cache-version and execution-source representations", async () => {
      const fetcher = new DataFetcher();
      const projectId = `static-source-representation-${crypto.randomUUID()}`;

      try {
        const result = await fetcher.fetchData(
          {
            default: () => null,
            getStaticData: () => ({ props: { ok: true } }),
          },
          createContext({
            url: new URL("https://example.test/distinct-source-representation"),
          }),
          "production",
          {
            modulePath: "/project/pages/distinct-source-representation.tsx",
            projectId,
            cacheScope: {
              projectId,
              mode: "production",
              versionId: "42",
            },
            workerScopeId: `static-source-scope-${crypto.randomUUID()}`,
            workerGenerationId: "release-42",
          },
        );

        assertEquals(result.props, { ok: true });
      } finally {
        fetcher.destroy();
      }
    });

    it("preserves cache-scope identity on the server path without a worker source", async () => {
      const fetcher = new DataFetcher();
      const projectId = `server-cache-scope-${crypto.randomUUID()}`;
      let failingCalls = 0;
      const failing: PageWithData = {
        default: () => null,
        getServerData: () => {
          failingCalls++;
          throw new Error("preview branch A failed");
        },
      };
      const previewOptions = {
        projectId,
        cacheScope: {
          projectId,
          mode: "preview" as const,
          versionId: "branch-a",
        },
      };

      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          await assertRejects(
            () =>
              fetcher.fetchData(
                failing,
                createContext({
                  url: new URL(`https://example.test/preview-a/${attempt}`),
                }),
                "production",
                previewOptions,
              ),
            Error,
            "preview branch A failed",
          );
        }
        await assertRejects(
          () =>
            fetcher.fetchData(
              failing,
              createContext({
                url: new URL("https://example.test/preview-a/another-route"),
              }),
              "production",
              previewOptions,
            ),
          CircuitBreakerOpen,
        );

        const healthy = await fetcher.fetchData(
          {
            default: () => null,
            getServerData: () => ({ props: { source: "production" } }),
          },
          createContext({
            url: new URL("https://example.test/production/healthy"),
          }),
          "production",
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
      } finally {
        fetcher.destroy();
      }
    });

    it("rejects conflicting trusted and cache-scope project identities", async () => {
      const fetcher = new DataFetcher();
      let called = false;
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => {
          called = true;
          return { props: {} };
        },
      };

      await assertRejects(
        () =>
          fetcher.fetchData(
            pageModule,
            createContext(),
            "production",
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
      assertEquals(called, false);
    });

    it("does not start work for a pre-aborted caller", async () => {
      const fetcher = new DataFetcher();
      const controller = new AbortController();
      const reason = new Error("caller already disconnected");
      controller.abort(reason);
      let called = false;

      const error = await assertRejects(() =>
        fetcher.fetchData(
          {
            default: () => null,
            getStaticData: () => {
              called = true;
              return { props: {} };
            },
          },
          createContext(),
          "production",
          { signal: controller.signal },
        )
      );

      assertStrictEquals(error, reason);
      assertEquals(called, false);
    });

    it("lets one static caller abort without cancelling shared cold work", async () => {
      const fetcher = new DataFetcher();
      const scope = {
        projectId: "shared-cold-project",
        mode: "production" as const,
        versionId: "rel-1",
      };
      let calls = 0;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let resolveLoad!: (
        result: DataResult<{ version: number }>,
      ) => void;
      const load = new Promise<DataResult<{ version: number }>>((resolve) => {
        resolveLoad = resolve;
      });
      const pageModule: PageWithData<{ version: number }> = {
        default: () => null,
        getStaticData: () => {
          calls++;
          markStarted();
          return load;
        },
      };
      const context = createContext({
        url: new URL("https://example.test/shared-cold"),
      });
      const controller = new AbortController();
      const reason = new Error("first caller disconnected");

      const first = fetcher.fetchData(pageModule, context, "production", {
        modulePath: "/project/pages/shared-cold.tsx",
        projectId: scope.projectId,
        cacheScope: scope,
        signal: controller.signal,
      });
      const second = fetcher.fetchData(pageModule, context, "production", {
        modulePath: "/project/pages/shared-cold.tsx",
        projectId: scope.projectId,
        cacheScope: scope,
      });
      await started;
      controller.abort(reason);

      const firstError = await assertRejects(() => first);
      assertStrictEquals(firstError, reason);
      resolveLoad({ props: { version: 1 }, revalidate: 3600 });
      assertEquals(getProps<{ version: number }>(await second).version, 1);

      const cached = await fetcher.fetchData(
        pageModule,
        context,
        "production",
        {
          modulePath: "/project/pages/shared-cold.tsx",
          projectId: scope.projectId,
          cacheScope: scope,
        },
      );
      assertEquals(getProps<{ version: number }>(cached).version, 1);
      assertEquals(calls, 1);
    });

    it("holds per-project admission until detached static work really settles", async () => {
      const admission = new DataExecutionAdmission({
        maxConcurrent: 2,
        maxConcurrentPerProject: 1,
      });
      const fetcher = new DataFetcher(undefined, {
        executionAdmission: admission,
      });
      const scope = {
        projectId: "detached-static-project",
        mode: "production" as const,
        versionId: "rel-1",
      };
      let calls = 0;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const pageModule: PageWithData<{ call: number }> = {
        default: () => null,
        getStaticData: async () => {
          calls++;
          if (calls === 1) {
            markStarted();
            await firstGate;
          }
          return { props: { call: calls }, revalidate: 3600 };
        },
      };
      const controller = new AbortController();
      const reason = new Error("static caller left");
      const first = fetcher.fetchData(
        pageModule,
        createContext({
          url: new URL("https://example.test/detached-one"),
        }),
        "production",
        {
          projectId: scope.projectId,
          cacheScope: scope,
          signal: controller.signal,
        },
      );

      try {
        await started;
        controller.abort(reason);
        const callerError = await assertRejects(() => first);
        assertStrictEquals(callerError, reason);

        const overload = await assertRejects(() =>
          fetcher.fetchData(
            pageModule,
            createContext({
              url: new URL("https://example.test/detached-two"),
            }),
            "production",
            {
              projectId: scope.projectId,
              cacheScope: scope,
            },
          )
        );
        assertEquals(overload instanceof VeryfrontError, true);
        assertEquals((overload as VeryfrontError).slug, "service-overloaded");
        assertEquals(calls, 1);

        releaseFirst();
        for (
          let flush = 0;
          admission.snapshot(scope.projectId).active !== 0 &&
          flush < 100;
          flush++
        ) {
          await Promise.resolve();
        }
        assertEquals(admission.snapshot(scope.projectId), {
          active: 0,
          activeForProject: 0,
        });

        const next = await fetcher.fetchData(
          pageModule,
          createContext({
            url: new URL("https://example.test/detached-two"),
          }),
          "production",
          {
            projectId: scope.projectId,
            cacheScope: scope,
          },
        );
        assertEquals(next.props, { call: 2 });
        assertEquals(calls, 2);
      } finally {
        releaseFirst();
        await Promise.allSettled([first]);
        fetcher.destroy();
      }
    });

    it("should handle redirect from data function", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          redirect: { destination: "/login", permanent: false },
        }),
      };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(result.redirect?.destination, "/login");
    });

    it("should handle notFound from data function", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ notFound: true }),
      };

      const result = await fetcher.fetchData(pageModule, createContext());

      assertEquals(result.notFound, true);
    });
  });

  describe("getStaticPaths", () => {
    it("should return null when getStaticPaths not defined", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = { default: () => null };

      const result = await fetcher.getStaticPaths(pageModule);

      assertEquals(result, null);
    });

    it("should return paths from getStaticPaths", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [{ params: { id: "1" } }, { params: { id: "2" } }],
          fallback: false,
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertExists(result);
      assertEquals(result.paths.length, 2);
      assertEquals(result.fallback, false);
    });

    it("should support fallback: blocking", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticPaths: () => ({
          paths: [],
          fallback: "blocking",
        }),
      };

      const result = await fetcher.getStaticPaths(pageModule);

      assertEquals(result?.fallback, "blocking");
    });
  });

  describe("clearCache", () => {
    it("should clear all cache without pattern", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getStaticData: () => ({
          props: { cached: true },
          revalidate: 3600,
        }),
      };

      await fetcher.fetchData(pageModule, createContext(), "production", {
        modulePath: "/project/pages/clear-all.tsx",
      });
      fetcher.clearCache();
    });

    it("should clear cache matching pattern", () => {
      const fetcher = new DataFetcher();
      fetcher.clearCache("/blog");
    });

    it("should not throw with empty pattern", () => {
      const fetcher = new DataFetcher();
      fetcher.clearCache("");
    });

    it("should not let an in-flight load repopulate a cleared cache", async () => {
      await runWithCacheKeyContext(
        { projectId: "clear-race", mode: "production", versionId: "rel_test" },
        async () => {
          const fetcher = new DataFetcher();
          let callCount = 0;
          let resolveFirst!: (result: DataResult<{ version: number }>) => void;
          const firstLoad = new Promise<DataResult<{ version: number }>>((resolve) => {
            resolveFirst = resolve;
          });
          const pageModule: PageWithData<{ version: number }> = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return callCount === 1
                ? firstLoad
                : { props: { version: callCount }, revalidate: 3600 };
            },
          };
          const context = createContext({
            url: new URL("http://localhost/clear-race"),
          });
          const options = { modulePath: "/project/pages/clear-race.tsx" };

          const pending = fetcher.fetchData(pageModule, context, "production", options);
          for (let i = 0; i < 20 && callCount === 0; i++) {
            await Promise.resolve();
          }
          assertEquals(callCount, 1);

          fetcher.clearCache();
          resolveFirst({ props: { version: 1 }, revalidate: 3600 });
          await pending;

          const next = await fetcher.fetchData(pageModule, context, "production", options);
          assertEquals(getProps<{ version: number }>(next).version, 2);
          assertEquals(callCount, 2);
        },
      );
    });

    it("should let a post-clear load bypass the invalidated old singleflight", async () => {
      await runWithCacheKeyContext(
        {
          projectId: "clear-singleflight-generation",
          mode: "production",
          versionId: "rel_test",
        },
        async () => {
          const fetcher = new DataFetcher();
          let callCount = 0;
          let resolveOld!: (result: DataResult<{ version: number }>) => void;
          const oldLoad = new Promise<DataResult<{ version: number }>>((resolve) => {
            resolveOld = resolve;
          });
          const pageModule: PageWithData<{ version: number }> = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return callCount === 1 ? oldLoad : { props: { version: 2 }, revalidate: 3600 };
            },
          };
          const context = createContext({
            url: new URL("http://localhost/clear-singleflight-generation"),
          });
          const options = {
            modulePath: "/project/pages/clear-singleflight-generation.tsx",
          };

          const pendingOld = fetcher.fetchData(pageModule, context, "production", options);
          for (let i = 0; i < 20 && callCount === 0; i++) await Promise.resolve();
          assertEquals(callCount, 1);

          fetcher.clearCache();
          const fresh = await fetcher.fetchData(pageModule, context, "production", options);
          assertEquals(getProps<{ version: number }>(fresh).version, 2);
          assertEquals(callCount, 2);

          resolveOld({ props: { version: 1 }, revalidate: 3600 });
          assertEquals(
            getProps<{ version: number }>(await pendingOld).version,
            1,
          );

          const cached = await fetcher.fetchData(pageModule, context, "production", options);
          assertEquals(getProps<{ version: number }>(cached).version, 2);
          assertEquals(callCount, 2);
        },
      );
    });

    it("treats trailing-slash route invalidation as an in-flight write barrier", async () => {
      const fetcher = new DataFetcher();
      const scope = {
        projectId: "route-clear-barrier",
        mode: "production" as const,
        versionId: "rel-1",
      };
      let calls = 0;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const pageModule: PageWithData<{ version: number }> = {
        default: () => null,
        getStaticData: async () => {
          calls++;
          if (calls === 1) {
            markStarted();
            await firstGate;
          }
          return { props: { version: calls }, revalidate: 3600 };
        },
      };
      const context = createContext({
        url: new URL("https://example.test/foo/"),
      });
      const options = {
        modulePath: "/project/pages/foo.tsx",
        projectId: scope.projectId,
        cacheScope: scope,
      };
      const pending = fetcher.fetchData(
        pageModule,
        context,
        "production",
        options,
      );

      try {
        await started;
        fetcher.clearCacheForRoute(scope, "/foo");
        releaseFirst();
        assertEquals(
          getProps<{ version: number }>(await pending).version,
          1,
        );

        const fresh = await fetcher.fetchData(
          pageModule,
          context,
          "production",
          options,
        );
        assertEquals(getProps<{ version: number }>(fresh).version, 2);
        assertEquals(calls, 2);
      } finally {
        releaseFirst();
        await Promise.allSettled([pending]);
        fetcher.destroy();
      }
    });

    it("should invalidate a load even when clear runs before its loader starts", async () => {
      await runWithCacheKeyContext(
        {
          projectId: "clear-before-loader",
          mode: "production",
          versionId: "rel_test",
        },
        async () => {
          const fetcher = new DataFetcher();
          let callCount = 0;
          const pageModule: PageWithData<{ version: number }> = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return { props: { version: callCount }, revalidate: 3600 };
            },
          };
          const context = createContext({
            url: new URL("http://localhost/clear-before-loader"),
          });
          const options = {
            modulePath: "/project/pages/clear-before-loader.tsx",
          };

          const pending = fetcher.fetchData(pageModule, context, "production", options);
          fetcher.clearCache();
          await pending;

          const next = await fetcher.fetchData(pageModule, context, "production", options);
          assertEquals(getProps<{ version: number }>(next).version, 2);
          assertEquals(callCount, 2);
        },
      );
    });

    it("should not let an older revalidation overwrite data loaded after a clear", async () => {
      await runWithCacheKeyContext(
        {
          projectId: "clear-revalidation-race",
          mode: "production",
          versionId: "rel_test",
        },
        async () => {
          const fetcher = new DataFetcher();
          let callCount = 0;
          let resolveRevalidation!: (result: DataResult<{ version: number }>) => void;
          const revalidation = new Promise<DataResult<{ version: number }>>((resolve) => {
            resolveRevalidation = resolve;
          });
          const pageModule: PageWithData<{ version: number }> = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              if (callCount === 2) return revalidation;
              return {
                props: { version: callCount },
                revalidate: callCount === 1 ? 0 : 3600,
              };
            },
          };
          const context = createContext({
            url: new URL("http://localhost/clear-revalidation-race"),
          });
          const options = {
            modulePath: "/project/pages/clear-revalidation-race.tsx",
          };

          await fetcher.fetchData(pageModule, context, "production", options);
          await new Promise((resolve) => setTimeout(resolve, 1));
          await fetcher.fetchData(pageModule, context, "production", options);
          for (let i = 0; i < 20 && callCount < 2; i++) {
            await Promise.resolve();
          }
          assertEquals(callCount, 2);

          fetcher.clearCache();
          const fresh = await fetcher.fetchData(pageModule, context, "production", options);
          assertEquals(getProps<{ version: number }>(fresh).version, 3);

          resolveRevalidation({ props: { version: 2 }, revalidate: 3600 });
          for (let i = 0; i < 20; i++) await Promise.resolve();

          const cached = await fetcher.fetchData(pageModule, context, "production", options);
          assertEquals(getProps<{ version: number }>(cached).version, 3);
          assertEquals(callCount, 3);
        },
      );
    });

    it("should preserve unrelated in-flight cache writes during a pattern clear", async () => {
      await runWithCacheKeyContext(
        {
          projectId: "pattern-clear-isolation",
          mode: "production",
          versionId: "rel_test",
        },
        async () => {
          const fetcher = new DataFetcher();
          let callCount = 0;
          let resolveLoad!: (result: DataResult<{ version: number }>) => void;
          const load = new Promise<DataResult<{ version: number }>>((resolve) => {
            resolveLoad = resolve;
          });
          const pageModule: PageWithData<{ version: number }> = {
            default: () => null,
            getStaticData: () => {
              callCount++;
              return load;
            },
          };
          const context = createContext({
            url: new URL("http://localhost/products/one"),
          });
          const options = { modulePath: "/project/pages/products.tsx" };

          const pending = fetcher.fetchData(pageModule, context, "production", options);
          for (let i = 0; i < 20 && callCount === 0; i++) {
            await Promise.resolve();
          }
          assertEquals(callCount, 1);

          fetcher.clearCache("/blog");
          resolveLoad({ props: { version: 1 }, revalidate: 3600 });
          await pending;

          const cached = await fetcher.fetchData(pageModule, context, "production", options);
          assertEquals(getProps<{ version: number }>(cached).version, 1);
          assertEquals(callCount, 1);
        },
      );
    });
  });

  describe("lifecycle", () => {
    it("destroys idempotently and rejects future work", async () => {
      const fetcher = new DataFetcher();
      fetcher.destroy();
      fetcher.destroy();
      fetcher.clearCache();
      fetcher.clearCacheForProject("project");

      await assertRejects(
        () =>
          fetcher.fetchData(
            { default: () => null },
            createContext(),
          ),
        Error,
        "destroyed",
      );
      await assertRejects(
        () => fetcher.getStaticPaths({ default: () => null }),
        Error,
        "destroyed",
      );
    });
  });

  describe("integration scenarios", () => {
    it("should handle page with all data functions", async () => {
      const fetcher = new DataFetcher();
      const pageModule: PageWithData<{ title: string }> = {
        default: () => null,
        getServerData: (ctx) => ({ props: { title: `Server: ${ctx.params.id}` } }),
        getStaticData: (ctx) => ({
          props: { title: `Static: ${ctx.params.id}` },
          revalidate: 60,
        }),
        getStaticPaths: () => ({
          paths: [{ params: { id: "1" } }, { params: { id: "2" } }],
          fallback: false,
        }),
      };

      const context = createContext({
        params: { id: "1" },
        url: new URL("http://localhost/posts/1"),
      });

      const devResult = await fetcher.fetchData(pageModule, context, "development");
      assertEquals(getProps<{ title: string }>(devResult).title, "Server: 1");

      const prodResult = await fetcher.fetchData(pageModule, context, "production");
      assertEquals(getProps<{ title: string }>(prodResult).title, "Static: 1");

      const paths = await fetcher.getStaticPaths(pageModule);
      assertEquals(paths?.paths.length, 2);
    });

    it("should pass full context to getServerData", async () => {
      const fetcher = new DataFetcher();
      let receivedContext: DataContext | undefined;

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: (ctx) => {
          receivedContext = ctx;
          return { props: {} };
        },
      };

      const context = createContext({
        params: { slug: "test" },
        query: new URLSearchParams("?sort=date"),
        request: new Request("http://localhost/posts/test?sort=date", {
          headers: { "X-Custom": "header" },
        }),
        url: new URL("http://localhost/posts/test?sort=date"),
      });

      await fetcher.fetchData(pageModule, context);

      assertExists(receivedContext);
      assertEquals(receivedContext.params.slug, "test");
      assertEquals(receivedContext.query.get("sort"), "date");
      assertExists(receivedContext.request);
      assertEquals(receivedContext.url.pathname, "/posts/test");
    });
  });
});
