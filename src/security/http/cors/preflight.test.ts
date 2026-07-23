import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleCORSPreflight, isPreflightRequest } from "./preflight.ts";

describe("security/http/cors/preflight", () => {
  describe("isPreflightRequest", () => {
    it("should return true for OPTIONS with access-control-request-method", () => {
      const req = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Method": "POST" },
      });

      assertEquals(isPreflightRequest(req), true);
    });

    it("should return true for OPTIONS with access-control-request-headers", () => {
      const req = new Request("http://localhost/", {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Headers": "Content-Type" },
      });

      assertEquals(isPreflightRequest(req), true);
    });

    it("should return false for non-OPTIONS requests", () => {
      const req = new Request("http://localhost/", {
        method: "GET",
        headers: { "Access-Control-Request-Method": "POST" },
      });

      assertEquals(isPreflightRequest(req), false);
    });

    it("should return false for plain OPTIONS without CORS headers", () => {
      const req = new Request("http://localhost/", { method: "OPTIONS" });

      assertEquals(isPreflightRequest(req), false);
    });
  });

  it("rejects request methods outside the configured allowlist", async () => {
    const request = new Request("http://localhost/", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "DELETE",
      },
    });

    const response = await handleCORSPreflight({
      request,
      config: { origin: "https://app.example.com", methods: ["GET", "POST"] },
    });

    assertEquals(response.status, 403);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("does not reflect request headers outside the configured allowlist", async () => {
    const request = new Request("http://localhost/", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, X-Admin-Override",
      },
    });

    const response = await handleCORSPreflight({
      request,
      config: {
        origin: "https://app.example.com",
        methods: ["POST"],
        allowedHeaders: ["Content-Type"],
      },
    });

    assertEquals(response.status, 403);
    assertEquals(response.headers.get("Access-Control-Allow-Headers"), null);
  });

  it("accepts request methods and headers case-insensitively", async () => {
    const request = new Request("http://localhost/", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "post",
        "Access-Control-Request-Headers": "content-type",
      },
    });

    const response = await handleCORSPreflight({
      request,
      config: {
        origin: "https://app.example.com",
        methods: ["POST"],
        allowedHeaders: ["Content-Type"],
      },
    });

    assertEquals(response.status, 204);
    assertEquals(response.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  });
});
