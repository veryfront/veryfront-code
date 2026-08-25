import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
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
        ".error-container",
      ];

      for (const substring of expectedSubstrings) {
        assertEquals(CLIENT_STYLES.includes(substring), true);
      }
    });

    it("should not contain styles redundant with Tailwind", () => {
      assertEquals(CLIENT_STYLES.includes(".prose"), false);
      assertEquals(CLIENT_STYLES.includes(".loading-container"), false);
      assertEquals(CLIENT_STYLES.includes(".loading-spinner"), false);
      assertEquals(CLIENT_STYLES.includes("@keyframes spin"), false);
    });
  });

  describe("CLIENT_ROUTER_BUNDLE", () => {
    it("should embed the prebundled router", () => {
      assertEquals(
        typeof CLIENT_ROUTER_BUNDLE,
        "string",
        "router bundle must be embedded by the prebundle step",
      );
      assertStringIncludes(
        CLIENT_ROUTER_BUNDLE ?? "",
        "VeryfrontRouter",
        "embedded router bundle contains the router class",
      );
      assertEquals(
        (CLIENT_ROUTER_BUNDLE ?? "").includes("#veryfront/"),
        false,
        "embedded bundle has internal aliases resolved",
      );
    });
  });

  describe("CLIENT_PREFETCH_BUNDLE", () => {
    it("should embed the prebundled prefetch manager", () => {
      assertEquals(
        typeof CLIENT_PREFETCH_BUNDLE,
        "string",
        "prefetch bundle must be embedded by the prebundle step",
      );
      assertStringIncludes(
        CLIENT_PREFETCH_BUNDLE ?? "",
        "PrefetchManager",
        "embedded prefetch bundle contains the prefetch manager",
      );
      assertEquals(
        (CLIENT_PREFETCH_BUNDLE ?? "").includes("#veryfront/"),
        false,
        "embedded bundle has internal aliases resolved",
      );
    });
  });
});
