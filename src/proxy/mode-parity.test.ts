import "#veryfront/schemas/_test-setup.ts";
/**
 * P1-1: Proxy-Renderer Mode Parity Tests
 *
 * Spec: specs/platform/proxy-renderer-contract.spec.md
 * Verifies: Combined mode and split mode produce identical header values
 * for the same input request.
 */
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  createProxyHandler,
  injectContextHeaders,
  INTERNAL_PROXY_HEADERS,
  type ProxyContext,
} from "./handler.ts";
import { createMockServer } from "../../tests/_helpers/utils.ts";
import {
  decodeIdentityHeaderValue,
  encodeIdentityHeaderValue,
} from "#veryfront/utils/header-identity.ts";

function extractProxyHeaders(req: Request): Record<string, string | null> {
  return {
    "x-token": req.headers.get("x-token"),
    "x-project-slug": req.headers.get("x-project-slug"),
    "x-environment": req.headers.get("x-environment"),
    "x-environment-id": req.headers.get("x-environment-id"),
    "x-environment-name": req.headers.get("x-environment-name"),
    "x-content-source-id": req.headers.get("x-content-source-id"),
    "x-forwarded-host": req.headers.get("x-forwarded-host"),
    "x-project-path": req.headers.get("x-project-path"),
    "x-project-id": req.headers.get("x-project-id"),
    "x-release-id": req.headers.get("x-release-id"),
    "x-branch-id": req.headers.get("x-branch-id"),
    "x-branch-name": req.headers.get("x-branch-name"),
    "x-default-branch-name": req.headers.get("x-default-branch-name"),
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
        host: "local-project.localhost:8080",
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
        new Request("http://local-project.localhost:8080/page"),
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

    it("strips client-supplied internal context headers before injecting", () => {
      const ctx: ProxyContext = {
        token: undefined,
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
          "x-project-path": "/tmp/attacker",
          "x-token": "attacker-token",
          "x-environment": "production",
          "x-default-branch-name": "attacker-default",
        },
      });

      const injected = injectContextHeaders(originalReq, ctx);

      assertEquals(injected.headers.get("x-project-path"), null);
      assertEquals(injected.headers.get("x-token"), null);
      assertEquals(injected.headers.get("x-environment"), "preview");
      assertEquals(injected.headers.get("x-default-branch-name"), null);
    });

    it("replaces every internal proxy header with proxy-derived values", () => {
      const ctx: ProxyContext = {
        token: "proxy-token",
        projectSlug: "proj",
        projectId: "proj-id",
        releaseId: "rel-id",
        branchId: "branch-id",
        branchName: "feature-branch",
        environmentId: "env-id",
        environmentName: "production",
        environment: "production",
        contentSourceId: "release-rel-id",
        host: "proj.production.veryfront.com",
        parsedDomain: {
          slug: "proj",
          isVeryfrontDomain: true,
          environment: "production",
          branch: null,
          isDraft: false,
          allowIframeEmbed: true,
        },
        isLocalProject: false,
      };

      const attackerHeaders = Object.fromEntries(
        INTERNAL_PROXY_HEADERS.map((header) => [header, `attacker-${header}`]),
      );

      const originalReq = new Request("http://proj.production.veryfront.com/page", {
        headers: {
          ...attackerHeaders,
          accept: "text/html",
        },
      });

      const injected = injectContextHeaders(originalReq, ctx);
      const headers = extractProxyHeaders(injected);

      assertEquals(headers["x-token"], "proxy-token");
      assertEquals(headers["x-project-slug"], "proj");
      assertEquals(headers["x-environment"], "production");
      assertEquals(headers["x-environment-id"], "env-id");
      assertEquals(headers["x-environment-name"], "production");
      assertEquals(headers["x-content-source-id"], "release-rel-id");
      assertEquals(headers["x-forwarded-host"], "proj.production.veryfront.com");
      assertEquals(headers["x-project-path"], null);
      assertEquals(headers["x-project-id"], "proj-id");
      assertEquals(headers["x-release-id"], "rel-id");
      assertEquals(headers["x-branch-id"], "branch-id");
      assertEquals(headers["x-branch-name"], "feature-branch");
      assertEquals(headers["x-default-branch-name"], null);
      assertEquals(injected.headers.get("accept"), "text/html");
    });

    it("identity-encodes a non Latin-1 branch name", () => {
      const ctx: ProxyContext = {
        projectSlug: "proj",
        projectId: "proj-id",
        branchId: "branch-id",
        branchName: "\u529f\u80fd/\u65b0",
        environment: "preview",
        contentSourceId: "preview-branch-id",
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

      const injected = injectContextHeaders(
        new Request("http://proj.preview.veryfront.com/page"),
        ctx,
      );

      assertEquals(
        injected.headers.get("x-branch-name"),
        encodeIdentityHeaderValue("\u529f\u80fd/\u65b0"),
        "a non Latin-1 branch name must be identity-encoded",
      );
      assertEquals(
        injected.headers.get("x-branch-name")?.startsWith("vf-utf8:"),
        true,
        "the encoded branch name must carry the vf-utf8 prefix",
      );
      assertEquals(
        decodeIdentityHeaderValue(injected.headers.get("x-branch-name")),
        "\u529f\u80fd/\u65b0",
        "the renderer must decode back to the original branch name",
      );
    });

    it("identity-encodes a non Latin-1 default branch name", () => {
      const ctx: ProxyContext = {
        projectSlug: "proj",
        projectId: "proj-id",
        defaultBranchName: "\u529f\u80fd/\u65b0",
        environment: "preview",
        contentSourceId: "preview-default",
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

      const injected = injectContextHeaders(
        new Request("http://proj.preview.veryfront.com/page"),
        ctx,
      );

      assertEquals(
        injected.headers.get("x-default-branch-name"),
        encodeIdentityHeaderValue("\u529f\u80fd/\u65b0"),
        "a non Latin-1 default branch name must be identity-encoded",
      );
      assertEquals(
        injected.headers.get("x-default-branch-name")?.startsWith("vf-utf8:"),
        true,
        "the encoded default branch name must carry the vf-utf8 prefix",
      );
      assertEquals(
        decodeIdentityHeaderValue(injected.headers.get("x-default-branch-name")),
        "\u529f\u80fd/\u65b0",
        "the renderer must decode back to the original default branch name",
      );
    });

    it("injects a trusted non-main default branch without preview identity", () => {
      const ctx: ProxyContext = {
        projectSlug: "proj",
        projectId: "proj-id",
        defaultBranchName: "trunk",
        environment: "preview",
        contentSourceId: "preview-trunk",
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
      const injected = injectContextHeaders(
        new Request("http://proj.preview.veryfront.com/page"),
        ctx,
      );

      assertEquals(injected.headers.get("x-default-branch-name"), "trunk");
      assertEquals(injected.headers.get("x-branch-id"), null);
      assertEquals(injected.headers.get("x-branch-name"), null);
    });

    it("preserves request cancellation in the injected request", () => {
      const controller = new AbortController();
      const original = new Request("http://proj.preview.veryfront.com/page", {
        signal: controller.signal,
      });
      const injected = injectContextHeaders(original, {
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
      });

      controller.abort(new Error("client disconnected"));

      assertEquals(injected.signal.aborted, true);
      assertEquals(
        injected.signal.reason instanceof Error
          ? injected.signal.reason.message
          : injected.signal.reason,
        "client disconnected",
      );
    });

    it("forwards a streaming body without changing its ownership", async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("streamed body"));
          controller.close();
        },
      });
      const original = new Request(
        "http://proj.preview.veryfront.com/upload",
        {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      );

      const injected = injectContextHeaders(original, {
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
      });

      assertStrictEquals(injected.body, original.body);
      assertEquals(await injected.text(), "streamed body");
    });
  });

  it("strips hop-by-hop and Connection-owned request headers", () => {
    const req = new Request("https://example.com/", {
      headers: {
        Connection: "keep-alive, x-remove-me",
        "Keep-Alive": "timeout=5",
        "Proxy-Authorization": "Basic secret",
        "Transfer-Encoding": "chunked",
        "X-Remove-Me": "connection-owned",
        "X-Preserve-Me": "end-to-end",
      },
    });
    const injected = injectContextHeaders(req, {
      projectSlug: "project",
      environment: "preview",
      contentSourceId: "preview-main",
      host: "project.preview.veryfront.com",
      parsedDomain: {
        slug: "project",
        isVeryfrontDomain: true,
        environment: "preview",
        branch: null,
        isDraft: true,
        allowIframeEmbed: true,
      },
      isLocalProject: false,
    });

    assertEquals(injected.headers.get("connection"), null);
    assertEquals(injected.headers.get("keep-alive"), null);
    assertEquals(injected.headers.get("proxy-authorization"), null);
    assertEquals(injected.headers.get("transfer-encoding"), null);
    assertEquals(injected.headers.get("x-remove-me"), null);
    assertEquals(injected.headers.get("x-preserve-me"), "end-to-end");
  });

  describe("combined mode produces same context as split mode", () => {
    it("same headers for veryfront preview domain", async () => {
      if (typeof (globalThis as { Deno?: unknown }).Deno === "undefined") return;
      const { server, port } = createMockServer((req: Request) => {
        const { pathname } = new URL(req.url);
        if (pathname === "/auth/token") {
          return Response.json({
            access_token: "shared-token",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }
        if (pathname.startsWith("/projects/")) {
          return Response.json({
            id: "proj-123",
            slug: "test-project",
            name: "Test Project",
            environments: [{
              id: "env-1",
              name: "preview",
              active_release_id: null,
              protected: false,
            }],
          });
        }
        return new Response("Not found", { status: 404 });
      });

      try {
        const handler = createProxyHandler({
          config: {
            apiBaseUrl: `http://127.0.0.1:${port}`,
            apiClientId: "test-client",
            apiClientSecret: "test-secret",
            previewApiClientId: "test-preview-client",
            previewApiClientSecret: "test-preview-secret",
          },
        });

        const req = new Request("http://test-project.preview.veryfront.com:8443/blog", {
          headers: { host: "test-project.preview.veryfront.com:8443" },
        });

        const ctx = await handler.processRequest(req);
        const injectedReq = injectContextHeaders(req, ctx);
        const headers = extractProxyHeaders(injectedReq);

        assertEquals(headers["x-project-slug"], "test-project");
        assertEquals(headers["x-environment"], "preview");
        assertEquals(
          headers["x-token"],
          "shared-token",
          "the end-to-end path must forward the token minted by /auth/token",
        );
        assertEquals(
          headers["x-content-source-id"],
          "preview-main",
          "preview requests must carry the preview-derived content source",
        );
        assertEquals(headers["x-forwarded-host"], "test-project.preview.veryfront.com:8443");

        assertEquals(ctx.projectSlug, "test-project");
        assertEquals(ctx.environment, "preview");

        await handler.close();
      } finally {
        await server.shutdown();
      }
    });
  });
});
