import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CLIENT_PREFETCH_BUNDLE, CLIENT_ROUTER_BUNDLE, CLIENT_STYLES } from "./templates.ts";

describe("build/production-build/templates", () => {
  describe("CLIENT_STYLES", () => {
    it("should be a non-empty string", () => {
      assertEquals(typeof CLIENT_STYLES, "string");
      assertEquals(CLIENT_STYLES.length > 0, true);
    });

    it("should contain body reset styles", () => {
      assertEquals(CLIENT_STYLES.includes("body {"), true);
      assertEquals(CLIENT_STYLES.includes("margin: 0"), true);
    });

    it("should contain loading spinner styles", () => {
      assertEquals(CLIENT_STYLES.includes(".loading-container"), true);
      assertEquals(CLIENT_STYLES.includes(".loading-spinner"), true);
    });

    it("should contain error container styles", () => {
      assertEquals(CLIENT_STYLES.includes(".error-container"), true);
    });

    it("should contain prose typography styles", () => {
      assertEquals(CLIENT_STYLES.includes(".prose"), true);
      assertEquals(CLIENT_STYLES.includes(".prose h1"), true);
      assertEquals(CLIENT_STYLES.includes(".prose code"), true);
      assertEquals(CLIENT_STYLES.includes(".prose pre"), true);
    });

    it("should contain the spin animation keyframe", () => {
      assertEquals(CLIENT_STYLES.includes("@keyframes spin"), true);
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
