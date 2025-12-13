import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { generateDevErrorLoggerScript } from "./dev-error-logger.ts";

describe("dev-error-logger", () => {
  describe("generateDevErrorLoggerScript", () => {
    it("should generate script without nonce", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("<script>"));
      assert(!script.includes('nonce="'));
      assert(script.includes("</script>"));
    });

    it("should generate script with nonce attribute", () => {
      const nonce = "test-nonce-abc";
      const script = generateDevErrorLoggerScript(nonce);

      assert(script.includes(`<script nonce="${nonce}">`));
    });

    it("should include HTML comment", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("<!-- Client-side error logger -->"));
    });

    it("should create IIFE to avoid global pollution", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("(function() {"));
      assert(script.includes("})();"));
    });

    it("should include logToServer function", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("const logToServer = (level, message, details)"));
      assert(script.includes("/_veryfront/log"));
      assert(script.includes("method: 'POST'"));
    });

    it("should add error event listener", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("window.addEventListener('error'"));
      assert(script.includes("Uncaught error"));
      assert(script.includes("event.message"));
      assert(script.includes("event.filename"));
      assert(script.includes("event.lineno"));
      assert(script.includes("event.colno"));
    });

    it("should add unhandledrejection event listener", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("window.addEventListener('unhandledrejection'"));
      assert(script.includes("Unhandled promise rejection"));
      assert(script.includes("event.reason"));
    });

    it("should override console.error", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("const origError = console.error"));
      assert(script.includes("console.error = function(...args)"));
      assert(script.includes("origError.apply(console, args)"));
    });

    it("should override console.warn", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("const origWarn = console.warn"));
      assert(script.includes("console.warn = function(...args)"));
      assert(script.includes("origWarn.apply(console, args)"));
    });

    it("should log page loaded event", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("logToServer('info', 'Page loaded'"));
      assert(script.includes("window.location.href"));
      assert(script.includes("navigator.userAgent"));
    });

    it("should include JSON.stringify for logging", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("JSON.stringify"));
      assert(script.includes("timestamp: new Date().toISOString()"));
    });

    it("should handle fetch errors silently", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes(".catch(() => {})"));
      assert(script.includes("// Silently fail if server is unreachable"));
    });

    it("should handle special characters in nonce", () => {
      const nonce = "abc-123_XYZ/+=";
      const script = generateDevErrorLoggerScript(nonce);

      assert(script.includes(`nonce="${nonce}"`));
    });

    it("should handle empty string nonce", () => {
      const script = generateDevErrorLoggerScript("");

      assert(!script.includes('nonce=""'));
      assert(script.includes("<script>"));
    });

    it("should send correct content type", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("'Content-Type': 'application/json'"));
    });

    it("should convert console args to strings", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("args.map(a => String(a))"));
    });

    it("should have try-catch around fetch", () => {
      const script = generateDevErrorLoggerScript();

      assert(script.includes("try {"));
      assert(script.includes("} catch (e) {"));
    });
  });
});
