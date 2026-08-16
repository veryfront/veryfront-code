import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { __resolveDataWorkerIdentityForTests, ServerDataFetcher } from "./server-data-fetcher.ts";
import type { DataContext, DataResult, PageWithData } from "./types.ts";
import { notFound, redirect } from "./helpers.ts";
import { __resetPoolForTests } from "#veryfront/security/sandbox/worker-pool.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { join } from "node:path";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";

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
    it("rejects remote raw server-data execution before project code runs", async () => {
      const fetcher = new ServerDataFetcher();
      let executed = false;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          executed = true;
          return { props: {} };
        },
      };

      await assertRejects(
        () =>
          fetcher.fetch(pageModule, createContext(), {
            isLocalProject: false,
            modulePath: "/tenant/page.ts",
            projectDir: "/tenant",
          }),
        Error,
        "Remote server-data execution requires",
      );
      assertEquals(executed, false);
    });

    it("allows server-data execution in an explicitly capable dedicated runtime", async () => {
      const fetcher = new ServerDataFetcher();
      let executed = false;
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          executed = true;
          return { props: { source: "dedicated" } };
        },
      };

      const result = await fetcher.fetch(pageModule, createContext(), {
        isLocalProject: false,
        allowHostProjectCodeExecution: true,
      });

      assertEquals(result.props, { source: "dedicated" });
      assertEquals(executed, true);
    });

    it("binds reusable data workers to tenant, source, policy, and project env", async () => {
      const identity = (
        workerScope: string,
        sourceGeneration: string,
        policy: Parameters<typeof runWithExactSourceIntegrationPolicy>[0],
        projectEnv: Record<string, string>,
      ) =>
        runWithProjectEnv(
          projectEnv,
          () =>
            runWithExactSourceIntegrationPolicy(policy, () =>
              __resolveDataWorkerIdentityForTests({
                workerScope,
                sourceGeneration,
              })),
        );

      const unrestricted = { schemaVersion: 1, mode: "unrestricted" } as const;
      const denyAll = {
        schemaVersion: 1,
        mode: "allowlist",
        integrations: {},
      } as const;
      const baseline = await identity("tenant-a", "release-a", unrestricted, {
        TENANT_SECRET: "one",
      });
      const same = await identity("tenant-a", "release-a", unrestricted, {
        TENANT_SECRET: "one",
      });
      const changedTenant = await identity("tenant-b", "release-a", unrestricted, {
        TENANT_SECRET: "one",
      });
      const changedSource = await identity("tenant-a", "release-b", unrestricted, {
        TENANT_SECRET: "one",
      });
      const changedPolicy = await identity("tenant-a", "release-a", denyAll, {
        TENANT_SECRET: "one",
      });
      const changedEnv = await identity("tenant-a", "release-a", unrestricted, {
        TENANT_SECRET: "two",
      });

      assertEquals(baseline.reusable, true);
      assertEquals(same.workerId, baseline.workerId);
      assertEquals(changedTenant.workerId === baseline.workerId, false);
      assertEquals(changedSource.workerId === baseline.workerId, false);
      assertEquals(changedPolicy.workerId === baseline.workerId, false);
      assertEquals(changedEnv.workerId === baseline.workerId, false);
    });

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

    it("preserves response metadata returned from getServerData", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: (): DataResult => ({
          props: { ok: true },
          headers: { "x-page-state": "fresh" },
          cookies: [{
            name: "session",
            value: "abc",
            path: "/",
            httpOnly: true,
            sameSite: "lax",
          }],
        }),
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.headers, { "x-page-state": "fresh" });
      assertEquals(result.cookies, [{
        name: "session",
        value: "abc",
        path: "/",
        httpOnly: true,
        sameSite: "lax",
      }]);
    });

    it("rejects framework-owned headers from getServerData", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({
          props: {},
          headers: { "set-cookie": "session=unsafe" },
        } as DataResult & { headers: Record<string, string> }),
      };

      await assertRejects(
        () => fetcher.fetch(pageModule, createContext()),
        TypeError,
        'getServerData cannot set framework-owned response header "set-cookie"',
      );
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
    afterEach(() => {
      try {
        Deno.env.delete("WORKER_ISOLATION_ENABLED");
      } catch { /* ok */ }
      try {
        Deno.env.delete("WORKER_ISOLATION_DATA");
      } catch { /* ok */ }
      __resetPoolForTests();
    });

    it("should reject oversized request bodies in isolated data fetch", async () => {
      // Enable data isolation
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      __resetPoolForTests();

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

      await assertRejects(
        () =>
          fetcher.fetch(
            pageModule,
            createContext({ request }),
            { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
          ),
        Error,
        "exceeds size limit",
      );
    });

    it("should reject via Content-Length header before buffering", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      __resetPoolForTests();

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
          fetcher.fetch(
            pageModule,
            createContext({ request }),
            { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
          ),
        Error,
        "exceeds size limit",
      );
    });

    it("should bound chunked bodies while streaming and cancel the source", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      __resetPoolForTests();

      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: {} }),
      };
      const chunk = new Uint8Array(6 * 1024 * 1024);
      let cancelled = false;
      const request = new Request("http://localhost/test", {
        method: "POST",
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        }),
      });

      await assertRejects(
        () =>
          fetcher.fetch(
            pageModule,
            createContext({ request }),
            { modulePath: "/tmp/test/page.ts", projectDir: "/tmp/test" },
          ),
        Error,
        "exceeds size limit",
      );
      assertEquals(cancelled, true);
    });

    it("should skip body size guard when request has no body", async () => {
      Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
      Deno.env.set("WORKER_ISOLATION_DATA", "1");
      __resetPoolForTests();

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

    it("preserves response metadata from a thrown redirect()", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw redirect("/account", false, {
            headers: { "x-auth-result": "signed-in" },
            cookies: [{ name: "session", value: "abc", path: "/" }],
          });
        },
      };

      const result = await fetcher.fetch(pageModule, createContext());

      assertEquals(result.headers, { "x-auth-result": "signed-in" });
      assertEquals(result.cookies, [{ name: "session", value: "abc", path: "/" }]);
    });

    it("still propagates a genuine Error", async () => {
      const fetcher = new ServerDataFetcher();
      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw new Error("intentional test error from getServerData");
        },
      };

      // Own project id so this gets a fresh circuit breaker, unaffected by the
      // failures other tests in this file record against the default one.
      const context = createContext({
        request: new Request("http://localhost/test", {
          headers: { "x-project-id": "thrown-control-results" },
        }),
      });

      await assertRejects(
        () => fetcher.fetch(pageModule, context),
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
      const context = createContext({
        request: new Request("http://localhost/test", {
          headers: { "x-project-id": "repeated-not-found" },
        }),
      });

      const notFoundPage: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw notFound();
        },
      };

      // The breaker's failureThreshold is 5, so the sixth call is the one that
      // used to fail fast.
      for (let i = 0; i < 6; i++) {
        const result = await fetcher.fetch(notFoundPage, context);
        assertEquals(result.notFound, true, `call ${i + 1} should still reach getServerData`);
      }

      // An unrelated route on the same project still works.
      const okPage: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: { ok: true } }),
      };

      const result = await fetcher.fetch(okPage, context);
      assertEquals(result.props, { ok: true });
    });

    it("does not open the circuit breaker on repeated redirects", async () => {
      const fetcher = new ServerDataFetcher();
      const context = createContext({
        request: new Request("http://localhost/test", {
          headers: { "x-project-id": "repeated-redirect" },
        }),
      });

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw redirect("/login");
        },
      };

      for (let i = 0; i < 6; i++) {
        const result = await fetcher.fetch(pageModule, context);
        assertEquals(result.redirect?.destination, "/login", `call ${i + 1} should still redirect`);
      }
    });

    it("keeps marked prefetch failures out of the foreground circuit breaker", async () => {
      const fetcher = new ServerDataFetcher();
      const projectId = `prefetch-breaker-isolation-${crypto.randomUUID()}`;
      const prefetchContext = createContext({
        request: new Request("http://localhost/test", {
          headers: {
            "x-project-id": projectId,
            "x-veryfront-prefetch": "1",
          },
        }),
      });
      const foregroundContext = createContext({
        request: new Request("http://localhost/test", {
          headers: { "x-project-id": projectId },
        }),
      });

      const failingPage: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw new Error("intentional prefetch failure");
        },
      };

      for (let i = 0; i < 5; i++) {
        await assertRejects(() => fetcher.fetch(failingPage, prefetchContext));
      }

      const okPage: PageWithData = {
        default: () => null,
        getServerData: () => ({ props: { ok: true } }),
      };

      const result = await fetcher.fetch(okPage, foregroundContext);
      assertEquals(result.props, { ok: true });
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
        __resetPoolForTests();

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
        __resetPoolForTests();

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
        context: DataContext = createContext(),
      ): Promise<DataResult> {
        const fetcher = new ServerDataFetcher();
        const pageModule: PageWithData = {
          default: () => null,
          getServerData: () => ({ props: {} }),
        };

        return runWithExactSourceIntegrationPolicy(
          { schemaVersion: 1, mode: "unrestricted" },
          () =>
            fetcher.fetch(pageModule, context, {
              modulePath,
              projectDir: dir,
              isLocalProject: true,
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
             const result = {
               redirect: { destination: "/login", permanent: true },
               headers: { "x-auth-result": "signed-in" },
               cookies: [{ name: "session", value: "abc", path: "/" }],
             };
             ${BRAND_SOURCE}
             throw result;
           }
           export default function Page() { return null; }`,
        );

        const result = await isolatedFetch(modulePath, dir);

        assertEquals(result.redirect?.destination, "/login");
        assertEquals(result.redirect?.permanent, true);
        assertEquals(result.notFound, undefined);
        assertEquals(result.headers, { "x-auth-result": "signed-in" });
        assertEquals(result.cookies, [{ name: "session", value: "abc", path: "/" }]);
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

      it("does not expose infrastructure headers to isolated server-data hooks", async () => {
        const { modulePath, projectDir: dir } = await writeIsolatedPage(
          `export function getServerData(context) {
             return {
               props: {
                 authorization: context.request.headers.get("authorization"),
                 projectId: context.request.headers.get("x-project-id"),
                 token: context.request.headers.get("x-token"),
                 veryfront: context.request.headers.get("x-veryfront-release-id"),
               },
             };
           }
           export default function Page() { return null; }`,
        );
        const request = new Request("http://localhost/test", {
          headers: {
            authorization: "Bearer application-user",
            "x-project-id": "tenant-42",
            "x-token": "platform-secret",
            "x-veryfront-release-id": "release-secret",
          },
        });

        const result = await isolatedFetch(
          modulePath,
          dir,
          createContext({ request }),
        );

        assertEquals(result.props, {
          authorization: "Bearer application-user",
          projectId: null,
          token: null,
          veryfront: null,
        });
      });
    });

    it("still opens the circuit breaker on repeated genuine errors", async () => {
      const fetcher = new ServerDataFetcher();
      const context = createContext({
        request: new Request("http://localhost/test", {
          headers: { "x-project-id": "repeated-genuine-errors" },
        }),
      });

      const pageModule: PageWithData = {
        default: () => null,
        getServerData: () => {
          throw new Error("intentional test error from getServerData");
        },
      };

      for (let i = 0; i < 5; i++) {
        await assertRejects(() => fetcher.fetch(pageModule, context));
      }

      // The sixth call fails fast rather than running the handler again.
      await assertRejects(
        () => fetcher.fetch(pageModule, context),
        Error,
        "Circuit breaker",
      );
    });
  });
});
