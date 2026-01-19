import { assertEquals, assertRejects } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { getLocalAdapter } from "@veryfront/platform/adapters/registry.ts";
import { getFreePort } from "../tests/_helpers/utils.ts";

describe("OAuth Client", () => {
  describe("fetchOAuthToken", () => {
    it("throws on timeout", async () => {
      // Import dynamically to avoid side effects
      const { fetchOAuthToken } = await import("./oauth-client.ts");

      await assertRejects(
        () =>
          fetchOAuthToken({
            apiBaseUrl: "http://10.255.255.1", // Non-routable IP to force timeout
            clientId: "test",
            clientSecret: "test",
            timeoutMs: 100,
          }),
        Error,
        "timed out"
      );
    });

    it("throws on HTTP error", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");

      // Mock server that returns 401
      const adapter = await getLocalAdapter();
      const port = await getFreePort();
      const server = await adapter.serve(
        () => new Response("Unauthorized", { status: 401 }),
        { port, hostname: "127.0.0.1" },
      );

      try {
        await assertRejects(
          () =>
            fetchOAuthToken({
              apiBaseUrl: `http://127.0.0.1:${port}`,
              clientId: "test",
              clientSecret: "test",
            }),
          Error,
          "401"
        );
      } finally {
        await server.stop();
      }
    });

    it("parses successful response", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");

      const adapter = await getLocalAdapter();
      const port = await getFreePort();
      const server = await adapter.serve(
        () =>
          new Response(
            JSON.stringify({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        { port, hostname: "127.0.0.1" },
      );

      try {
        const result = await fetchOAuthToken({
          apiBaseUrl: `http://127.0.0.1:${port}`,
          clientId: "test",
          clientSecret: "test",
        });

        assertEquals(result.access_token, "test-token");
        assertEquals(result.token_type, "Bearer");
        assertEquals(result.expires_in, 3600);
      } finally {
        await server.stop();
      }
    });
  });
});
