import "#veryfront/schemas/_test-setup.ts";
/**
 * P1-1: Proxy-Renderer Mode Parity Tests
 *
 * Spec: specs/platform/proxy-renderer-contract.spec.md
 * Verifies: Combined mode and split mode produce identical header values
 * for the same input request.
 */
import { assertEquals, assertStrictEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { DenoHttpServer } from "#veryfront/platform/compat/http/deno-server.ts";
import { resolveRateLimitClientKey } from "#veryfront/security/rate-limit/client-key.ts";
import { applyCsrfCookie } from "#veryfront/security/csrf/helpers.ts";
import { extractRequestHeaders } from "#veryfront/server/runtime-handler/project-resolution.ts";
import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";
import {
  createProxyHandler,
  injectContextHeaders,
  INTERNAL_PROXY_HEADERS,
  type ProxyContext,
} from "./handler.ts";
import { createSplitForwardRequestInit } from "./split-forward-request.ts";
import { resolveProxyIngressProvenance } from "./trusted-ingress.ts";
import { createMockServer } from "../../tests/_helpers/utils.ts";

function extractProxyHeaders(req: Request): Record<string, string | null> {
  return {
    "x-token": req.headers.get("x-token"),
    "x-project-slug": req.headers.get("x-project-slug"),
    "x-environment": req.headers.get("x-environment"),
    "x-environment-id": req.headers.get("x-environment-id"),
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
  it("captures trusted ingress provenance in the proxy handler and fails closed", async () => {
    const proxyHandler = createProxyHandler({
      config: {
        apiBaseUrl: "http://127.0.0.1:9",
        apiClientId: "",
        apiClientSecret: "",
        previewApiClientId: "",
        previewApiClientSecret: "",
        trustedIngressProxyIps: "127.0.0.1",
      },
    });
    const server = new DenoHttpServer();
    let resolvePort!: (port: number) => void;
    const listening = new Promise<number>((resolve) => {
      resolvePort = resolve;
    });
    const servePromise = server.serve(
      async (request) => {
        const context = await proxyHandler.processRequest(request);
        return Response.json({
          clientIp: context.clientIp,
          publicProtocol: context.publicProtocol,
          error: context.error,
        });
      },
      {
        hostname: "127.0.0.1",
        port: 0,
        onListen: ({ port }) => resolvePort(port),
      },
    );

    try {
      const port = await listening;
      const request = async (forwardedFor: string) => {
        const connection = await Deno.connect({ hostname: "127.0.0.1", port });
        try {
          const rawRequest = [
            "GET / HTTP/1.1",
            "Host: preview.veryfront.com",
            `X-Forwarded-For: ${forwardedFor}`,
            "X-Forwarded-Proto: https",
            "Connection: close",
            "",
            "",
          ].join("\r\n");
          await connection.write(new TextEncoder().encode(rawRequest));

          const decoder = new TextDecoder();
          const buffer = new Uint8Array(4_096);
          let rawResponse = "";
          while (true) {
            const bytesRead = await connection.read(buffer);
            if (bytesRead === null) break;
            rawResponse += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
          }
          rawResponse += decoder.decode();
          assertStringIncludes(rawResponse, "HTTP/1.1 200");
          const bodyOffset = rawResponse.indexOf("\r\n\r\n");
          if (bodyOffset < 0) throw new Error("Proxy test response has no HTTP body");
          return JSON.parse(rawResponse.slice(bodyOffset + 4)) as {
            clientIp?: string;
            publicProtocol?: string;
            error?: { status: number; message: string };
          };
        } finally {
          connection.close();
        }
      };

      assertEquals(await request("203.0.113.8"), {
        clientIp: "203.0.113.8",
        publicProtocol: "https",
      });
      assertEquals(await request("203.0.113.8, 198.51.100.2"), {
        error: {
          status: 502,
          message: "Trusted ingress provenance is invalid",
        },
      });
    } finally {
      await server.close();
      await servePromise;
      await proxyHandler.close();
    }
  });

  describe("injectContextHeaders produces correct headers", () => {
    it("uses trusted real-ingress identity in combined and split modes", async () => {
      const server = new DenoHttpServer();
      let resolvePort!: (port: number) => void;
      const listening = new Promise<number>((resolve) => {
        resolvePort = resolve;
      });
      const previousTrust = Deno.env.get("VERYFRONT_TRUST_FORWARDED_HEADERS");
      Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
      const servePromise = server.serve(
        (request) => {
          // The portable test runner isolates environment writes per async
          // context; configure the renderer topology in the listener context.
          Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
          const provenance = resolveProxyIngressProvenance(
            request,
            new Set(["127.0.0.1"]),
          );
          if (!provenance) return new Response("Missing native provenance", { status: 500 });

          const ctx: ProxyContext = {
            projectSlug: "customer",
            environment: "production",
            contentSourceId: "release-rel-1",
            host: "customer.example",
            parsedDomain: {
              slug: null,
              isVeryfrontDomain: false,
              environment: null,
              branch: null,
              isDraft: false,
              allowIframeEmbed: false,
            },
            isLocalProject: false,
            clientIp: provenance.clientIp,
            publicProtocol: provenance.publicProtocol,
          };
          const combined = injectContextHeaders(request, ctx);
          const split = new Request(
            "http://renderer.internal/account",
            createSplitForwardRequestInit(
              request,
              ctx,
              null,
              new AbortController().signal,
            ),
          );
          const inspect = (forwarded: Request) => {
            const rendererRequest = new Request("http://renderer.internal/account", {
              headers: forwarded.headers,
            });
            const responseHeaders = new Headers();
            applyCsrfCookie(rendererRequest, responseHeaders, { cookieName: "vf_csrf" });
            return {
              clientIp: resolveRateLimitClientKey(rendererRequest, true, "anonymous"),
              forwardedFor: rendererRequest.headers.get("x-forwarded-for"),
              realIp: rendererRequest.headers.get("x-real-ip"),
              protocol: rendererRequest.headers.get("x-forwarded-proto"),
              publicOrigin: extractRequestHeaders(
                rendererRequest,
                new URL(rendererRequest.url),
                true,
              ).publicOrigin,
              csrfCookie: responseHeaders.get("set-cookie"),
              proxyTrusted: String(isProxyTopologyTrusted()),
            };
          };
          return Response.json({ combined: inspect(combined), split: inspect(split) });
        },
        {
          hostname: "127.0.0.1",
          port: 0,
          onListen: ({ port }) => resolvePort(port),
        },
      );

      try {
        const port = await listening;
        const request = async (clientIp: string) => {
          const response = await fetch(`http://127.0.0.1:${port}/account`, {
            headers: {
              accept: "text/html",
              host: "customer.example",
              "x-forwarded-for": clientIp,
              "x-forwarded-proto": "https",
              "x-real-ip": "198.51.100.99",
            },
          });
          assertEquals(response.status, 200);
          return await response.json() as Record<"combined" | "split", Record<string, string>>;
        };
        const first = await request("203.0.113.8");
        const second = await request("203.0.113.9");

        for (const mode of ["combined", "split"] as const) {
          assertEquals(first[mode].clientIp, "203.0.113.8");
          assertEquals(second[mode].clientIp, "203.0.113.9");
          assertEquals(first[mode].forwardedFor, "203.0.113.8");
          assertEquals(first[mode].realIp, "203.0.113.8");
          assertEquals(first[mode].protocol, "https");
          assertEquals(first[mode].publicOrigin, "https://customer.example");
          assertEquals(first[mode].proxyTrusted, "true");
          assertStringIncludes(first[mode].csrfCookie ?? "", "Secure");
        }
      } finally {
        await server.close();
        await servePromise;
        if (previousTrust === undefined) Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
        else Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", previousTrust);
      }
    });

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
        },
      });

      const injected = injectContextHeaders(originalReq, ctx);

      assertEquals(injected.headers.get("x-project-path"), null);
      assertEquals(injected.headers.get("x-token"), null);
      assertEquals(injected.headers.get("x-environment"), "preview");
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
      assertEquals(headers["x-content-source-id"], "release-rel-id");
      assertEquals(headers["x-forwarded-host"], "proj.production.veryfront.com");
      assertEquals(headers["x-project-path"], null);
      assertEquals(headers["x-project-id"], "proj-id");
      assertEquals(headers["x-release-id"], "rel-id");
      assertEquals(headers["x-branch-id"], "branch-id");
      assertEquals(headers["x-branch-name"], "feature-branch");
      for (
        const untrustedProvenanceHeader of [
          "forwarded",
          "via",
          "x-forwarded-for",
          "x-forwarded-port",
          "x-forwarded-proto",
          "x-real-ip",
        ]
      ) {
        assertEquals(injected.headers.get(untrustedProvenanceHeader), null);
      }
      assertEquals(injected.headers.get("accept"), "text/html");
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
