import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateErrorHTML, generateRuntimeScript } from "./html-template.ts";

describe("server/dev-server/error-overlay/html-template", () => {
  describe("generateRuntimeScript", () => {
    it("should return JavaScript string", () => {
      const script = generateRuntimeScript();
      assertEquals(typeof script, "string");
      assertEquals(script.includes("window.showErrorOverlay"), true);
    });

    it("should include error and unhandledrejection listeners", () => {
      const script = generateRuntimeScript();
      assertEquals(script.includes("addEventListener('error'"), true);
      assertEquals(script.includes("addEventListener('unhandledrejection'"), true);
    });

    it("should include XSS-safe escapeHtml function", () => {
      const script = generateRuntimeScript();
      assertEquals(script.includes("escapeHtml"), true);
    });
  });

  describe("generateErrorHTML", () => {
    it("should include error type and message", () => {
      const html = generateErrorHTML(
        { type: "build", error: new Error("Syntax error") },
      );
      assertEquals(html.includes("Build Error"), true);
      assertEquals(html.includes("Syntax error"), true);
    });

    it("should include file location if provided", () => {
      const html = generateErrorHTML({
        type: "runtime",
        error: new Error("fail"),
        file: "src/app.tsx",
        line: 42,
        column: 5,
      });
      assertEquals(html.includes("src/app.tsx"), true);
      assertEquals(html.includes("42"), true);
      assertEquals(html.includes("5"), true);
    });

    it("should include suggestion if provided", () => {
      const html = generateErrorHTML(
        { type: "build", error: new Error("oops") },
        "Try fixing your imports",
      );
      assertEquals(html.includes("Try fixing your imports"), true);
      assertEquals(html.includes("Suggestion:"), true);
    });

    it("should omit suggestion section when not provided", () => {
      const html = generateErrorHTML(
        { type: "build", error: new Error("oops") },
      );
      assertEquals(html.includes("Suggestion:"), false);
    });

    it("should include stack trace", () => {
      const err = new Error("test");
      const html = generateErrorHTML({ type: "runtime", error: err });
      assertEquals(html.includes("Stack Trace"), true);
    });

    it("should escape HTML in error messages", () => {
      const html = generateErrorHTML({
        type: "build",
        error: new Error("<script>alert(1)</script>"),
      });
      assertEquals(html.includes("<script>alert(1)</script>"), false);
      assertEquals(html.includes("&lt;script&gt;"), true);
    });
  });
});
