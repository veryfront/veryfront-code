import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontApiClient } from "./client.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import type { VeryfrontAPIConfig } from "./types.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";

const baseConfig = {
  apiBaseUrl: "http://test.api",
  apiToken: "config-token",
  projectSlug: "config-slug",
};

function createClient(config: VeryfrontAPIConfig = baseConfig): VeryfrontApiClient {
  return new VeryfrontApiClient(config);
}

type ResolvedRetryConfig = {
  config: { retry: { maxRetries: number; initialDelay: number; maxDelay: number } };
};

describe("VeryfrontApiClient", () => {
  it("seals every shared API client prototype reachable from a public instance", () => {
    const client = createClient();
    const operations = (client as unknown as { operations: object }).operations;

    assertEquals(Object.isFrozen(VeryfrontApiClient.prototype), true);
    assertEquals(Object.isFrozen(Object.getPrototypeOf(operations)), true);
    assertEquals(Reflect.set(Object.getPrototypeOf(operations), "getToken", () => "stolen"), false);
  });

  it("keeps instance method overrides isolated from the shared prototype", async () => {
    const first = createClient();
    const second = createClient();
    const initialize = VeryfrontApiClient.prototype.initialize;

    first.initialize = () => Promise.resolve();

    await first.initialize();
    assertEquals(Object.hasOwn(first, "initialize"), true);
    assertEquals(second.initialize, initialize);
    assertEquals(VeryfrontApiClient.prototype.initialize, initialize);
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

    it("async-local request auth takes priority over a mutable client token", async () => {
      const client = createClient();
      client.setRequestToken("later-request-token");
      client.enableContextualToken();

      await runWithRequestContext(
        { projectSlug: "request-project", token: "captured-request-token" },
        () => {
          assertEquals(client.getToken(), "captured-request-token");
          return Promise.resolve();
        },
      );
    });

    it("preserves an explicit client token unless contextual auth is enabled", async () => {
      const client = createClient();
      client.setRequestToken("explicit-token");

      await runWithRequestContext(
        { projectSlug: "request-project", token: "ambient-token" },
        () => {
          assertEquals(client.getToken(), "explicit-token");
          return Promise.resolve();
        },
      );
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

    it("project-scoped calls fail fast without a slug", () => {
      const client = createClient({ apiBaseUrl: "http://test.api", apiToken: "token" });
      const listError = assertThrows(
        () => client.listFiles(),
        VeryfrontError,
        "No project slug configured",
        "listFiles must refuse to build a request without a project slug",
      );
      assertEquals(
        (listError as VeryfrontError).status,
        400,
        "a missing project slug must be reported as a 400, not a downstream failure",
      );
      assertThrows(
        () => client.getFile("index.tsx"),
        VeryfrontError,
        "No project slug configured",
        "getFile must refuse to build a request without a project slug",
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

    it("coalesces concurrent initialize() calls into one getProject round trip", async () => {
      const client = createClient();
      let getProjectCalls = 0;
      const mutable = client as unknown as {
        operations: { getProject: (projectRef: string) => Promise<{ id: string }> };
      };
      Object.defineProperty(mutable.operations, "getProject", {
        value: () => {
          getProjectCalls++;
          return Promise.resolve({ id: "11111111-2222-3333-4444-555555555555" });
        },
      });

      await Promise.all([client.initialize(), client.initialize()]);

      assertEquals(
        getProjectCalls,
        1,
        "concurrent initialize() calls must share one getProject round trip",
      );
      assertEquals(
        client.isInitialized(),
        true,
        "the coalesced initialization must still mark the client initialized",
      );
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
      assertEquals(
        (client as unknown as ResolvedRetryConfig).config.retry,
        { maxRetries: 3, initialDelay: 1000, maxDelay: 10000 },
        "the client must apply the documented default retry policy",
      );
    });

    it("accepts custom retry config", () => {
      const client = createClient({
        apiBaseUrl: "http://test.api",
        retry: { maxRetries: 5, initialDelay: 100, maxDelay: 1000 },
      });
      assertEquals(
        (client as unknown as ResolvedRetryConfig).config.retry,
        { maxRetries: 5, initialDelay: 100, maxDelay: 1000 },
        "a caller-supplied retry policy must reach the transport unchanged",
      );
    });
  });

  describe("searchFilesWithContent", () => {
    it("should expose searchFilesWithContent method for pattern-based file search", async () => {
      const client = createClient();
      const listed: Array<{ limit?: number; pattern?: string }> = [];
      let perFileReads = 0;
      const mutable = client as unknown as {
        operations: {
          listBranchFiles: (
            projectRef: string,
            branchRef: string,
            options: { limit?: number; pattern?: string },
          ) => Promise<{ files: Array<{ path: string; content?: string }> }>;
          getBranchFile: () => Promise<never>;
        };
      };
      Object.defineProperties(mutable.operations, {
        listBranchFiles: {
          value: (_projectRef: string, _branchRef: string, options: {
            limit?: number;
            pattern?: string;
          }) => {
            listed.push(options);
            return Promise.resolve({
              files: [{ path: "components/Button.tsx", content: "export default Button;" }],
            });
          },
        },
        getBranchFile: {
          value: () => {
            perFileReads++;
            return Promise.reject(new Error("unexpected per-file read"));
          },
        },
      });

      assertEquals(
        await client.searchFilesWithContent("components/Button.*"),
        [{ path: "components/Button.tsx", content: "export default Button;" }],
        "searchFilesWithContent must return the matched files with their content",
      );
      assertEquals(
        listed[0]?.pattern,
        "components/Button.*",
        "searchFilesWithContent must forward the caller pattern",
      );
      // searchFilesWithContent uses limit: 100 (up from 20) to support projects
      // with many files (e.g., 138 XML files) that would otherwise cause
      // excessive cache misses and individual API round-trips.
      assertEquals(
        listed[0]?.limit,
        100,
        "searchFilesWithContent must request 100 files per page to avoid per-file round trips",
      );
      assertEquals(
        perFileReads,
        0,
        "files returned with content must not be re-fetched individually",
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
      assertThrows(
        () => client.getProjectId(),
        VeryfrontError,
        "not initialized",
        "reset must clear the cached project id so later calls cannot target the previous project",
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

    it("throws for bounded published reads without release or environment identity", () => {
      const client = createClient();
      assertThrows(
        () => client.getPublishedFileContentBytesWithinLimit("pages/index.mdx", 1),
        VeryfrontError,
        "Cannot fetch published file without releaseId or environmentName",
      );
    });
  });

  describe("bounded content probes", () => {
    it("forwards expected-missing options for branch and published exact reads", async () => {
      const client = createClient();
      const calls: Array<[string, string, string, number, boolean | undefined]> = [];
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
      Object.defineProperties(mutable.operations, {
        getBranchFileContentBytesWithinLimit: {
          value: (
            projectRef: string,
            branchRef: string,
            path: string,
            maximumBytes: number,
            options?: { expectedMissing?: boolean },
          ) => {
            calls.push([projectRef, branchRef, path, maximumBytes, options?.expectedMissing]);
            return Promise.resolve(new Uint8Array([1]));
          },
        },
        getReleaseFileContentBytesWithinLimit: {
          value: (
            projectRef: string,
            releaseId: string,
            path: string,
            maximumBytes: number,
            options?: { expectedMissing?: boolean },
          ) => {
            calls.push([projectRef, releaseId, path, maximumBytes, options?.expectedMissing]);
            return Promise.resolve(new Uint8Array([2]));
          },
        },
      });

      assertEquals(
        [
          ...await client.getFileContentBytesWithinLimit(
            "pages/home.tsx",
            1,
            { expectedMissing: true },
          ),
        ],
        [1],
      );
      assertEquals(
        [
          ...await client.getPublishedFileContentBytesWithinLimit(
            "pages/home.tsx",
            1,
            "release-id",
            undefined,
            { expectedMissing: true },
          ),
        ],
        [2],
      );
      assertEquals(
        calls,
        [
          ["config-slug", "main", "pages/home.tsx", 1, true],
          ["config-slug", "release-id", "pages/home.tsx", 1, true],
        ],
        "bounded reads must forward the project ref, the context ref, the byte cap, and expectedMissing unchanged",
      );
    });
  });
});
