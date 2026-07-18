import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveRateLimitClientKey } from "./client-key.ts";

describe("resolveRateLimitClientKey", () => {
  it("ignores client-controlled proxy headers by default", () => {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "198.51.100.1",
        "x-real-ip": "198.51.100.2",
      },
    });

    assertEquals(resolveRateLimitClientKey(request, false, "anonymous"), "anonymous");
  });

  it("uses the address appended by the nearest trusted proxy", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.8" },
    });

    assertEquals(resolveRateLimitClientKey(request, true, "anonymous"), "203.0.113.8");
  });

  it("uses X-Real-IP only when proxy headers are trusted", () => {
    const request = new Request("https://example.com", {
      headers: { "x-real-ip": "198.51.100.2" },
    });

    assertEquals(resolveRateLimitClientKey(request, true, "anonymous"), "198.51.100.2");
  });
});
