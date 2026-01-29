import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { basicAuth, bearerAuth } from "./auth.ts";

function makeContext(headers: Record<string, string> = {}) {
  const req = new Request("http://localhost/", { headers });
  return {
    req,
    var: {} as Record<string, unknown>,
  };
}

const nextOk = () => Promise.resolve(new Response("ok", { status: 200 }));

describe("middleware/builtin/auth", () => {
  describe("basicAuth", () => {
    it("should return 401 when no authorization header", async () => {
      const mw = basicAuth({ username: "admin", password: "secret" });
      const res = await mw(makeContext(), nextOk);
      assertEquals(res?.status, 401);
    });

    it("should return 401 for non-Basic authorization", async () => {
      const mw = basicAuth({ username: "admin", password: "secret" });
      const res = await mw(makeContext({ authorization: "Bearer token123" }), nextOk);
      assertEquals(res?.status, 401);
    });

    it("should return 401 for invalid credentials", async () => {
      const mw = basicAuth({ username: "admin", password: "secret" });
      const wrongCreds = btoa("admin:wrong");
      const res = await mw(makeContext({ authorization: `Basic ${wrongCreds}` }), nextOk);
      assertEquals(res?.status, 401);
    });

    it("should pass through with valid credentials", async () => {
      const mw = basicAuth({ username: "admin", password: "secret" });
      const validCreds = btoa("admin:secret");
      const res = await mw(makeContext({ authorization: `Basic ${validCreds}` }), nextOk);
      assertEquals(res?.status, 200);
    });

    it("should include WWW-Authenticate header with realm", async () => {
      const mw = basicAuth({ username: "admin", password: "secret", realm: "MyApp" });
      const res = await mw(makeContext(), nextOk);
      assertEquals(res?.headers.get("WWW-Authenticate"), 'Basic realm="MyApp"');
    });
  });

  describe("bearerAuth", () => {
    it("should return 401 when no authorization header", async () => {
      const mw = bearerAuth({ token: "secret" });
      const res = await mw(makeContext(), nextOk);
      assertEquals(res?.status, 401);
    });

    it("should return 401 for non-Bearer authorization", async () => {
      const mw = bearerAuth({ token: "secret" });
      const res = await mw(makeContext({ authorization: "Basic abc" }), nextOk);
      assertEquals(res?.status, 401);
    });

    it("should return 401 for invalid token", async () => {
      const mw = bearerAuth({ token: "secret" });
      const res = await mw(makeContext({ authorization: "Bearer wrong" }), nextOk);
      assertEquals(res?.status, 401);
    });

    it("should pass through with valid token", async () => {
      const mw = bearerAuth({ token: "secret" });
      const ctx = makeContext({ authorization: "Bearer secret" });
      const res = await mw(ctx, nextOk);
      assertEquals(res?.status, 200);
    });

    it("should set token on context var", async () => {
      const mw = bearerAuth({ token: "mytoken" });
      const ctx = makeContext({ authorization: "Bearer mytoken" });
      await mw(ctx, nextOk);
      assertEquals(ctx.var.token, "mytoken");
    });

    it("should support custom verifyToken function", async () => {
      const mw = bearerAuth({
        verifyToken: (t) => t.startsWith("valid_"),
      });
      const res = await mw(makeContext({ authorization: "Bearer valid_abc" }), nextOk);
      assertEquals(res?.status, 200);
    });

    it("should reject with failing verifyToken", async () => {
      const mw = bearerAuth({
        verifyToken: () => false,
      });
      const res = await mw(makeContext({ authorization: "Bearer something" }), nextOk);
      assertEquals(res?.status, 401);
    });
  });
});
