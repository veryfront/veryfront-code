import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { VeryfrontApiClient } from "./client.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import type { VeryfrontAPIConfig } from "./types.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/index.ts";

const baseConfig = {
  apiBaseUrl: "http://test.api",
  apiToken: "config-token",
  projectSlug: "config-slug",
};

const originalFetch = globalThis.fetch;

function projectResponse(slug = "config-slug"): Response {
  return Response.json({
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Project",
    slug,
  });
}

function createClient(config: VeryfrontAPIConfig = baseConfig): VeryfrontApiClient {
  return new VeryfrontApiClient(config);
}

describe("VeryfrontApiClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetLogRecordEmitterForTests();
  });

  describe("token priority", () => {
    it("uses config token when no request token set", () => {
      const client = createClient();
      assertEquals(client.getToken(), "config-token");
    });

    it("request token takes priority over config token", () => {
      const client = createClient();
      client.setRequestToken("request-token");
      assertEquals(client.getToken(), "request-token");
    });

    it("clearRequestToken reverts to config token", () => {
      const client = createClient();
      client.setRequestToken("request-token");
      client.clearRequestToken();
      assertEquals(client.getToken(), "config-token");
    });

    it("rejects an empty explicit request token instead of using the config token", () => {
      const client = createClient();
      assertThrows(
        () => client.setRequestToken(""),
        VeryfrontError,
        "request token must be a non-empty string",
      );
      assertEquals(client.getToken(), "config-token");
    });

    it("throws when no token available", () => {
      const client = createClient({ apiBaseUrl: "http://test.api" });
      assertThrows(() => client.getToken(), VeryfrontError, "No API token available");
    });

    it("reads an immutable request-context token before mutable and static tokens", () => {
      let contextToken: string | undefined = "context-a";
      const client = createClient({
        ...baseConfig,
        requestTokenProvider: () => contextToken,
      });

      client.setRequestToken("mutable-token");
      assertEquals(client.getToken(), "context-a");

      contextToken = "context-b";
      assertEquals(client.getToken(), "context-b");

      contextToken = undefined;
      assertEquals(client.getToken(), "mutable-token");
    });

    it("rejects an invalid request-context token instead of using broader credentials", () => {
      const client = createClient({
        ...baseConfig,
        requestTokenProvider: () => "",
      });

      assertThrows(
        () => client.getToken(),
        VeryfrontError,
        "request-context token must be a non-empty string",
      );
    });

    it("sanitizes hostile request-provider failures", () => {
      const secret = "PRIVATE_REQUEST_PROVIDER_CANARY";
      const client = createClient({
        ...baseConfig,
        requestTokenProvider: () => {
          throw new Proxy(new Error(secret), {
            getPrototypeOf() {
              throw new Error(secret);
            },
          });
        },
      });

      let error: unknown;
      try {
        client.getToken();
      } catch (caught) {
        error = caught;
      }

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 401);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });
  });

  describe("configuration boundary", () => {
    it("treats proxy adapter empty sentinels as absent credentials", () => {
      const unscopedClient = createClient({
        apiBaseUrl: "http://test.api",
        apiToken: "",
        projectSlug: "",
        proxyMode: true,
      });
      assertThrows(
        () => unscopedClient.getToken(),
        VeryfrontError,
        "No API token available",
      );

      const scopedClient = createClient({
        apiBaseUrl: "http://test.api",
        apiToken: "",
        projectSlug: "",
        proxyMode: true,
        requestIdentityProvider: () => ({
          token: "request-token",
          projectSlug: "request-project",
        }),
      });
      assertEquals(scopedClient.getToken(), "request-token");
      assertEquals(scopedClient.getProjectSlug(), "request-project");
    });

    it("rejects unreadable configuration without exposing getter failures", () => {
      const secret = "PRIVATE_CONFIG_GETTER_CANARY";
      const config = Object.defineProperty({}, "apiBaseUrl", {
        get() {
          throw new Error(secret);
        },
      });

      let error: unknown;
      try {
        createClient(config as VeryfrontAPIConfig);
      } catch (caught) {
        error = caught;
      }

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 400);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });

    it("wraps revoked configuration proxies in a typed error", () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();

      let error: unknown;
      try {
        createClient(proxy as VeryfrontAPIConfig);
      } catch (caught) {
        error = caught;
      }

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 400);
    });

    it("applies the immutable configured request policy to high-level calls", async () => {
      let policyReads = 0;
      const requestPolicy = Object.defineProperty({}, "maxResponseBytes", {
        get() {
          policyReads++;
          return 4;
        },
      });
      globalThis.fetch = (() => Promise.resolve(projectResponse())) as typeof fetch;
      const client = createClient({
        ...baseConfig,
        requestPolicy,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      } as VeryfrontAPIConfig);

      const error = await assertRejects(() => client.getProject());

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 502);
      assertEquals(policyReads, 1);
    });
  });

  describe("project slug", () => {
    it("getProjectSlug returns config slug by default", () => {
      const client = createClient();
      assertEquals(client.getProjectSlug(), "config-slug");
    });

    it("request slug takes priority over config slug", () => {
      const client = createClient();
      client.setProjectSlug("request-slug");
      assertEquals(client.getProjectSlug(), "request-slug");
    });

    it("clearProjectSlug reverts to config slug", () => {
      const client = createClient();
      client.setProjectSlug("request-slug");
      client.clearProjectSlug();
      assertEquals(client.getProjectSlug(), "config-slug");
    });

    it("rejects an empty explicit request slug instead of using the config slug", () => {
      const client = createClient();
      assertThrows(
        () => client.setProjectSlug(""),
        VeryfrontError,
        "request project slug must be a non-empty string",
      );
      assertEquals(client.getProjectSlug(), "config-slug");
    });
  });

  describe("atomic request identity", () => {
    it("snapshots request identity properties exactly once", async () => {
      let fileContextReads = 0;
      const identity = {
        token: "request-token",
        projectSlug: "request-project",
        get fileContext() {
          fileContextReads++;
          if (fileContextReads > 1) throw new Error("PRIVATE_IDENTITY_GETTER_CANARY");
          return { type: "branch" as const, name: "feature" };
        },
      };
      globalThis.fetch =
        (() => Promise.resolve(projectResponse("request-project"))) as typeof fetch;
      const client = createClient({
        ...baseConfig,
        requestIdentityProvider: () => identity,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      const project = await client.getProject();

      assertEquals(project.slug, "request-project");
      assertEquals(fileContextReads, 1);
    });

    it("keeps each concurrent request token paired with its project", async () => {
      interface TestIdentity {
        token: string;
        projectSlug: string;
        fileContext: { type: "branch"; name: string };
      }

      const requestIdentity = new AsyncLocalStorage<TestIdentity>();
      let releaseFirstSetter!: () => void;
      let releaseSecondSetter!: () => void;
      const firstSetterDone = new Promise<void>((resolve) => {
        releaseFirstSetter = resolve;
      });
      const secondSetterDone = new Promise<void>((resolve) => {
        releaseSecondSetter = resolve;
      });
      const requests: string[] = [];
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const authorization = new Headers(init?.headers).get("Authorization");
        requests.push(`${authorization}:${url.pathname}`);
        const slug = url.pathname.split("/").at(-1) ?? "";
        return Promise.resolve(projectResponse(slug));
      }) as typeof fetch;

      const client = createClient({
        ...baseConfig,
        requestTokenProvider: () => requestIdentity.getStore()?.token,
        requestIdentityProvider: () => requestIdentity.getStore(),
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      const requestA = requestIdentity.run(
        { token: "token-a", projectSlug: "project-a", fileContext: { type: "branch", name: "a" } },
        async () => {
          client.setProjectSlug("project-a");
          releaseFirstSetter();
          await secondSetterDone;
          return await client.getProject();
        },
      );
      const requestB = requestIdentity.run(
        { token: "token-b", projectSlug: "project-b", fileContext: { type: "branch", name: "b" } },
        async () => {
          await firstSetterDone;
          client.setProjectSlug("project-b");
          releaseSecondSetter();
          return await client.getProject();
        },
      );

      const [projectA, projectB] = await Promise.all([requestA, requestB]);

      assertEquals([projectA.slug, projectB.slug], ["project-a", "project-b"]);
      assertEquals(requests.sort(), [
        "Bearer token-a:/projects/project-a",
        "Bearer token-b:/projects/project-b",
      ]);
    });

    it("uses the request snapshot for branch, environment, and release file operations", async () => {
      type TestFileContext =
        | { type: "branch"; name: string }
        | { type: "environment"; name: string }
        | { type: "release"; version: string };
      interface TestIdentity {
        token: string;
        projectSlug: string;
        fileContext: TestFileContext;
      }

      let activeIdentity: TestIdentity = {
        token: "request-token",
        projectSlug: "request-project",
        fileContext: { type: "branch", name: "feature" },
      };
      let identityReads = 0;
      const requests: string[] = [];
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        requests.push(
          `${new Headers(init?.headers).get("Authorization")}:${url.pathname}${url.search}`,
        );
        if (url.pathname.includes("/environments/")) {
          return Promise.resolve(Response.json({
            id: "file-id",
            version_id: "version-id",
            path: "page.ts",
            content: "",
            type: "file",
            size: 0,
            updated_at: "2026-07-18T00:00:00.000Z",
            environment_id: "environment-id",
            environment_name: "preview",
            release_id: "release-id",
            release_version: "1",
          }));
        }
        if (url.pathname.includes("/releases/")) {
          return Promise.resolve(Response.json({
            id: "file-id",
            version_id: "version-id",
            path: "page.ts",
            content: "",
            type: "file",
            size: 0,
            updated_at: "2026-07-18T00:00:00.000Z",
            release_id: "release-id",
            release_version: "1",
          }));
        }
        return Promise.resolve(Response.json({
          id: "file-id",
          path: "page.ts",
          content: "",
          type: "file",
          size: 0,
          updated_at: "2026-07-18T00:00:00.000Z",
        }));
      }) as typeof fetch;
      const client = createClient({
        ...baseConfig,
        requestIdentityProvider: () => {
          identityReads++;
          return activeIdentity;
        },
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });
      client.setProjectSlug("mutable-project");
      client.setContext({ type: "branch", name: "mutable-branch" });

      await client.getFile("page.ts");
      activeIdentity = {
        token: "request-token",
        projectSlug: "request-project",
        fileContext: { type: "environment", name: "preview" },
      };
      await client.getFile("page.ts");
      activeIdentity = {
        token: "request-token",
        projectSlug: "request-project",
        fileContext: { type: "release", version: "release-id" },
      };
      await client.getFile("page.ts");

      assertEquals(identityReads, 3);
      assertEquals(requests, [
        "Bearer request-token:/projects/request-project/files/page.ts?branch=feature&include_server_functions=true",
        "Bearer request-token:/projects/request-project/environments/preview/files/page.ts?include_server_functions=true",
        "Bearer request-token:/projects/request-project/releases/release-id/files/page.ts?include_server_functions=true",
      ]);
    });
  });

  describe("branch", () => {
    it("getRequestBranch returns undefined by default", () => {
      const client = createClient();
      assertEquals(client.getRequestBranch(), undefined);
    });

    it("setRequestBranch sets branch", () => {
      const client = createClient();
      client.setRequestBranch("feature-x");
      assertEquals(client.getRequestBranch(), "feature-x");
    });

    it("setRequestBranch accepts null for main branch", () => {
      const client = createClient();
      client.setRequestBranch(null);
      assertEquals(client.getRequestBranch(), null);
    });

    it("clearRequestBranch reverts to undefined", () => {
      const client = createClient();
      client.setRequestBranch("feature-x");
      client.clearRequestBranch();
      assertEquals(client.getRequestBranch(), undefined);
    });
  });

  describe("proxy mode", () => {
    it("isProxyMode returns false by default", () => {
      const client = createClient();
      assertEquals(client.isProxyMode(), false);
    });

    it("isProxyMode returns true when configured", () => {
      const client = createClient({ ...baseConfig, proxyMode: true });
      assertEquals(client.isProxyMode(), true);
    });
  });

  describe("initialization state", () => {
    it("isInitialized returns false before initialization", () => {
      const client = createClient();
      assertEquals(client.isInitialized(), false);
    });

    it("reset clears initialization state", () => {
      const client = createClient({ ...baseConfig, projectId: "test-id" });
      assertEquals(client.isInitialized(), false);
      client.reset();
      assertEquals(client.isInitialized(), false);
    });

    it("initialize throws when no slug available", async () => {
      const client = createClient({ apiBaseUrl: "http://test.api", apiToken: "token" });
      await assertRejects(
        () => client.initialize(),
        VeryfrontError,
        "No project slug available",
      );
    });
  });

  describe("retry config", () => {
    it("uses default retry config", () => {
      const client = createClient({ apiBaseUrl: "http://test.api" });
      assertEquals(client.isProxyMode(), false);
    });

    it("accepts custom retry config", () => {
      const client = createClient({
        apiBaseUrl: "http://test.api",
        retry: { maxRetries: 5, initialDelay: 100, maxDelay: 1000 },
      });
      assertEquals(client.isProxyMode(), false);
    });

    it("rejects invalid retry config during construction", () => {
      assertThrows(
        () =>
          createClient({
            ...baseConfig,
            retry: { maxRetries: -1 },
          }),
        VeryfrontError,
        "maxRetries",
      );
    });
  });

  describe("search", () => {
    it("sanitizes unreadable extension-priority inputs before fetch", async () => {
      const secret = "PRIVATE_EXTENSION_GETTER_CANARY";
      let fetchCallCount = 0;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return Promise.resolve(Response.json({ data: [] }));
      }) as typeof fetch;
      const extensions = new Proxy([".ts"], {
        get(target, property, receiver) {
          if (property === "0") throw new Error(secret);
          return Reflect.get(target, property, receiver);
        },
      });

      const error = await assertRejects(() =>
        createClient().resolveFileWithExtension("file", extensions)
      );

      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 400);
      assertEquals(fetchCallCount, 0);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });

    it("searchFiles follows pagination instead of truncating at one page", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = ((input: RequestInfo | URL) => {
        fetchCallCount++;
        const url = new URL(String(input));
        const cursor = url.searchParams.get("cursor");
        return Promise.resolve(Response.json({
          data: [{
            path: cursor ? "second.ts" : "first.ts",
            content: "export {};",
            size: 10,
            type: "file",
            updated_at: "2026-07-18T00:00:00.000Z",
          }],
          page_info: {
            self: null,
            first: null,
            next: cursor ? null : "second-page",
            prev: null,
          },
        }));
      }) as typeof fetch;

      const files = await createClient({
        ...baseConfig,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      }).searchFiles("*.ts");

      assertEquals(files, [
        { id: undefined, path: "first.ts" },
        { id: undefined, path: "second.ts" },
      ]);
      assertEquals(fetchCallCount, 2);
    });

    it("searchFilesWithContent preserves empty files without a detail request", async () => {
      let detailRequestCount = 0;
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/files")) {
          return Promise.resolve(Response.json({
            data: [{
              path: "private.ts",
              content: "",
              size: 10,
              type: "file",
              updated_at: "2026-07-18T00:00:00.000Z",
            }],
            page_info: { self: null, first: null, next: null, prev: null },
          }));
        }
        detailRequestCount++;
        return Promise.resolve(new Response(null, { status: 401 }));
      }) as typeof fetch;

      const files = await createClient({
        ...baseConfig,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      }).searchFilesWithContent("*.ts");

      assertEquals(files, [{ path: "private.ts", content: "" }]);
      assertEquals(detailRequestCount, 0);
    });

    it("searchFilesWithContent does not fabricate content for an incomplete result", async () => {
      const client = createClient();
      client.listAllFiles = () =>
        Promise.resolve([{
          path: "incomplete.ts",
          size: 1,
          type: "file",
          updated_at: "2026-07-18T00:00:00.000Z",
        }]);

      await assertRejects(
        () => client.searchFilesWithContent("*.ts"),
        VeryfrontError,
        "without content",
      );
    });
  });

  describe("context management", () => {
    it("default context should be branch main", () => {
      const client = createClient();
      const ctx = client.getContext();
      assertEquals(ctx.type, "branch");
      assertEquals((ctx as { name: string }).name, "main");
    });

    it("setContext should update context", () => {
      const client = createClient();
      client.setContext({ type: "environment", name: "production" });
      const ctx = client.getContext();
      assertEquals(ctx.type, "environment");
      assertEquals((ctx as { name: string }).name, "production");
    });

    it("clearContext should revert to default", () => {
      const client = createClient();
      client.setContext({ type: "environment", name: "staging" });
      client.clearContext();
      const ctx = client.getContext();
      assertEquals(ctx.type, "branch");
      assertEquals((ctx as { name: string }).name, "main");
    });

    it("setContext with release type", () => {
      const client = createClient();
      client.setContext({ type: "release", version: "v1.0.0" });
      const ctx = client.getContext();
      assertEquals(ctx.type, "release");
      assertEquals((ctx as { version: string }).version, "v1.0.0");
    });
  });

  describe("setRequestBranch context integration", () => {
    it("setRequestBranch with null should clear context", () => {
      const client = createClient();
      client.setRequestBranch("feature-x");
      client.setRequestBranch(null);
      assertEquals(client.getRequestBranch(), null);
      const ctx = client.getContext();
      assertEquals(ctx.type, "branch");
      assertEquals((ctx as { name: string }).name, "main");
    });

    it("setRequestBranch should set branch context", () => {
      const client = createClient();
      client.setRequestBranch("feature-y");
      const ctx = client.getContext();
      assertEquals(ctx.type, "branch");
      assertEquals((ctx as { name: string }).name, "feature-y");
    });

    it("clearRequestBranch should clear both branch and context", () => {
      const client = createClient();
      client.setRequestBranch("feature-z");
      client.clearRequestBranch();
      assertEquals(client.getRequestBranch(), undefined);
      const ctx = client.getContext();
      assertEquals(ctx.type, "branch");
      assertEquals((ctx as { name: string }).name, "main");
    });
  });

  describe("initialize with projectId in config", () => {
    it("should set initialized=true without API call", async () => {
      const client = createClient({ ...baseConfig, projectId: "test-id" });
      await client.initialize();
      assertEquals(client.isInitialized(), true);
      assertEquals(client.getProjectId(), "test-id");
    });

    it("concurrent initialize() calls should only initialize once", async () => {
      const client = createClient({ ...baseConfig, projectId: "test-id" });
      await Promise.all([client.initialize(), client.initialize()]);
      assertEquals(client.isInitialized(), true);
    });

    it("initialize() when already initialized should return immediately", async () => {
      const client = createClient({ ...baseConfig, projectId: "test-id" });
      await client.initialize();
      await client.initialize();
      assertEquals(client.isInitialized(), true);
    });

    it("does not write project references or IDs to initialization logs", async () => {
      const projectSlugCanary = "PRIVATE_PROJECT_SLUG_CANARY";
      const configuredIdCanary = "PRIVATE_PROJECT_ID_CANARY";
      const fetchedIdCanary = "11111111-2222-4333-8444-555555555555";
      const entries: LogEntry[] = [];
      const previousLogLevel = Deno.env.get("LOG_LEVEL");
      const originalDebug = console.debug;
      Deno.env.set("LOG_LEVEL", "DEBUG");
      __resetLoggerConfigForTests();
      console.debug = () => {};
      __registerLogRecordEmitter((entry) => entries.push(entry));
      globalThis.fetch = (() =>
        Promise.resolve(Response.json({
          id: fetchedIdCanary,
          name: "Project",
          slug: projectSlugCanary,
        }))) as typeof fetch;

      try {
        await createClient({
          ...baseConfig,
          projectSlug: projectSlugCanary,
          projectId: configuredIdCanary,
        }).initialize();
        await createClient({
          ...baseConfig,
          projectSlug: projectSlugCanary,
        }).initialize();
      } finally {
        console.debug = originalDebug;
        if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLogLevel);
        __resetLoggerConfigForTests();
      }

      const emitted = JSON.stringify(entries);
      for (const canary of [projectSlugCanary, configuredIdCanary, fetchedIdCanary]) {
        assertEquals(emitted.includes(canary), false);
      }
      assertEquals(emitted.includes("initialization"), true);
    });
  });

  describe("request-scoped initialization", () => {
    it("does not coalesce callers that use distinct request policies", async () => {
      let fetchCallCount = 0;
      let resolveFirst: ((response: Response) => void) | undefined;
      globalThis.fetch = (() => {
        fetchCallCount++;
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }) as typeof fetch;
      const client = createClient({
        ...baseConfig,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      const first = client.initializeProject();
      await Promise.resolve();
      const controller = new AbortController();
      controller.abort();
      const secondError = assertRejects(() =>
        client.initializeProject({ signal: controller.signal })
      );
      resolveFirst?.(projectResponse());

      await first;
      const error = await secondError;
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 499);
      assertEquals(fetchCallCount, 1);
    });

    it("does not coalesce callers that use different request tokens", async () => {
      let activeToken = "request-token-a";
      let resolveFirst: ((response: Response) => void) | undefined;
      const authorizationHeaders: string[] = [];
      globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("Authorization") ?? "";
        authorizationHeaders.push(authorization);
        if (authorization === "Bearer request-token-a") {
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(new Response(null, { status: 403 }));
      }) as typeof fetch;
      const client = createClient({
        apiBaseUrl: baseConfig.apiBaseUrl,
        projectSlug: baseConfig.projectSlug,
        requestTokenProvider: () => activeToken,
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      const first = client.initialize();
      await Promise.resolve();
      activeToken = "request-token-b";
      const secondError = assertRejects(() => client.initialize());
      await Promise.resolve();
      resolveFirst?.(projectResponse());

      await first;
      const error = await secondError;
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.status, 403);
      assertEquals(authorizationHeaders, [
        "Bearer request-token-a",
        "Bearer request-token-b",
      ]);
      assertEquals(client.getCachedProject(), undefined);
    });

    it("does not publish request-scoped project state to the shared client", async () => {
      globalThis.fetch =
        (() => Promise.resolve(projectResponse("request-project"))) as typeof fetch;
      const client = createClient({
        apiBaseUrl: baseConfig.apiBaseUrl,
        requestIdentityProvider: () => ({
          token: "request-token",
          projectSlug: "request-project",
          fileContext: { type: "branch", name: "main" },
        }),
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      await client.initialize();

      assertEquals(client.isInitialized(), false);
      assertEquals(client.getCachedProject(), undefined);
      assertThrows(() => client.getProjectId(), VeryfrontError, "not initialized");
    });

    it("returns request-scoped project data without publishing it", async () => {
      globalThis.fetch =
        (() => Promise.resolve(projectResponse("request-project"))) as typeof fetch;
      const client = createClient({
        apiBaseUrl: baseConfig.apiBaseUrl,
        requestTokenProvider: () => "request-token",
        projectSlug: "request-project",
        retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
      });

      const result = await client.initializeProject();

      assertEquals(result.projectId, "550e8400-e29b-41d4-a716-446655440000");
      assertEquals(result.project?.slug, "request-project");
      assertEquals(result.requestScoped, true);
      assertEquals(client.isInitialized(), false);
      assertThrows(() => client.getProjectId(), VeryfrontError, "not initialized");
    });
  });

  describe("reset", () => {
    it("should clear initialized state", async () => {
      const client = createClient({ ...baseConfig, projectId: "test-id" });
      await client.initialize();
      assertEquals(client.isInitialized(), true);
      client.reset();
      assertEquals(client.isInitialized(), false);
    });

    it("clears cached project identity", async () => {
      globalThis.fetch = (() => Promise.resolve(projectResponse())) as typeof fetch;
      const client = createClient();
      await client.initialize();
      assertEquals(client.getCachedProject()?.slug, "config-slug");

      client.reset();

      assertEquals(client.getCachedProject(), undefined);
      assertThrows(() => client.getProjectId(), VeryfrontError, "not initialized");
    });

    it("is not undone by an initialization that finishes later", async () => {
      let resolveFetch: ((response: Response) => void) | undefined;
      globalThis.fetch = (() =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })) as typeof fetch;
      const client = createClient();

      const initialization = client.initialize();
      await Promise.resolve();
      client.reset();
      resolveFetch?.(projectResponse());
      await initialization;

      assertEquals(client.isInitialized(), false);
      assertEquals(client.getCachedProject(), undefined);
      assertThrows(() => client.getProjectId(), VeryfrontError, "not initialized");
    });

    it("invalidates project identity when the project slug changes", async () => {
      const client = createClient({ ...baseConfig, projectId: "project-a" });
      await client.initialize();

      client.setProjectSlug("project-b");

      assertEquals(client.isInitialized(), false);
      assertThrows(() => client.getProjectId(), VeryfrontError, "not initialized");
    });

    it("does not reuse a configured project ID after switching slugs", async () => {
      let requestedUrl = "";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return Promise.resolve(Response.json({
          id: "660e8400-e29b-41d4-a716-446655440000",
          name: "Project B",
          slug: "project-b",
        }));
      }) as typeof fetch;
      const client = createClient({ ...baseConfig, projectId: "project-a" });
      await client.initialize();

      client.setProjectSlug("project-b");
      await client.initialize();

      assertStringIncludes(requestedUrl, "/projects/project-b");
      assertEquals(client.getProjectId(), "660e8400-e29b-41d4-a716-446655440000");
      assertEquals(client.getCachedProject()?.slug, "project-b");
    });
  });

  describe("getCachedProject", () => {
    it("returns undefined before init", () => {
      const client = createClient();
      assertEquals(client.getCachedProject(), undefined);
    });

    it("returns undefined when projectId provided in config", async () => {
      const client = createClient({ ...baseConfig, projectId: "test-id" });
      await client.initialize();
      assertEquals(client.getCachedProject(), undefined);
    });
  });

  describe("published content guards", () => {
    it("throws when listPublishedFiles called without releaseId or environmentName", () => {
      const client = createClient();
      assertThrows(
        () => client.listPublishedFiles(undefined, undefined, undefined),
        VeryfrontError,
        "Cannot list published files without releaseId or environmentName",
      );
    });

    it("rejects when getPublishedFileContent called without releaseId or environmentName", async () => {
      const client = createClient();
      await assertRejects(
        () => client.getPublishedFileContent("pages/index.mdx"),
        VeryfrontError,
        "Cannot fetch published file without releaseId or environmentName",
      );
    });
  });
});
