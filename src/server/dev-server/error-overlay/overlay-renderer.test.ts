import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorOverlay } from "./overlay-renderer.ts";

describe("server/dev-server/error-overlay/overlay-renderer", () => {
  describe("ErrorOverlay.createHTML", () => {
    it("should return a string containing the error message", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("Something went wrong"),
        file: "/test/file.ts",
      });

      assertEquals(typeof html, "string");
      assertEquals(html.includes("Something went wrong"), true);
    });

    it("should include the file path when provided", () => {
      const html = ErrorOverlay.createHTML({
        type: "runtime",
        error: new Error("parse error"),
        file: "/src/app/page.tsx",
      });

      assertEquals(html.includes("/src/app/page.tsx"), true);
    });

    it("should include the error type", () => {
      const html = ErrorOverlay.createHTML({
        type: "hydration",
        error: new Error("mismatch"),
      });

      assertEquals(html.includes("Hydration"), true);
    });

    it("should use provided suggestion when available", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("some error"),
        suggestion: "Try fixing the syntax",
      });

      assertEquals(html.includes("Try fixing the syntax"), true);
    });

    it("should auto-generate suggestion for known error patterns", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("Cannot find module 'react'"),
      });

      assertEquals(html.includes("module exists"), true);
    });

    it("should produce valid HTML structure", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("test"),
      });

      assertEquals(html.includes("<!DOCTYPE html>") || html.includes("<html"), true);
      assertEquals(html.includes("</html>"), true);
    });

    it("should include line and column when provided", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("syntax error"),
        file: "/test.ts",
        line: 42,
        column: 7,
      });

      assertEquals(html.includes("42"), true);
    });
  });

  describe("ErrorOverlay.getSuggestion", () => {
    it("should return a suggestion for known error pattern: module not found", () => {
      const suggestion = ErrorOverlay.getSuggestion(new Error("Cannot find module 'react'"));

      assertEquals(typeof suggestion, "string");
      assertEquals(suggestion?.includes("module"), true);
    });

    it("should return a suggestion for syntax error pattern", () => {
      const suggestion = ErrorOverlay.getSuggestion(new Error("unexpected token <"));

      assertEquals(typeof suggestion, "string");
      assertEquals(suggestion?.includes("syntax"), true);
    });

    it("should return a suggestion for hydration pattern", () => {
      const suggestion = ErrorOverlay.getSuggestion(new Error("hydration mismatch"));

      assertEquals(typeof suggestion, "string");
      assertEquals(suggestion?.includes("Hydration"), true);
    });

    it("should return a suggestion for hook pattern", () => {
      const suggestion = ErrorOverlay.getSuggestion(new Error("Invalid hook call"));

      assertEquals(typeof suggestion, "string");
      assertEquals(suggestion?.includes("hooks"), true);
    });

    it("should return undefined for unknown errors", () => {
      const suggestion = ErrorOverlay.getSuggestion(new Error("xyz totally random 12345"));
      assertEquals(suggestion, undefined);
    });
  });

  describe("ErrorOverlay.getRuntime", () => {
    it("should return a non-empty string", () => {
      const script = ErrorOverlay.getRuntime();

      assertEquals(typeof script, "string");
      assertEquals(script.length > 0, true);
    });
  });
});
