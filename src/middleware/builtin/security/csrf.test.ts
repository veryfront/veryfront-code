import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { csrfProtection } from "./csrf.ts";
import { MiddlewareContext } from "../../core/context.ts";
import { HTTP_FORBIDDEN } from "@veryfront/utils/constants/http.ts";

describe("csrfProtection", () => {
  it("should allow GET request without CSRF token", async () => {
    const middleware = csrfProtection(() => true);
    const req = new Request("http://localhost/test", {
      method: "GET",
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

  it("should allow HEAD request without CSRF token", async () => {
    const middleware = csrfProtection(() => true);
    const req = new Request("http://localhost/test", {
      method: "HEAD",
    });
    const ctx = new MiddlewareContext(req);
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      return Promise.resolve(new Response("OK"));
    };

    const response = await middleware(ctx, next);

    assertEquals(nextCalled, true);
  });

  it("should allow OPTIONS request without CSRF token", async () => {
    const middleware = csrfProtection(() => true);
    const req = new Request("http://localhost/test", {
      method: "OPTIONS",
    });
    const ctx = new MiddlewareContext(req);
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
      return Promise.resolve(new Response("OK"));
    };

    const response = await middleware(ctx, next);

    assertEquals(nextCalled, true);
  });

  it("should block POST request without CSRF token", async () => {
    const middleware = csrfProtection(() => false);
    const req = new Request("http://localhost/test", {
      method: "POST",
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_FORBIDDEN);
    const text = await response.text();
    assertEquals(text, "Invalid CSRF token");
  });

  it("should allow POST request with valid CSRF token", async () => {
    const middleware = csrfProtection((token) => token === "valid-token");
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: {
        "X-CSRF-Token": "valid-token",
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

  it("should block POST request with invalid CSRF token", async () => {
    const middleware = csrfProtection((token) => token === "valid-token");
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: {
        "X-CSRF-Token": "invalid-token",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_FORBIDDEN);
  });

  it("should block PUT request without valid CSRF token", async () => {
    const middleware = csrfProtection(() => false);
    const req = new Request("http://localhost/test", {
      method: "PUT",
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_FORBIDDEN);
  });

  it("should allow PUT request with valid CSRF token", async () => {
    const middleware = csrfProtection((token) => token === "valid-token");
    const req = new Request("http://localhost/test", {
      method: "PUT",
      headers: {
        "X-CSRF-Token": "valid-token",
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
  });

  it("should block PATCH request without valid CSRF token", async () => {
    const middleware = csrfProtection(() => false);
    const req = new Request("http://localhost/test", {
      method: "PATCH",
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_FORBIDDEN);
  });

  it("should block DELETE request without valid CSRF token", async () => {
    const middleware = csrfProtection(() => false);
    const req = new Request("http://localhost/test", {
      method: "DELETE",
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_FORBIDDEN);
  });

  it("should allow DELETE request with valid CSRF token", async () => {
    const middleware = csrfProtection((token) => token === "valid-token");
    const req = new Request("http://localhost/test", {
      method: "DELETE",
      headers: {
        "X-CSRF-Token": "valid-token",
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
  });

  it("should handle case-insensitive method names", async () => {
    const middleware = csrfProtection((token) => token === "valid-token");
    const req = new Request("http://localhost/test", {
      method: "post",
      headers: {
        "X-CSRF-Token": "valid-token",
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
  });

  it("should block request with empty CSRF token", async () => {
    const middleware = csrfProtection((token) => token === "valid-token");
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: {
        "X-CSRF-Token": "",
      },
    });
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK"));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.status, HTTP_FORBIDDEN);
  });
});
