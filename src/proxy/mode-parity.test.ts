/**
 * P1-1: Proxy-Renderer Mode Parity Tests
 *
 * Spec: specs/platform/proxy-renderer-contract.spec.md
 * Verifies: Combined mode and split mode produce identical header values
 * for the same input request.
 */
import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { createProxyHandler, injectContextHeaders, type ProxyContext } from "./handler.ts";
import { createMockServer } from "../../tests/_helpers/utils.ts";

function extractProxyHeaders(req: Request): Record<string, string | null> {
  return {
    "x-token": req.headers.get("x-token"),
    "x-project-slug": req.headers.get("x-project-slug"),
    "x-environment": req.headers.get("x-environment"),
    "x-content-source-id": req.headers.get("x-content-source-id"),
    "x-forwarded-host": req.headers.get("x-forwarded-host"),
    "x-project-path": req.headers.get("x-project-path"),
    "x-project-id": req.headers.get("x-project-id"),
    "x-release-id": req.headers.get("x-release-id"),
    "x-branch-id": req.headers.get("x-branch-id"),
    "x-branch-name": req.headers.get("x-branch-name"),
  };
}

describe("Proxy-Renderer Mode Parity", () => {
  describe("injectContextHeaders produces correct headers", () => {
    it("injects all core headers for preview environment", () => {
      const ctx: ProxyContext = {
        token: "preview-token-abc",
        projectSlug: "my-project",
        projectId: "proj-uuid-456",
        environment: "preview",
        contentSourceId: "preview-main",
        host: "my-project.preview.veryfront.com",
        parsedDomain: {
          slug: "my-project",
          isVeryfrontDomain: true,
          environment: "preview",
          branch: null,
          isDraft: true,
          allowIframeEmbed: true,
        },
        isLocalProject: false,
      };

      const injected = injectContextHeaders(
        new Request("http://my-project.preview.veryfront.com/page"),
        ctx,
      );
      const headers = extractProxyHeaders(injected);

      assertEquals(headers["x-token"], "preview-token-abc");
      assertEquals(headers["x-project-slug"], "my-project");
      assertEquals(headers["x-environment"], "preview");
      assertEquals(headers["x-content-source-id"], "preview-main");
      assertEquals(headers["x-forwarded-host"], "my-project.preview.veryfront.com");
      assertEquals(headers["x-project-path"], null);
      assertEquals(headers["x-project-id"], "proj-uuid-456");
      assertEquals(headers["x-release-id"], null);
    });

    it("injects all headers for production with release", () => {
      const ctx: ProxyContext = {
        token: "oauth-token-xyz",
        projectSlug: "my-project",
        projectId: "proj-uuid-123",
        releaseId: "rel-v1.2.3",
        environment: "production",
        contentSourceId: "release-rel-v1.2.3",
        host: "example.com",
        parsedDomain: {
          slug: null,
          isVeryfrontDomain: false,
          environment: null,
          branch: null,
          isDraft: false,
          allowIframeEmbed: false,
        },
        isLocalProject: false,
      };

      const injected = injectContextHeaders(new Request("http://example.com/page"), ctx);
      const headers = extractProxyHeaders(injected);

      assertEquals(headers["x-token"], "oauth-token-xyz");
      assertEquals(headers["x-project-slug"], "my-project");
      assertEquals(headers["x-environment"], "production");
      assertEquals(headers["x-content-source-id"], "release-rel-v1.2.3");
      assertEquals(headers["x-forwarded-host"], "example.com");
      assertEquals(headers["x-project-id"], "proj-uuid-123");
      assertEquals(headers["x-release-id"], "rel-v1.2.3");
    });

    it("injects x-project-path for local projects", () => {
      const ctx: ProxyContext = {
        token: undefined,
        projectSlug: "local-project",
        environment: "preview",
        contentSourceId: "local-main",
        localPath: "/Users/dev/projects/local-project",
        host: "local-project.lvh.me:8080",
        parsedDomain: {
          slug: "local-project",
          isVeryfrontDomain: true,
          environment: "preview",
          branch: null,
          isDraft: true,
          allowIframeEmbed: true,
        },
        isLocalProject: true,
      };

      const injected = injectContextHeaders(
        new Request("http://local-project.lvh.me:8080/page"),
        ctx,
      );

      assertEquals(injected.headers.get("x-project-path"), "/Users/dev/projects/local-project");
      assertEquals(injected.headers.get("x-token"), null);
    });

    it("sets empty string for missing project slug", () => {
      const ctx: ProxyContext = {
        token: "some-token",
        projectSlug: undefined,
        environment: "preview",
        contentSourceId: "no-project",
        host: "veryfront.com",
        parsedDomain: {
          slug: null,
          isVeryfrontDomain: true,
          environment: null,
          branch: null,
          isDraft: false,
          allowIframeEmbed: true,
        },
        isLocalProject: false,
      };

      const injected = injectContextHeaders(new Request("http://veryfront.com/"), ctx);

      assertEquals(injected.headers.get("x-project-slug"), "");
    });

    it("preserves original request headers", () => {
      const ctx: ProxyContext = {
        token: "tok",
        projectSlug: "proj",
        environment: "preview",
        contentSourceId: "preview-main",
        host: "proj.preview.veryfront.com",
        parsedDomain: {
          slug: "proj",
          isVeryfrontDomain: true,
          environment: "preview",
          branch: null,
          isDraft: true,
          allowIframeEmbed: true,
        },
        isLocalProject: false,
      };

      const originalReq = new Request("http://proj.preview.veryfront.com/page", {
        headers: {
          accept: "text/html",
          "user-agent": "TestBot/1.0",
        },
      });

      const injected = injectContextHeaders(originalReq, ctx);

      assertEquals(injected.headers.get("accept"), "text/html");
      assertEquals(injected.headers.get("user-agent"), "TestBot/1.0");
    });
  });

  describe("combined mode produces same context as split mode", () => {
    it("same headers for veryfront preview domain", async () => {
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);
        if (pathname === "/auth/token") {
          return Response.json({
            access_token: "shared-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }
        return new Response("Not found", { status: 404 });
      });

      try {
        const handler = createProxyHandler({
          config: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            clientId: "test-client",
            clientSecret: "test-secret",
            previewClientId: "test-preview-client",
            previewClientSecret: "test-preview-secret",
          },
        });

        const req = new Request("http://test-project.preview.veryfront.com/blog", {
          headers: { host: "test-project.preview.veryfront.com" },
        });

        const ctx = await handler.processRequest(req);
        const injectedReq = injectContextHeaders(req, ctx);
        const headers = extractProxyHeaders(injectedReq);

        assertEquals(headers["x-project-slug"], "test-project");
        assertEquals(headers["x-environment"], "preview");
        assertEquals(typeof headers["x-content-source-id"], "string");
        assertEquals(headers["x-forwarded-host"], "test-project.preview.veryfront.com");

        assertEquals(ctx.projectSlug, "test-project");
        assertEquals(ctx.environment, "preview");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });
  });
});
