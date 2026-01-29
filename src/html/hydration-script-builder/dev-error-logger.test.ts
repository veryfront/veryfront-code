import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateDevErrorLoggerScript } from "./dev-error-logger.ts";

describe("hydration-script-builder/dev-error-logger", () => {
  describe("generateDevErrorLoggerScript", () => {
    it("should return a script tag", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("<script"), true);
      assertEquals(result.includes("</script>"), true);
    });

    it("should include nonce attribute when provided", () => {
      const result = generateDevErrorLoggerScript("abc123");
      assertEquals(result.includes('nonce="abc123"'), true);
    });

    it("should not include nonce attribute when not provided", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("nonce="), false);
    });

    it("should not include nonce attribute when undefined", () => {
      const result = generateDevErrorLoggerScript(undefined);
      assertEquals(result.includes("nonce="), false);
    });

    it("should include error event listener", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("addEventListener('error'"), true);
    });

    it("should include unhandled rejection listener", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("addEventListener('unhandledrejection'"), true);
    });

    it("should log to server endpoint", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("/_veryfront/log"), true);
    });

    it("should override console.error", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("console.error"), true);
    });

    it("should override console.warn", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("console.warn"), true);
    });

    it("should include page loaded log", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("Page loaded"), true);
    });

    it("should include HTML comment describing purpose", () => {
      const result = generateDevErrorLoggerScript();
      assertEquals(result.includes("Client-side error logger"), true);
    });
  });
});
