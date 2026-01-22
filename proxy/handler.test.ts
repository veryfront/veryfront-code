import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { getLocalAdapter } from "@veryfront/platform/adapters/registry.ts";
import { getFreePort } from "../tests/_helpers/utils.ts";
import { createProxyHandler } from "./handler.ts";

describe("Proxy Handler", () => {
  describe("processRequest with custom domains", () => {
    it("resolves project slug for custom domain via domain lookup", async () => {
      const adapter = await getLocalAdapter();
      const port = await getFreePort();

      // Mock API server that returns domain lookup and OAuth token
      const server = await adapter.serve(
        (req: Request) => {
          const url = new URL(req.url);

          if (url.pathname === "/auth/token") {
            return Response.json({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            });
          }

          if (url.pathname.startsWith("/projects/")) {
            return Response.json({
              id: "proj-123",
              slug: "my-project",
              name: "My Project",
              environments: [{ id: "env-1", name: "production" }],
            });
          }

          return new Response("Not found", { status: 404 });
        },
        { port, hostname: "127.0.0.1" },
      );

      try {
        const handler = createProxyHandler({
          config: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            clientId: "test-client",
            clientSecret: "test-secret",
            previewClientId: "test-client",
            previewClientSecret: "test-secret",
          },
        });

        const req = new Request("http://example.com/page", {
          headers: { host: "example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, "my-project");
        assertEquals(ctx.error, undefined);
        assertEquals(ctx.token, "test-token");

        await handler.close();
      } finally {
        await server.stop();
      }
    });

    it("returns 404 error when custom domain not found", async () => {
      const adapter = await getLocalAdapter();
      const port = await getFreePort();

      const server = await adapter.serve(
        (req: Request) => {
          const url = new URL(req.url);

          if (url.pathname === "/auth/token") {
            return Response.json({
              access_token: "test-token",
              token_type: "Bearer",
              expires_in: 3600,
            });
          }

          if (url.pathname.startsWith("/projects/")) {
            return new Response("Not found", { status: 404 });
          }

          return new Response("Not found", { status: 404 });
        },
        { port, hostname: "127.0.0.1" },
      );

      try {
        const handler = createProxyHandler({
          config: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            clientId: "test-client",
            clientSecret: "test-secret",
            previewClientId: "test-client",
            previewClientSecret: "test-secret",
          },
        });

        const req = new Request("http://unknown-domain.com/page", {
          headers: { host: "unknown-domain.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, undefined);
        assertEquals(ctx.error?.status, 404);
        assertEquals(ctx.error?.message, "No project configured for domain: unknown-domain.com");

        await handler.close();
      } finally {
        await server.stop();
      }
    });

    it("returns 502 error when no token available for custom domain", async () => {
      const handler = createProxyHandler({
        config: {
          apiBaseUrl: "http://localhost:9999",
          clientId: "", // No credentials
          clientSecret: "",
          previewClientId: "",
          previewClientSecret: "",
        },
      });

      const req = new Request("http://custom-domain.com/page", {
        headers: { host: "custom-domain.com" },
      });

      const ctx = await handler.processRequest(req);

      assertEquals(ctx.projectSlug, undefined);
      assertEquals(ctx.error?.status, 502);
      assertEquals(ctx.error?.message, "Failed to authenticate for domain: custom-domain.com");

      await handler.close();
    });

    it("extracts project slug from veryfront subdomain without lookup", async () => {
      const handler = createProxyHandler({
        config: {
          apiBaseUrl: "http://localhost:9999",
          clientId: "",
          clientSecret: "",
          previewClientId: "",
          previewClientSecret: "",
          apiToken: "fallback-token",
        },
      });

      const req = new Request("http://my-project.veryfront.com/page", {
        headers: { host: "my-project.veryfront.com" },
      });

      const ctx = await handler.processRequest(req);

      assertEquals(ctx.projectSlug, "my-project");
      assertEquals(ctx.error, undefined);
      assertEquals(ctx.token, "fallback-token");

      await handler.close();
    });
  });
});
