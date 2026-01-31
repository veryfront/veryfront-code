/**
 * P1-2: Token Priority Cascade Tests
 *
 * Spec: specs/platform/proxy-renderer-contract.spec.md
 * Verifies: Token priority order: user cookie → OAuth → static API token → error
 */
import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { createProxyHandler } from "./handler.ts";
import { createMockServer } from "../../tests/_helpers/utils.ts";

function createHandler(port: number) {
  return createProxyHandler({
    config: {
      apiBaseUrl: `http://127.0.0.1:${port}`,
      clientId: "test-client",
      clientSecret: "test-secret",
      previewClientId: "test-preview-client",
      previewClientSecret: "test-preview-secret",
      apiToken: "static-fallback-token",
    },
  });
}

function createTokenServer(token: string) {
  return createMockServer((req: Request) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/auth/token") {
      return Response.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    return new Response("Not found", { status: 404 });
  });
}

describe("Token Priority Cascade", () => {
  describe("preview scope token priority", () => {
    it("prefers user auth cookie over OAuth in preview", async () => {
      const { server, port } = createTokenServer("oauth-token");

      try {
        const handler = createHandler(port);

        const req = new Request("http://my-project.preview.veryfront.com/page", {
          headers: {
            host: "my-project.preview.veryfront.com",
            cookie: "authToken=user-cookie-token",
          },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.token, "user-cookie-token");
        assertEquals(ctx.error, undefined);

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("falls back to OAuth when no user cookie in preview", async () => {
      const { server, port } = createTokenServer("oauth-preview-token");

      try {
        const handler = createHandler(port);

        const req = new Request("http://my-project.preview.veryfront.com/page", {
          headers: { host: "my-project.preview.veryfront.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.token, "oauth-preview-token");
        assertEquals(ctx.error, undefined);

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });
  });

  describe("production scope token priority", () => {
    it("uses OAuth token in production (user cookie ignored for production scope)", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          return Response.json({
            access_token: "oauth-prod-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [
              {
                id: "env-1",
                name: "production",
                domains: ["example.com"],
                active_release_id: "rel-123",
              },
            ],
          });
        }

        return new Response("Not found", { status: 404 });
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://example.com/page", {
          headers: {
            host: "example.com",
            cookie: "authToken=user-cookie-token",
          },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.token, "oauth-prod-token");
        assertEquals(ctx.error, undefined);

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });
  });

  describe("static API token fallback", () => {
    it("uses static API token when OAuth credentials are empty", async () => {
      const handler = createProxyHandler({
        config: {
          apiBaseUrl: "http://localhost:9999",
          clientId: "",
          clientSecret: "",
          previewClientId: "",
          previewClientSecret: "",
          apiToken: "static-api-token",
        },
      });

      const req = new Request("http://my-project.preview.veryfront.com/page", {
        headers: { host: "my-project.preview.veryfront.com" },
      });

      const ctx = await handler.processRequest(req);

      assertEquals(ctx.token, "static-api-token");
      assertEquals(ctx.error, undefined);

      await handler.close();
    });
  });

  describe("no token available", () => {
    it("returns 502 for custom domain when no token source exists", async () => {
      const handler = createProxyHandler({
        config: {
          apiBaseUrl: "http://localhost:9999",
          clientId: "",
          clientSecret: "",
          previewClientId: "",
          previewClientSecret: "",
        },
      });

      const req = new Request("http://custom-domain.com/page", {
        headers: { host: "custom-domain.com" },
      });

      const ctx = await handler.processRequest(req);

      assertEquals(ctx.token, undefined);
      assertEquals(ctx.error?.status, 502);
      assertEquals(
        ctx.error?.message,
        "Failed to authenticate for domain: custom-domain.com",
      );

      await handler.close();
    });
  });

  describe("local project bypasses token fetch", () => {
    it("skips token fetch for local projects", async () => {
      const handler = createProxyHandler({
        config: {
          apiBaseUrl: "http://localhost:9999",
          clientId: "test-client",
          clientSecret: "test-secret",
          previewClientId: "test-preview-client",
          previewClientSecret: "test-preview-secret",
          apiToken: "should-not-use",
          localProjects: { "local-proj": "/tmp/local-proj" },
        },
      });

      const req = new Request("http://local-proj.preview.veryfront.com/page", {
        headers: { host: "local-proj.preview.veryfront.com" },
      });

      const ctx = await handler.processRequest(req);

      assertEquals(ctx.token, undefined);
      assertEquals(ctx.isLocalProject, true);
      assertEquals(ctx.localPath, "/tmp/local-proj");
      assertEquals(ctx.error, undefined);

      await handler.close();
    });
  });
});
