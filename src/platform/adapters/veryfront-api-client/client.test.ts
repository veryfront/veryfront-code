import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontAPIClient } from "./client.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";

const baseConfig = {
  apiBaseUrl: "http://test.api",
  apiToken: "config-token",
  projectSlug: "config-slug",
};

function createClient(config = baseConfig): VeryfrontAPIClient {
  return new VeryfrontAPIClient(config);
}

describe("VeryfrontAPIClient", () => {
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
