import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ClientLogHandler } from "./client-log.handler.ts";

function createHandler(): ClientLogHandler {
  return new ClientLogHandler();
}

function createPostRequest(body: unknown): Request {
  return new Request("http://localhost/_veryfront/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function assertOkResponse(result: { response?: Response }): Promise<void> {
  assertEquals(result.response instanceof Response, true);
  assertExists(result.response);
  assertEquals(result.response.status, 200);
}

describe("server/handlers/monitoring/client-log", () => {
  describe("ClientLogHandler metadata", () => {
    it("should have correct handler name", () => {
      const handler = createHandler();
      assertEquals(handler.metadata.name, "ClientLogHandler");
    });

    it("should match POST to /_veryfront/log", () => {
      const handler = createHandler();
      assertExists(handler.metadata.patterns);
      assertEquals(handler.metadata.patterns.length, 1);

      const pattern = handler.metadata.patterns[0];
      assertExists(pattern);
      assertEquals(typeof pattern !== "string" && pattern.pattern, "/_veryfront/log");
      assertEquals(typeof pattern !== "string" && pattern.exact, true);
      assertEquals(typeof pattern !== "string" && pattern.method, "POST");
    });

    it("should only be enabled in local dev mode", () => {
      const handler = createHandler();
      const enabledFn = handler.metadata.enabled;
      assertEquals(typeof enabledFn, "function");

      if (typeof enabledFn !== "function") return;

      assertEquals(enabledFn({ isLocalProject: false } as never), false);
      assertEquals(enabledFn({ isLocalProject: true } as never), true);
      assertEquals(enabledFn({} as never), false);
    });
  });

  describe("ClientLogHandler.handle", () => {
    const localCtx = { securityConfig: undefined, isLocalProject: true } as never;
    const remoteCtx = { securityConfig: undefined, isLocalProject: false } as never;

    it("should return continue for non-matching pathname", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/other-path", { method: "POST" });
      const result = await handler.handle(req, localCtx);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("should return continue for GET requests to the log endpoint", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_veryfront/log", { method: "GET" });
      const result = await handler.handle(req, localCtx);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("should return continue when request is not local project", async () => {
      const handler = createHandler();
      const req = createPostRequest({ level: "info", message: "test message" });
      const result = await handler.handle(req, remoteCtx);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("should return response with ok:true for valid log data", async () => {
      const handler = createHandler();
      const req = createPostRequest({ level: "info", message: "test message" });
      const result = await handler.handle(req, localCtx);

      await assertOkResponse(result);
      const body = await (result.response as Response).json();
      assertEquals(body.ok, true);
    });

    it("should return ok:true even for invalid JSON body", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_veryfront/log", {
        method: "POST",
        body: "not valid json {{{",
      });
      const result = await handler.handle(req, localCtx);

      await assertOkResponse(result);
      const body = await (result.response as Response).json();
      assertEquals(body.ok, true);
    });

    it("should return ok:true for log data with details", async () => {
      const handler = createHandler();
      const req = createPostRequest({
        level: "error",
        message: "something failed",
        details: { component: "App", stack: "Error at line 5" },
      });
      const result = await handler.handle(req, localCtx);
      await assertOkResponse(result);
    });

    it("should handle missing level gracefully", async () => {
      const handler = createHandler();
      const req = createPostRequest({ message: "no level" });
      const result = await handler.handle(req, localCtx);
      await assertOkResponse(result);
    });

    it("should handle missing message gracefully", async () => {
      const handler = createHandler();
      const req = createPostRequest({ level: "warn" });
      const result = await handler.handle(req, localCtx);
      await assertOkResponse(result);
    });

    it("should reject oversized body with 413", async () => {
      const handler = createHandler();
      // 64 KB limit — send a body that exceeds it
      const oversizedBody = "x".repeat(65 * 1024);
      const req = new Request("http://localhost/_veryfront/log", {
        method: "POST",
        body: oversizedBody,
      });
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 413);
      const body = await result.response.json();
      assertEquals(body.error, "Payload too large");
    });
  });
});
