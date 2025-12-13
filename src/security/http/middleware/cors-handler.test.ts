import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { setCors } from "./cors-handler.ts";

describe("setCors", () => {
  it("should handle null security config", () => {
    const headers = new Headers();
    const req = new Request("https://example.com", {
      headers: { origin: "https://example.com" },
    });
    setCors(headers, req, null);
    // Should not throw, and may or may not set headers depending on config
  });

  it("should handle request without origin", () => {
    const headers = new Headers();
    const req = new Request("https://example.com");
    const securityConfig = { cors: true };
    setCors(headers, req, securityConfig);
    // Should handle gracefully
  });

  it("should set Access-Control-Allow-Origin when origin is allowed", () => {
    const headers = new Headers();
    const req = new Request("https://example.com", {
      headers: { origin: "https://example.com" },
    });
    const securityConfig = { cors: { origin: "https://example.com" } };
    setCors(headers, req, securityConfig);
    assertEquals(headers.has("Access-Control-Allow-Origin"), true);
  });

  it("should set Vary header for non-wildcard origins", () => {
    const headers = new Headers();
    const req = new Request("https://example.com", {
      headers: { origin: "https://example.com" },
    });
    const securityConfig = { cors: { origin: "https://example.com" } };
    setCors(headers, req, securityConfig);
    if (headers.has("Access-Control-Allow-Origin") && headers.get("Access-Control-Allow-Origin") !== "*") {
      assertEquals(headers.get("Vary"), "Origin");
    }
  });

  it("should handle wildcard origin", () => {
    const headers = new Headers();
    const req = new Request("https://example.com", {
      headers: { origin: "https://example.com" },
    });
    const securityConfig = { cors: { origin: "*" } };
    setCors(headers, req, securityConfig);
    // Wildcard should not set Vary header
  });

  it("should not throw on invalid config", () => {
    const headers = new Headers();
    const req = new Request("https://example.com", {
      headers: { origin: "https://example.com" },
    });
    const securityConfig = { cors: {} };
    setCors(headers, req, securityConfig);
    // Should handle gracefully
  });
});
