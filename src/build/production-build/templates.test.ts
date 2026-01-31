import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CLIENT_PREFETCH_BUNDLE, CLIENT_ROUTER_BUNDLE, CLIENT_STYLES } from "./templates.ts";

describe("build/production-build/templates", () => {
  describe("CLIENT_STYLES", () => {
    it("should be a non-empty string", () => {
      assertEquals(typeof CLIENT_STYLES, "string");
      assertEquals(CLIENT_STYLES.length > 0, true);
    });

    it("should contain expected styles", () => {
      const expectedSubstrings = [
        "body {",
        "margin: 0",
        ".loading-container",
        ".loading-spinner",
        ".error-container",
        ".prose",
        ".prose h1",
        ".prose code",
        ".prose pre",
        "@keyframes spin",
      ];

      for (const substring of expectedSubstrings) {
        assertEquals(CLIENT_STYLES.includes(substring), true);
      }
    });
  });

  describe("CLIENT_ROUTER_BUNDLE", () => {
    it("should be undefined by default (placeholder)", () => {
      assertEquals(CLIENT_ROUTER_BUNDLE, undefined);
    });
  });

  describe("CLIENT_PREFETCH_BUNDLE", () => {
    it("should be undefined by default (placeholder)", () => {
      assertEquals(CLIENT_PREFETCH_BUNDLE, undefined);
    });
  });
});
