import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { CsrfHandler } from "./csrf-handler.ts";
import { generateCsrfToken } from "../../csrf/helpers.ts";
import type { HandlerContext } from "#veryfront/types";

function createCtx(csrf?: boolean | Record<string, unknown>): HandlerContext {
  return {
    projectDir: "/tmp/test",
    adapter: { env: { get: () => undefined } } as unknown as HandlerContext["adapter"],
    securityConfig: csrf !== undefined ? { csrf } : null,
    cspUserHeader: null,
  };
}

describe("security/http/csrf/csrf-handler", () => {
  const handler = new CsrfHandler();

  describe("when CSRF is not configured", () => {
    it("should pass through all requests when securityConfig is null", async () => {
      const ctx = createCtx();
      ctx.securityConfig = null;
      const req = new Request("http://localhost/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should pass through when csrf is false", async () => {
      const ctx = createCtx(false);
      const req = new Request("http://localhost/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should pass through when csrf is undefined", async () => {
      const ctx = createCtx();
      ctx.securityConfig = {};
      const req = new Request("http://localhost/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });
  });

  describe("when CSRF is enabled", () => {
    it("should pass GET requests", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/page");
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should pass HEAD requests", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/page", { method: "HEAD" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should pass OPTIONS requests", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/api", { method: "OPTIONS" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should exempt /_veryfront/log", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/_veryfront/log", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should exempt /_veryfront/modules/ asset paths", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/_veryfront/modules/client.js", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should NOT exempt /_veryfront/rsc/action (Server Actions need CSRF)", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/_veryfront/rsc/action", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 403);
    });

    it("should reject POST without CSRF token", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 403);
    });

    it("should reject PUT without CSRF token", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/resource", { method: "PUT" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("should reject PATCH without CSRF token", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/resource", { method: "PATCH" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("should reject DELETE without CSRF token", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/resource", { method: "DELETE" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("should pass POST with valid CSRF token", async () => {
      const ctx = createCtx(true);
      const { token } = generateCsrfToken({ secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: `vf_csrf=${token}`,
          "x-csrf-token": token,
        },
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should reject POST with mismatched CSRF token", async () => {
      const ctx = createCtx(true);
      const { token } = generateCsrfToken({ secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: `vf_csrf=${token}`,
          "x-csrf-token": "wrong-token",
        },
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });
  });

  describe("custom configuration", () => {
    it("should use custom cookieName and headerName", async () => {
      const ctx = createCtx({ cookieName: "my_csrf", headerName: "x-my-csrf" });
      const { token } = generateCsrfToken({ cookieName: "my_csrf", secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: `my_csrf=${token}`,
          "x-my-csrf": token,
        },
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should reject when using default names with custom config", async () => {
      const ctx = createCtx({ cookieName: "my_csrf", headerName: "x-my-csrf" });
      const { token } = generateCsrfToken({ secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: `vf_csrf=${token}`,
          "x-csrf-token": token,
        },
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("should skip excludePaths", async () => {
      const ctx = createCtx({ excludePaths: ["/api/webhooks", "/api/public"] });
      const req = new Request("http://localhost/api/webhooks", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should skip excludePaths with subpaths", async () => {
      const ctx = createCtx({ excludePaths: ["/api/webhooks"] });
      const req = new Request("http://localhost/api/webhooks/stripe", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should not skip paths not in excludePaths", async () => {
      const ctx = createCtx({ excludePaths: ["/api/webhooks"] });
      const req = new Request("http://localhost/api/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });
  });

  describe("metadata", () => {
    it("should have correct name and priority", () => {
      assertEquals(handler.metadata.name, "CsrfHandler");
      assertEquals(handler.metadata.priority, 5);
    });

    it("should have empty patterns (matches all)", () => {
      assertEquals(handler.metadata.patterns?.length, 0);
    });
  });
});
