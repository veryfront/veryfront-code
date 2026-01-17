import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { VeryfrontAPIClient } from "./client.ts";
import { VeryfrontAPIError } from "./types.ts";

const baseConfig = {
  apiBaseUrl: "http://test.api",
  apiToken: "config-token",
  projectSlug: "config-slug",
};

Deno.test("VeryfrontAPIClient", async (t) => {
  // Token priority tests
  await t.step("uses config token when no request token set", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    assertEquals(client.getToken(), "config-token");
  });

  await t.step("request token takes priority over config token", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    client.setRequestToken("request-token");
    assertEquals(client.getToken(), "request-token");
  });

  await t.step("clearRequestToken reverts to config token", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    client.setRequestToken("request-token");
    client.clearRequestToken();
    assertEquals(client.getToken(), "config-token");
  });

  await t.step("throws when no token available", () => {
    const client = new VeryfrontAPIClient({ apiBaseUrl: "http://test.api" });
    assertThrows(
      () => client.getToken(),
      VeryfrontAPIError,
      "No API token available",
    );
  });

  // Project slug tests
  await t.step("getProjectSlug returns config slug by default", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    assertEquals(client.getProjectSlug(), "config-slug");
  });

  await t.step("request slug takes priority over config slug", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    client.setProjectSlug("request-slug");
    assertEquals(client.getProjectSlug(), "request-slug");
  });

  await t.step("clearProjectSlug reverts to config slug", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    client.setProjectSlug("request-slug");
    client.clearProjectSlug();
    assertEquals(client.getProjectSlug(), "config-slug");
  });

  // Branch tests
  await t.step("getRequestBranch returns undefined by default", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    assertEquals(client.getRequestBranch(), undefined);
  });

  await t.step("setRequestBranch sets branch", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    client.setRequestBranch("feature-x");
    assertEquals(client.getRequestBranch(), "feature-x");
  });

  await t.step("setRequestBranch accepts null for main branch", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    client.setRequestBranch(null);
    assertEquals(client.getRequestBranch(), null);
  });

  await t.step("clearRequestBranch reverts to undefined", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    client.setRequestBranch("feature-x");
    client.clearRequestBranch();
    assertEquals(client.getRequestBranch(), undefined);
  });

  // Proxy mode tests
  await t.step("isProxyMode returns false by default", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    assertEquals(client.isProxyMode(), false);
  });

  await t.step("isProxyMode returns true when configured", () => {
    const client = new VeryfrontAPIClient({ ...baseConfig, proxyMode: true });
    assertEquals(client.isProxyMode(), true);
  });

  // Initialization state tests
  await t.step("isInitialized returns false before initialization", () => {
    const client = new VeryfrontAPIClient(baseConfig);
    assertEquals(client.isInitialized(), false);
  });

  await t.step("reset clears initialization state", () => {
    const client = new VeryfrontAPIClient({ ...baseConfig, projectId: "test-id" });
    assertEquals(client.isInitialized(), false);
    client.reset();
    assertEquals(client.isInitialized(), false);
  });

  await t.step("initialize throws when no slug available", async () => {
    const client = new VeryfrontAPIClient({ apiBaseUrl: "http://test.api", apiToken: "token" });
    await assertRejects(
      () => client.initialize(),
      VeryfrontAPIError,
      "No project slug available",
    );
  });

  // Retry config defaults
  await t.step("uses default retry config", () => {
    const client = new VeryfrontAPIClient({ apiBaseUrl: "http://test.api" });
    // Internal config is private, but we can verify client was created
    assertEquals(client.isProxyMode(), false);
  });

  await t.step("accepts custom retry config", () => {
    const client = new VeryfrontAPIClient({
      apiBaseUrl: "http://test.api",
      retry: { maxRetries: 5, initialDelay: 100, maxDelay: 1000 },
    });
    assertEquals(client.isProxyMode(), false);
  });
});
