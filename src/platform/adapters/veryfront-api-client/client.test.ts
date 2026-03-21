import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontApiClient } from "./client.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

const baseConfig = {
  apiBaseUrl: "http://test.api",
  apiToken: "config-token",
  projectSlug: "config-slug",
};

function createClient(config = baseConfig): VeryfrontApiClient {
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
  });

  describe("searchFilesWithContent", () => {
    it("should expose searchFilesWithContent method for pattern-based file search", () => {
      const client = createClient();
      // searchFilesWithContent uses limit: 100 (up from 20) to support projects
      // with many files (e.g., 138 XML files) that would otherwise cause
      // excessive cache misses and individual API round-trips.
      assertEquals(typeof client.searchFilesWithContent, "function");
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
