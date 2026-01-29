import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { csrfProtection } from "./csrf.ts";

function makeCtx(method: string, headers: Record<string, string> = {}) {
  return {
    request: new Request("http://localhost/api/data", { method, headers }),
  };
}

const nextOk = () => Promise.resolve(new Response("ok", { status: 200 }));

describe("middleware/builtin/security/csrf", () => {
  describe("csrfProtection", () => {
    it("should allow GET requests without token", async () => {
      const mw = csrfProtection(() => true);
      const res = await mw(makeCtx("GET"), nextOk);
      assertEquals(res?.status, 200);
    });

    it("should allow HEAD requests without token", async () => {
      const mw = csrfProtection(() => true);
      const res = await mw(makeCtx("HEAD"), nextOk);
      assertEquals(res?.status, 200);
    });

    it("should reject POST without token", async () => {
      const mw = csrfProtection(() => true);
      const res = await mw(makeCtx("POST"), nextOk);
      assertEquals(res?.status, 403);
    });

    it("should reject POST with invalid token", async () => {
      const mw = csrfProtection((t) => t === "valid");
      const res = await mw(makeCtx("POST", { "X-CSRF-Token": "invalid" }), nextOk);
      assertEquals(res?.status, 403);
    });

    it("should allow POST with valid token", async () => {
      const mw = csrfProtection((t) => t === "valid");
      const res = await mw(makeCtx("POST", { "X-CSRF-Token": "valid" }), nextOk);
      assertEquals(res?.status, 200);
    });

    it("should check PUT requests", async () => {
      const mw = csrfProtection((t) => t === "ok");
      const res = await mw(makeCtx("PUT", { "X-CSRF-Token": "ok" }), nextOk);
      assertEquals(res?.status, 200);
    });

    it("should check DELETE requests", async () => {
      const mw = csrfProtection(() => false);
      const res = await mw(makeCtx("DELETE", { "X-CSRF-Token": "any" }), nextOk);
      assertEquals(res?.status, 403);
    });

    it("should check PATCH requests", async () => {
      const mw = csrfProtection((t) => t === "patch-token");
      const res = await mw(makeCtx("PATCH", { "X-CSRF-Token": "patch-token" }), nextOk);
      assertEquals(res?.status, 200);
    });
  });
});
