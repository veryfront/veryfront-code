import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { createMockServer } from "../../tests/_helpers/utils.ts";
import { createProxyHandler, injectContextHeaders, type ProxyContext } from "./handler.ts";
import { SignJWT } from "jose";

const TEST_JWT_SECRET = "test-jwt-secret-for-proxy-handler-tests";

// Set JWT_SECRET so extractUserIdFromToken can verify tokens
Deno.env.set("JWT_SECRET", TEST_JWT_SECRET);

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

async function createFakeJwt(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(secret);
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

    it("strips port from custom domain host before token fetch", async () => {
      const tokenRequests: string[] = [];
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") {
          const body = req.text().then((t) => JSON.parse(t));
          body.then((b) => {
            if (b.custom_domain) tokenRequests.push(b.custom_domain);
          });
          return createTokenResponse();
        }

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "fin-ops",
            name: "Fin Ops",
            environments: [{
              id: "env-1",
              name: "production",
              domains: ["fin-ops.ai"],
              active_release_id: "rel-123",
            }],
          });
        }

        return createNotFoundResponse();
      });

      try {
        const handler = createHandler(port);

        const req = new Request("http://fin-ops.ai:443/page", {
          headers: { host: "fin-ops.ai:443" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.projectSlug, "fin-ops");
        assertEquals(ctx.error, undefined);
        assertEquals(tokenRequests.length > 0, true);
        assertEquals(tokenRequests[0], "fin-ops.ai");

        await handler.close();
      } finally {
        await server.shutdown();
      }
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
          "https://veryfront.com/sign-in?from=%2Fpage",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows access to protected custom domain with auth token for project member", async () => {
      const memberToken = await createFakeJwt("user-123");
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
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
            cookie: `authToken=${memberToken}`,
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

    it("returns 403 for protected custom domain when authenticated user is not a member", async () => {
      const nonMemberToken = await createFakeJwt("other-user");
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
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
            cookie: `authToken=${nonMemberToken}`,
          },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 403);
        assertEquals(ctx.error?.message, "Access denied");

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
          "https://veryfront.com/sign-in?from=%2Fpage",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows access to protected veryfront domain with auth token for project member", async () => {
      const memberToken = await createFakeJwt("user-123");
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
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
              cookie: `authToken=${memberToken}`,
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

    it("returns 403 for protected veryfront domain when authenticated user is not a member", async () => {
      const nonMemberToken = await createFakeJwt("other-user");
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
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
              cookie: `authToken=${nonMemberToken}`,
            },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 403);
        assertEquals(ctx.error?.message, "Access denied");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("strips origin from redirect URL to prevent open redirect", async () => {
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

        const req = new Request("http://protected.example.com/dashboard?tab=settings", {
          headers: { host: "protected.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        // Must contain only pathname + search, never the full origin
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=%2Fdashboard%3Ftab%3Dsettings",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("collapses protocol-relative redirect to prevent open redirect via //evil.com", async () => {
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

        // An attacker might craft a URL with //evil.com to get a protocol-relative redirect
        const req = new Request("http://protected.example.com//evil.com/callback", {
          headers: { host: "protected.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        // Leading double slashes must be collapsed to a single slash
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=%2Fevil.com%2Fcallback",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("uses only root path for redirect when request is to /", async () => {
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

        const req = new Request("http://protected.example.com/", {
          headers: { host: "protected.example.com" },
        });

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=%2F",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("redirects to sign-in for protected preview domain without auth token", async () => {
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
              name: "preview",
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
          "http://protected-project.preview.veryfront.com/page",
          {
            headers: { host: "protected-project.preview.veryfront.com" },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 302);
        assertEquals(ctx.error?.message, "Authentication required");
        assertEquals(
          ctx.error?.redirectUrl,
          "https://veryfront.com/sign-in?from=%2Fpage",
        );

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("allows access to protected preview domain with auth token for project member", async () => {
      const memberToken = await createFakeJwt("user-123");
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "preview",
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
          "http://protected-project.preview.veryfront.com/page",
          {
            headers: {
              host: "protected-project.preview.veryfront.com",
              cookie: `authToken=${memberToken}`,
            },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error, undefined);
        assertEquals(ctx.projectSlug, "protected-project");
        assertEquals(ctx.environmentId, "env-1");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });

    it("returns 403 for protected preview domain when authenticated user is not a member", async () => {
      const nonMemberToken = await createFakeJwt("other-user");
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);

        if (pathname === "/auth/token") return createTokenResponse();

        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "protected-project",
            name: "Protected Project",
            users: [{ id: "user-123" }],
            environments: [{
              id: "env-1",
              name: "preview",
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
          "http://protected-project.preview.veryfront.com/page",
          {
            headers: {
              host: "protected-project.preview.veryfront.com",
              cookie: `authToken=${nonMemberToken}`,
            },
          },
        );

        const ctx = await handler.processRequest(req);

        assertEquals(ctx.error?.status, 403);
        assertEquals(ctx.error?.message, "Access denied");

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

  describe("injectContextHeaders", () => {
    it("includes x-environment-id when environmentId is present", () => {
      const req = new Request("http://example.com/api/test");
      const ctx: ProxyContext = {
        token: "test-token",
        projectSlug: "my-project",
        projectId: "proj-123",
        releaseId: "rel-456",
        environmentId: "env-789",
        environment: "production",
        contentSourceId: "cs-123",
        host: "example.com",
        parsedDomain: {
          slug: "my-project",
          branch: null,
          environment: "production",
          isVeryfrontDomain: false,
          isDraft: false,
          allowIframeEmbed: false,
        },
        isLocalProject: false,
      };

      const injected = injectContextHeaders(req, ctx);
      assertEquals(injected.headers.get("x-environment-id"), "env-789");
      assertEquals(injected.headers.get("x-project-id"), "proj-123");
      assertEquals(injected.headers.get("x-release-id"), "rel-456");
    });

    it("does not include x-environment-id when environmentId is absent", () => {
      const req = new Request("http://example.com/api/test");
      const ctx: ProxyContext = {
        token: "test-token",
        projectSlug: "my-project",
        environment: "preview",
        contentSourceId: "cs-123",
        host: "example.com",
        parsedDomain: {
          slug: "my-project",
          branch: null,
          environment: "preview",
          isVeryfrontDomain: true,
          isDraft: true,
          allowIframeEmbed: true,
        },
        isLocalProject: false,
      };

      const injected = injectContextHeaders(req, ctx);
      assertEquals(injected.headers.get("x-environment-id"), null);
    });
  });
});
