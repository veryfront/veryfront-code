import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontApiClient } from "./client.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { MAX_VERYFRONT_API_RETRIES } from "#veryfront/utils/config-resource-limits.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { VeryfrontAPIConfig } from "./types.ts";

const baseConfig: VeryfrontAPIConfig = {
  apiBaseUrl: "http://test.api",
  apiToken: "config-token",
  projectSlug: "config-slug",
};

function createClient(config: VeryfrontAPIConfig = baseConfig): VeryfrontApiClient {
  return new VeryfrontApiClient(config);
}

describe("VeryfrontApiClient", () => {
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

    it("throws when no token available", () => {
      const client = createClient({ apiBaseUrl: "http://test.api" });
      assertThrows(() => client.getToken(), VeryfrontError, "No API token available");
    });

    it("keeps an injected request credential provider exclusive", () => {
      const client = new VeryfrontApiClient(
        baseConfig,
        () => "immutable-request-token",
      );

      assertEquals(client.getToken(), "immutable-request-token");
      assertThrows(
        () => client.setRequestToken("replacement-token"),
        VeryfrontError,
        "Cannot mutate",
      );
      assertThrows(
        () => client.clearRequestToken(),
        VeryfrontError,
        "Cannot clear",
      );
      assertEquals(client.getToken(), "immutable-request-token");
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

    it("rejects blank project slugs", () => {
      const client = createClient();
      assertThrows(
        () => client.setProjectSlug(" \t "),
        VeryfrontError,
        "non-empty string",
      );
      assertEquals(client.getProjectSlug(), "config-slug");
    });

    it("setting the already-effective slug preserves initialized state", async () => {
      const client = createClient({ ...baseConfig, projectId: "test-id" });
      await client.initialize();
      client.setProjectSlug("config-slug");
      assertEquals(client.isInitialized(), true);
      assertEquals(client.getProjectId(), "test-id");
    });

    it("does not reuse a configured project ID for a different request slug", async () => {
      let requests = 0;
      await withMockFetch(
        () => {
          requests++;
          return Promise.resolve(Response.json({
            id: "00000000-0000-4000-a000-000000000002",
            name: "Project B",
            slug: "project-b",
          }));
        },
        async () => {
          const client = createClient({ ...baseConfig, projectId: "project-a-id" });
          client.setProjectSlug("project-b");
          await client.initialize();
          assertEquals(requests, 1);
          assertEquals(client.getProjectId(), "00000000-0000-4000-a000-000000000002");
        },
      );
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

    it("accepts the ten-total-attempt and portable timer boundary", () => {
      const client = createClient({
        apiBaseUrl: "http://test.api",
        retry: {
          maxRetries: MAX_VERYFRONT_API_RETRIES,
          initialDelay: MAX_TIMER_DELAY_MS,
          maxDelay: MAX_TIMER_DELAY_MS,
        },
      });
      assertEquals(client.isProxyMode(), false);
    });

    it("rejects invalid retry counts, delays, and delay ranges at construction", () => {
      for (
        const retry of [
          { maxRetries: -1 },
          { maxRetries: 0.5 },
          { maxRetries: Number.NaN },
          { maxRetries: Number.POSITIVE_INFINITY },
          { maxRetries: Number.MAX_SAFE_INTEGER },
          { initialDelay: -1 },
          { initialDelay: 0.5 },
          { maxDelay: Number.NaN },
          { maxDelay: Number.POSITIVE_INFINITY },
          { maxDelay: MAX_TIMER_DELAY_MS + 1 },
          { initialDelay: 2, maxDelay: 1 },
        ]
      ) {
        assertThrows(
          () => createClient({ apiBaseUrl: "http://test.api", retry }),
          RangeError,
        );
      }
    });
  });

  describe("searchFilesWithContent", () => {
    it("should expose searchFilesWithContent method for pattern-based file search", () => {
      const client = createClient();
      // searchFilesWithContent uses limit: 100 (up from 20) to support projects
      // with many files (e.g., 138 XML files) that would otherwise cause
      // excessive cache misses and individual API round-trips.
      assertEquals(typeof client.searchFilesWithContent, "function");
    });

    it("searches every result page and preserves empty file content", async () => {
      let requests = 0;
      await withMockFetch(
        (input) => {
          requests++;
          const cursor = new URL(String(input)).searchParams.get("cursor");
          return Promise.resolve(Response.json({
            data: [{
              path: cursor ? "second.ts" : "empty.ts",
              content: cursor ? "export {};" : "",
              size: cursor ? 10 : 0,
              type: "file",
              updated_at: "2026-07-26T00:00:00.000Z",
            }],
            page_info: {
              self: null,
              first: null,
              next: cursor ? null : "second-page",
              prev: null,
            },
          }));
        },
        async () => {
          const files = await createClient().searchFilesWithContent("*.ts");
          assertEquals(files, [
            { path: "empty.ts", content: "" },
            { path: "second.ts", content: "export {};" },
          ]);
          assertEquals(requests, 2);
        },
      );
    });

    it("propagates content-fetch failures instead of returning partial results", async () => {
      const client = createClient();
      const mutable = client as unknown as {
        listAllFiles: () => Promise<
          Array<{
            path: string;
            content?: string;
            size: number;
            type: "file";
            updated_at: string;
          }>
        >;
        getOptionalFileContent: (path: string) => Promise<string>;
      };
      mutable.listAllFiles = () =>
        Promise.resolve([{
          path: "missing-content.ts",
          size: 1,
          type: "file",
          updated_at: "2026-07-26T00:00:00.000Z",
        }]);
      mutable.getOptionalFileContent = () => Promise.reject(new Error("content backend failed"));

      await assertRejects(
        () => client.searchFilesWithContent("*.ts"),
        Error,
        "content backend failed",
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
  });

  describe("reset", () => {
    it("should clear initialized state", async () => {
      const client = createClient({ ...baseConfig, projectId: "test-id" });
      await client.initialize();
      assertEquals(client.isInitialized(), true);
      client.reset();
      assertEquals(client.isInitialized(), false);
    });

    it("clears cached project data and invalidates initialization in flight", async () => {
      let request = 0;
      let resolveFirst: ((response: Response) => void) | undefined;

      await withMockFetch(
        (_input, init) => {
          request++;
          if (request === 1) {
            return new Promise<Response>((resolve, reject) => {
              resolveFirst = resolve;
              const signal = init && "signal" in init ? init.signal : undefined;
              signal?.addEventListener(
                "abort",
                () => reject(signal.reason),
                { once: true },
              );
            });
          }
          return Promise.resolve(Response.json({
            id: "00000000-0000-4000-a000-000000000002",
            name: "Replacement",
            slug: "config-slug",
          }));
        },
        async () => {
          const client = createClient();
          const pending = client.initialize();
          await Promise.resolve();
          client.reset();
          resolveFirst?.(Response.json({
            id: "00000000-0000-4000-a000-000000000001",
            name: "Stale",
            slug: "config-slug",
          }));

          await assertRejects(
            () => pending,
            DOMException,
            "invalidated",
          );
          assertEquals(client.isInitialized(), false);
          assertEquals(client.getCachedProject(), undefined);
          assertThrows(() => client.getProjectId(), VeryfrontError, "not initialized");

          await client.initialize();
          assertEquals(client.getProjectId(), "00000000-0000-4000-a000-000000000002");
          assertEquals(client.getCachedProject()?.name, "Replacement");
        },
      );
    });

    it("invalidates stale project identity when the effective slug changes", async () => {
      await withMockFetch(
        (input) => {
          const slug = String(input).includes("/projects/project-b") ? "project-b" : "config-slug";
          return Promise.resolve(Response.json({
            id: slug === "project-b"
              ? "00000000-0000-4000-a000-000000000002"
              : "00000000-0000-4000-a000-000000000001",
            name: slug,
            slug,
          }));
        },
        async () => {
          const client = createClient();
          await client.initialize();
          assertEquals(client.getProjectId(), "00000000-0000-4000-a000-000000000001");

          client.setProjectSlug("project-b");
          assertEquals(client.isInitialized(), false);
          assertEquals(client.getCachedProject(), undefined);
          assertThrows(() => client.getProjectId(), VeryfrontError, "not initialized");

          await client.initialize();
          assertEquals(client.getProjectId(), "00000000-0000-4000-a000-000000000002");
          assertEquals(client.getCachedProject()?.slug, "project-b");
        },
      );
    });

    it("invalidates request-scoped identity when clearing a slug override", async () => {
      await withMockFetch(
        (input) => {
          const slug = String(input).includes("/projects/project-b") ? "project-b" : "config-slug";
          return Promise.resolve(Response.json({
            id: slug === "project-b"
              ? "00000000-0000-4000-a000-000000000002"
              : "00000000-0000-4000-a000-000000000001",
            name: slug,
            slug,
          }));
        },
        async () => {
          const client = createClient();
          client.setProjectSlug("project-b");
          await client.initialize();
          assertEquals(client.getProjectId(), "00000000-0000-4000-a000-000000000002");

          client.clearProjectSlug();
          assertEquals(client.getProjectSlug(), "config-slug");
          assertEquals(client.isInitialized(), false);
          assertEquals(client.getCachedProject(), undefined);
          assertThrows(() => client.getProjectId(), VeryfrontError, "not initialized");

          await client.initialize();
          assertEquals(client.getProjectId(), "00000000-0000-4000-a000-000000000001");
        },
      );
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

  describe("bounded content probes", () => {
    it("forwards expected-missing options for branch and published exact reads", async () => {
      const client = createClient();
      const calls: Array<[string, boolean | undefined]> = [];
      const mutable = client as unknown as {
        operations: {
          getBranchFileContentBytesWithinLimit: (
            projectRef: string,
            branchRef: string,
            path: string,
            maximumBytes: number,
            options?: { expectedMissing?: boolean },
          ) => Promise<Uint8Array>;
          getReleaseFileContentBytesWithinLimit: (
            projectRef: string,
            releaseId: string,
            path: string,
            maximumBytes: number,
            options?: { expectedMissing?: boolean },
          ) => Promise<Uint8Array>;
        };
      };
      mutable.operations.getBranchFileContentBytesWithinLimit = (
        _projectRef,
        _branchRef,
        path,
        _maximumBytes,
        options,
      ) => {
        calls.push([path, options?.expectedMissing]);
        return Promise.resolve(new Uint8Array([1]));
      };
      mutable.operations.getReleaseFileContentBytesWithinLimit = (
        _projectRef,
        _releaseId,
        path,
        _maximumBytes,
        options,
      ) => {
        calls.push([path, options?.expectedMissing]);
        return Promise.resolve(new Uint8Array([2]));
      };

      await client.getFileContentBytesWithinLimit(
        "pages/home.tsx",
        1,
        { expectedMissing: true },
      );
      await client.getPublishedFileContentBytesWithinLimit(
        "pages/home.tsx",
        1,
        "release-id",
        undefined,
        { expectedMissing: true },
      );

      assertEquals(calls, [
        ["pages/home.tsx", true],
        ["pages/home.tsx", true],
      ]);
    });
  });
});
