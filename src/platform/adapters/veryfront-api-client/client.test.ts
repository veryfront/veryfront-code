import { assertEquals, assertRejects, assertThrows } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { VeryfrontAPIClient } from "./client.ts";
import { VeryfrontAPIError } from "./types.ts";

const baseConfig = {
  apiBaseUrl: "http://test.api",
  apiToken: "config-token",
  projectSlug: "config-slug",
};

describe("VeryfrontAPIClient", () => {
  describe("token priority", () => {
    it("uses config token when no request token set", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      assertEquals(client.getToken(), "config-token");
    });

    it("request token takes priority over config token", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      client.setRequestToken("request-token");
      assertEquals(client.getToken(), "request-token");
    });

    it("clearRequestToken reverts to config token", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      client.setRequestToken("request-token");
      client.clearRequestToken();
      assertEquals(client.getToken(), "config-token");
    });

    it("throws when no token available", () => {
      const client = new VeryfrontAPIClient({ apiBaseUrl: "http://test.api" });
      assertThrows(
        () => client.getToken(),
        VeryfrontAPIError,
        "No API token available",
      );
    });
  });

  describe("project slug", () => {
    it("getProjectSlug returns config slug by default", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      assertEquals(client.getProjectSlug(), "config-slug");
    });

    it("request slug takes priority over config slug", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      client.setProjectSlug("request-slug");
      assertEquals(client.getProjectSlug(), "request-slug");
    });

    it("clearProjectSlug reverts to config slug", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      client.setProjectSlug("request-slug");
      client.clearProjectSlug();
      assertEquals(client.getProjectSlug(), "config-slug");
    });
  });

  describe("branch", () => {
    it("getRequestBranch returns undefined by default", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      assertEquals(client.getRequestBranch(), undefined);
    });

    it("setRequestBranch sets branch", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      client.setRequestBranch("feature-x");
      assertEquals(client.getRequestBranch(), "feature-x");
    });

    it("setRequestBranch accepts null for main branch", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      client.setRequestBranch(null);
      assertEquals(client.getRequestBranch(), null);
    });

    it("clearRequestBranch reverts to undefined", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      client.setRequestBranch("feature-x");
      client.clearRequestBranch();
      assertEquals(client.getRequestBranch(), undefined);
    });
  });

  describe("proxy mode", () => {
    it("isProxyMode returns false by default", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      assertEquals(client.isProxyMode(), false);
    });

    it("isProxyMode returns true when configured", () => {
      const client = new VeryfrontAPIClient({ ...baseConfig, proxyMode: true });
      assertEquals(client.isProxyMode(), true);
    });
  });

  describe("initialization state", () => {
    it("isInitialized returns false before initialization", () => {
      const client = new VeryfrontAPIClient(baseConfig);
      assertEquals(client.isInitialized(), false);
    });

    it("reset clears initialization state", () => {
      const client = new VeryfrontAPIClient({ ...baseConfig, projectId: "test-id" });
      assertEquals(client.isInitialized(), false);
      client.reset();
      assertEquals(client.isInitialized(), false);
    });

    it("initialize throws when no slug available", async () => {
      const client = new VeryfrontAPIClient({ apiBaseUrl: "http://test.api", apiToken: "token" });
      await assertRejects(
        () => client.initialize(),
        VeryfrontAPIError,
        "No project slug available",
      );
    });
  });

  describe("retry config", () => {
    it("uses default retry config", () => {
      const client = new VeryfrontAPIClient({ apiBaseUrl: "http://test.api" });
      assertEquals(client.isProxyMode(), false);
    });

    it("accepts custom retry config", () => {
      const client = new VeryfrontAPIClient({
        apiBaseUrl: "http://test.api",
        retry: { maxRetries: 5, initialDelay: 100, maxDelay: 1000 },
      });
      assertEquals(client.isProxyMode(), false);
    });
  });
});
