import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { applyCORSHeaders, applyCORSHeadersSync, shouldApplyCORS } from "./headers.ts";
import { MAX_CORS_TOKEN_LENGTH } from "#veryfront/utils/cors-policy-limits.ts";

describe("security/http/cors/headers", () => {
  describe("shouldApplyCORS", () => {
    it("should return false when config is falsy", () => {
      const req = new Request("http://localhost/");
      assertEquals(shouldApplyCORS(req, undefined), false);
      assertEquals(shouldApplyCORS(req, false), false);
    });

    it("should return true when config is true", () => {
      const req = new Request("http://localhost/");
      assertEquals(shouldApplyCORS(req, true), true);
    });

    it("should return true when request has Origin header", () => {
      const req = new Request("http://localhost/", {
        headers: { Origin: "http://example.com" },
      });
      assertEquals(shouldApplyCORS(req, { origin: "http://example.com" }), true);
    });

    it("should return true for wildcard origin without Origin header", () => {
      const req = new Request("http://localhost/");
      assertEquals(shouldApplyCORS(req, { origin: "*" }), true);
    });

    it("should return false for specific origin without Origin header", () => {
      const req = new Request("http://localhost/");
      assertEquals(shouldApplyCORS(req, { origin: "http://example.com" }), false);
    });
  });

  it("fails the entire CORS boundary closed for an oversized exposed-header policy", async () => {
    const request = new Request("http://localhost/", {
      headers: { origin: "https://app.example.com" },
    });
    const response = await applyCORSHeaders({
      request,
      response: new Response("ok"),
      config: {
        origin: "https://app.example.com",
        exposedHeaders: ["X".repeat(MAX_CORS_TOKEN_LENGTH + 1)],
      },
    });

    assertEquals(response?.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals(response?.headers.get("Access-Control-Expose-Headers"), null);
  });

  it("does not partially apply malformed or unknown CORS configuration", async () => {
    const request = new Request("http://localhost/", {
      headers: { origin: "https://app.example.com" },
    });

    for (
      const config of [
        { origin: "https://app.example.com", credentials: "yes" },
        { origin: "https://app.example.com", maxAge: -1 },
        { origin: "https://app.example.com", methods: ["GET, POST"] },
        { origin: "https://app.example.com", unexpected: true },
      ]
    ) {
      const response = await applyCORSHeaders({
        request,
        response: new Response("ok"),
        config: config as never,
      });

      assertEquals(response?.headers.get("Access-Control-Allow-Origin"), null);
      assertEquals(response?.headers.get("Access-Control-Allow-Credentials"), null);
      assertEquals(response?.headers.get("Access-Control-Expose-Headers"), null);
    }
  });

  it("rejects unsafe callback origins before writing response headers", async () => {
    const request = new Request("http://localhost/", {
      headers: { origin: "https://app.example.com" },
    });
    const response = await applyCORSHeaders({
      request,
      response: new Response("ok"),
      config: {
        origin: () => "https://例.example",
      },
    });

    assertEquals(response?.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("scrubs every policy-owned CORS header when an origin is denied", async () => {
    const request = new Request("http://localhost/", {
      headers: { origin: "https://denied.example.com" },
    });
    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Expose-Headers": "X-Project",
      "Access-Control-Allow-Methods": "DELETE",
      "Access-Control-Allow-Headers": "X-Project",
      "Access-Control-Max-Age": "999999",
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Future-Policy": "unsafe",
    });
    await applyCORSHeaders({
      request,
      headers,
      config: { origin: "https://allowed.example.com" },
    });

    for (
      const name of [
        "Access-Control-Allow-Origin",
        "Access-Control-Allow-Credentials",
        "Access-Control-Expose-Headers",
        "Access-Control-Allow-Methods",
        "Access-Control-Allow-Headers",
        "Access-Control-Max-Age",
        "Access-Control-Allow-Private-Network",
        "Access-Control-Future-Policy",
      ]
    ) {
      assertEquals(headers.get(name), null);
    }
  });

  it("mutates supplied headers to the exact allowed policy without stale values", () => {
    const origin = "https://allowed.example.com";
    const request = new Request("http://localhost/", {
      headers: { origin },
    });
    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Expose-Headers": "X-Project",
      "Access-Control-Allow-Methods": "DELETE",
      "Access-Control-Allow-Headers": "X-Project",
      "Access-Control-Max-Age": "999999",
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Future-Policy": "unsafe",
    });

    applyCORSHeadersSync({
      request,
      headers,
      config: { origin },
    });

    assertEquals(headers.get("Access-Control-Allow-Origin"), origin);
    assertEquals(headers.get("Vary"), "Origin");
    for (
      const name of [
        "Access-Control-Allow-Credentials",
        "Access-Control-Expose-Headers",
        "Access-Control-Allow-Methods",
        "Access-Control-Allow-Headers",
        "Access-Control-Max-Age",
        "Access-Control-Allow-Private-Network",
        "Access-Control-Future-Policy",
      ]
    ) {
      assertEquals(headers.get(name), null);
    }
  });

  it("returns async denials and malformed policies with the sanitized supplied headers", async () => {
    const request = new Request("http://localhost/", {
      headers: { origin: "https://denied.example.com" },
    });

    for (
      const config of [
        { origin: "https://allowed.example.com" },
        { origin: "https://denied.example.com", unexpected: true },
      ]
    ) {
      const response = new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Future-Policy": "unsafe",
          "X-Response": "original",
        },
      });
      const headers = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Future-Policy": "unsafe",
        "X-Authoritative": "detached",
      });

      const result = await applyCORSHeaders({
        request,
        response,
        headers,
        config: config as never,
      });

      assertEquals(result?.headers.get("Access-Control-Allow-Origin"), null);
      assertEquals(result?.headers.get("Access-Control-Allow-Credentials"), null);
      assertEquals(result?.headers.get("Access-Control-Future-Policy"), null);
      assertEquals(result?.headers.get("X-Authoritative"), "detached");
      assertEquals(result?.headers.get("X-Response"), null);
    }
  });

  it("returns sync denials and malformed policies with the sanitized supplied headers", () => {
    const request = new Request("http://localhost/", {
      headers: { origin: "https://denied.example.com" },
    });

    for (
      const config of [
        { origin: "https://allowed.example.com" },
        { origin: "https://denied.example.com", unexpected: true },
      ]
    ) {
      const response = new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Future-Policy": "unsafe",
          "X-Response": "original",
        },
      });
      const headers = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Future-Policy": "unsafe",
        "X-Authoritative": "detached",
      });

      const result = applyCORSHeadersSync({
        request,
        response,
        headers,
        config: config as never,
      });

      assertEquals(result?.headers.get("Access-Control-Allow-Origin"), null);
      assertEquals(result?.headers.get("Access-Control-Allow-Credentials"), null);
      assertEquals(result?.headers.get("Access-Control-Future-Policy"), null);
      assertEquals(result?.headers.get("X-Authoritative"), "detached");
      assertEquals(result?.headers.get("X-Response"), null);
    }
  });

  it("keeps supplied headers authoritative when an origin is allowed", async () => {
    const origin = "https://allowed.example.com";
    const result = await applyCORSHeaders({
      request: new Request("http://localhost/", { headers: { origin } }),
      response: new Response("ok", { headers: { "X-Response": "original" } }),
      headers: new Headers({ "X-Authoritative": "detached" }),
      config: { origin },
    });

    assertEquals(result?.headers.get("Access-Control-Allow-Origin"), origin);
    assertEquals(result?.headers.get("X-Authoritative"), "detached");
    assertEquals(result?.headers.get("X-Response"), null);
  });

  it("merges Vary field names case-insensitively without empty tokens", async () => {
    const request = new Request("https://example.com", {
      headers: { Origin: "https://app.example.com" },
    });

    for (const initialVary of ["origin", "", "*"]) {
      const headers = new Headers({ Vary: initialVary });
      await applyCORSHeaders({
        request,
        headers,
        config: { origin: "https://app.example.com" },
      });

      assertEquals(
        headers.get("Vary"),
        initialVary === "" ? "Origin" : initialVary,
      );
    }
  });
});
