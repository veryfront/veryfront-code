import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { HealthHandler, isServerInitialized, setServerInitialized } from "./health.handler.ts";

describe("server/handlers/monitoring/health", () => {
  describe("setServerInitialized / isServerInitialized", () => {
    it("should default to false", () => {
      // Reset to known state
      setServerInitialized(false);
      assertEquals(isServerInitialized(), false);
    });

    it("should set to true", () => {
      setServerInitialized(true);
      assertEquals(isServerInitialized(), true);
      // Clean up
      setServerInitialized(false);
    });

    it("should toggle back to false", () => {
      setServerInitialized(true);
      setServerInitialized(false);
      assertEquals(isServerInitialized(), false);
    });
  });

  describe("HealthHandler", () => {
    it("should have correct metadata name", () => {
      const handler = new HealthHandler();
      assertEquals(handler.metadata.name, "HealthHandler");
    });

    it("should have patterns for healthz, readyz, and _health", () => {
      const handler = new HealthHandler();
      const handlerPatterns = handler.metadata.patterns;
      assertExists(handlerPatterns);
      const patterns = handlerPatterns.map((p) => typeof p === "string" ? p : p.pattern);
      assertEquals(patterns.includes("/healthz"), true);
      assertEquals(patterns.includes("/readyz"), true);
      assertEquals(patterns.includes("/_health"), true);
    });

    it("should have all patterns marked as exact", () => {
      const handler = new HealthHandler();
      const handlerPatterns = handler.metadata.patterns;
      assertExists(handlerPatterns);
      for (const pattern of handlerPatterns) {
        if (typeof pattern !== "string") {
          assertEquals(pattern.exact, true);
        }
      }
    });
  });
});
