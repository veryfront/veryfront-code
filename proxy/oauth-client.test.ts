import { assertEquals, assertRejects } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";

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
      const server = Deno.serve({ port: 0 }, () => {
        return new Response("Unauthorized", { status: 401 });
      });

      try {
        const addr = server.addr as Deno.NetAddr;
        await assertRejects(
          () =>
            fetchOAuthToken({
              apiBaseUrl: `http://localhost:${addr.port}`,
              clientId: "test",
              clientSecret: "test",
            }),
          Error,
          "401"
        );
      } finally {
        await server.shutdown();
      }
    });

    it("parses successful response", async () => {
      const { fetchOAuthToken } = await import("./oauth-client.ts");

      const server = Deno.serve({ port: 0 }, () => {
        return new Response(
          JSON.stringify({
            access_token: "test-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      });

      try {
        const addr = server.addr as Deno.NetAddr;
        const result = await fetchOAuthToken({
          apiBaseUrl: `http://localhost:${addr.port}`,
          clientId: "test",
          clientSecret: "test",
        });

        assertEquals(result.access_token, "test-token");
        assertEquals(result.token_type, "Bearer");
        assertEquals(result.expires_in, 3600);
      } finally {
        await server.shutdown();
      }
    });
  });
});
