import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createMockServer } from "../../tests/_helpers/utils.ts";
import { createProxyHandler } from "./handler.ts";

function createTokenResponse(): Response {
  return Response.json({
    access_token: "test-token",
    token_type: "Bearer",
    expires_in: 3600,
  });
}

function createNotFoundResponse(): Response {
  return new Response("Not found", { status: 404 });
}

function createHandler(port: number) {
  return createProxyHandler({
    config: {
      apiBaseUrl: `http://127.0.0.1:${port}`,
      apiClientId: "test-client",
      apiClientSecret: "test-secret",
      previewApiClientId: "test-client",
      previewApiClientSecret: "test-secret",
    },
  });
}

describe("Proxy Handler", () => {
  describe("processRequest with custom domains", () => {
    it("resolves project slug for custom domain via domain lookup", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["example.com"],
              active_release_id: "rel-123",
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://example.com/page", {
          headers: { host: "example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, "my-project");
        assertEquals(ctx.error, undefined);
        assertEquals(ctx.token, "test-token");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("returns 404 error when custom domain not found", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();
        if (pathname.startsWith("/projects/")) return createNotFoundResponse();

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://unknown-domain.com/page", {
          headers: { host: "unknown-domain.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, undefined);
        assertEquals(ctx.error?.status, 404);
        assertEquals(
          ctx.error?.message,
          "No project configured for domain: unknown-domain.com",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("returns 502 error when no token available for custom domain", async () => {
      const handler = createProxyHandler({
        config: {
          apiBaseUrl: "http://localhost:9999",
          apiClientId: "",
          apiClientSecret: "",
          previewApiClientId: "",
          previewApiClientSecret: "",
        },
      });

      const req = new Request("http://custom-domain.com/page", {
        headers: { host: "custom-domain.com" },
      });

      const ctx = await handler.processRequest(req);

      assertEquals(ctx.projectSlug, undefined);
      assertEquals(ctx.error?.status, 502);
      assertEquals(
        ctx.error?.message,
        "Failed to authenticate for domain: custom-domain.com",
      );

      await handler.close();
    });

    it("extracts project slug from veryfront subdomain without lookup", async () => {
      const handler = createProxyHandler({
        config: {
          apiBaseUrl: "http://localhost:9999",
          apiClientId: "",
          apiClientSecret: "",
          previewApiClientId: "",
          previewApiClientSecret: "",
          apiToken: "fallback-token",
        },
      });

      // Use preview subdomain to avoid production releaseId requirement
      const req = new Request("http://my-project.preview.veryfront.com/page", {
        headers: { host: "my-project.preview.veryfront.com" },
      });

      const ctx = await handler.processRequest(req);

      assertEquals(ctx.projectSlug, "my-project");
      assertEquals(ctx.error, undefined);
      assertEquals(ctx.token, "fallback-token");
      assertEquals(ctx.environment, "preview");

      await handler.close();
    });
  });

  describe("protected environments", () => {
    it("redirects to sign-in for protected custom domain without auth token", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://protected.example.com/page", {
          headers: { host: "protected.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        assertEquals(ctx.error?.message, "Authentication required");
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=http%3A%2F%2Fprotected.example.com%2Fpage",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows access to protected custom domain with auth token", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["protected.example.com"],
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://protected.example.com/page", {
          headers: {
            host: "protected.example.com",
            cookie: "authToken=user-auth-token",
          },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "protected-project");
        assertEquals(ctx.releaseId, "rel-123");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("redirects to sign-in for protected veryfront domain without auth token", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "staging",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request(
          "http://protected-project.staging.veryfront.com/page",
          {
            headers: { host: "protected-project.staging.veryfront.com" },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        assertEquals(ctx.error?.message, "Authentication required");
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=http%3A%2F%2Fprotected-project.staging.veryfront.com%2Fpage",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows access to protected veryfront domain with auth token", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            environments: [{
              id: "env-1",
              name: "staging",
              active_release_id: "rel-123",
              protected: true,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request(
          "http://protected-project.staging.veryfront.com/page",
          {
            headers: {
              host: "protected-project.staging.veryfront.com",
              cookie: "authToken=user-auth-token",
            },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "protected-project");
        assertEquals(ctx.releaseId, "rel-123");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("extracts serverHostname from custom domain with dedicated server", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "my-project",
            name: "My Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["dedicated.example.com"],
              active_release_id: "rel-123",
              server_hostname: "veryfront-server-2847395106.veryfront-production.svc.cluster.local",
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://dedicated.example.com/page", {
          headers: { host: "dedicated.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "my-project");
        assertEquals(
          ctx.serverHostname,
          "veryfront-server-2847395106.veryfront-production.svc.cluster.local",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("extracts serverHostname from veryfront production domain", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-456",
            slug: "dedicated-project",
            name: "Dedicated Project",
            environments: [{
              id: "env-2",
              name: "staging",
              active_release_id: "rel-456",
              server_hostname: "veryfront-server-1234567890.veryfront-production.svc.cluster.local",
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request(
          "http://dedicated-project.staging.veryfront.com/page",
          {
            headers: { host: "dedicated-project.staging.veryfront.com" },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "dedicated-project");
        assertEquals(
          ctx.serverHostname,
          "veryfront-server-1234567890.veryfront-production.svc.cluster.local",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("serverHostname is undefined when no dedicated server configured", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "shared-project",
            name: "Shared Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["shared.example.com"],
              active_release_id: "rel-123",
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://shared.example.com/page", {
          headers: { host: "shared.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.serverHostname, undefined);

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("serverHostname is undefined when server_hostname is null", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "null-server-project",
            name: "Null Server Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["null-server.example.com"],
              active_release_id: "rel-123",
              server_hostname: null,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://null-server.example.com/page", {
          headers: { host: "null-server.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.serverHostname, undefined);

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("returns 404 when project exists but no environment matches custom domain", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "mismatched-project",
            name: "Mismatched Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["other-domain.example.com"],
              active_release_id: "rel-123",
              server_hostname: "veryfront-server-999.veryfront-production.svc.cluster.local",
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://no-match.example.com/page", {
          headers: { host: "no-match.example.com" },
        });

        const ctx = await handler.processRequest(req);

        // Project found but no env matches this domain — should be a 404
        assertEquals(ctx.error?.status, 404);
        assertEquals(ctx.serverHostname, undefined);

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows access to non-protected environment without auth token", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "public-project",
            name: "Public Project",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["public.example.com"],
              active_release_id: "rel-123",
              protected: false,
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://public.example.com/page", {
          headers: { host: "public.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "public-project");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });
  });
});
