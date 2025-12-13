import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { basicAuth, bearerAuth } from "./auth.ts";
import { MiddlewareContext } from "../core/context.ts";
import { HTTP_UNAUTHORIZED } from "@veryfront/utils/constants/http.ts";

describe("basicAuth", () => {
  it("should allow valid basic auth credentials", async () => {
    const middleware = basicAuth({ username: "admin", password: "secret" });
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: `Basic ${btoa("admin:secret")}`,
      },
    });
    const ctx = new MiddlewareContext(req);
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      return Promise.resolve(new Response("OK"));
    };

    const response = await middleware(ctx, next);

    assertEquals(nextCalled, true);
    assertExists(response);
    assertEquals(response.status, 200);
  });

  it("should reject invalid credentials", async () => {
    const middleware = basicAuth({ username: "admin", password: "secret" });
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: `Basic ${btoa("admin:wrong")}`,
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_UNAUTHORIZED);
    assertEquals(response.headers.get("WWW-Authenticate"), 'Basic realm="Secure Area"');
  });

  it("should reject missing authorization header", async () => {
    const middleware = basicAuth({ username: "admin", password: "secret" });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_UNAUTHORIZED);
    assertEquals(response.headers.get("WWW-Authenticate"), 'Basic realm="Secure Area"');
  });

  it("should reject non-Basic authorization", async () => {
    const middleware = basicAuth({ username: "admin", password: "secret" });
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: "Bearer some-token",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_UNAUTHORIZED);
  });

  it("should use custom realm", async () => {
    const middleware = basicAuth({
      username: "admin",
      password: "secret",
      realm: "Custom Realm",
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("WWW-Authenticate"), 'Basic realm="Custom Realm"');
  });
});

describe("bearerAuth", () => {
  it("should allow valid bearer token", async () => {
    const middleware = bearerAuth({ token: "valid-token" });
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: "Bearer valid-token",
      },
    });
    const ctx = new MiddlewareContext(req);
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      return Promise.resolve(new Response("OK"));
    };

    const response = await middleware(ctx, next);

    assertEquals(nextCalled, true);
    assertExists(response);
    assertEquals(response.status, 200);
    assertEquals(ctx.var.token, "valid-token");
  });

  it("should reject invalid token", async () => {
    const middleware = bearerAuth({ token: "valid-token" });
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: "Bearer invalid-token",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_UNAUTHORIZED);
  });

  it("should reject missing authorization header", async () => {
    const middleware = bearerAuth({ token: "valid-token" });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_UNAUTHORIZED);
  });

  it("should reject non-Bearer authorization", async () => {
    const middleware = bearerAuth({ token: "valid-token" });
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: `Basic ${btoa("user:pass")}`,
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_UNAUTHORIZED);
  });

  it("should call custom verifyToken function (valid)", async () => {
    let verifyTokenCalled = false;
    const middleware = bearerAuth({
      verifyToken: (token) => {
        verifyTokenCalled = true;
        return token === "custom-token";
      },
    });
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: "Bearer custom-token",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertEquals(verifyTokenCalled, true);
    assertExists(response);
    assertEquals(response.status, 200);
  });

  it("should call custom verifyToken function (invalid)", async () => {
    const middleware = bearerAuth({
      verifyToken: (token) => token === "custom-token",
    });
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: "Bearer wrong-token",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_UNAUTHORIZED);
  });

  it("should call async verifyToken function", async () => {
    const middleware = bearerAuth({
      verifyToken: async (token) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return token === "async-token";
      },
    });
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: "Bearer async-token",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, 200);
  });

  it("should store token in context var", async () => {
    const middleware = bearerAuth({
      verifyToken: () => true,
    });
    const req = new Request("http://localhost/test", {
      headers: {
        authorization: "Bearer my-token",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    await middleware(ctx, next);

    assertEquals(ctx.var.token, "my-token");
  });
});
