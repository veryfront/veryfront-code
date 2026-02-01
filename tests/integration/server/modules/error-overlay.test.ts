/**
 * Tests for Error Overlay Module
 *
 * Test coverage for error formatting, HTML generation, suggestion system,
 * and runtime overlay functionality in development mode.
 */

import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  type ErrorInfo,
  ErrorOverlay,
} from "../../../../src/server/dev-server/error-overlay/index.ts";

describe("ErrorOverlay Tests", () => {
  describe("ErrorOverlay - class structure", () => {
    it("exists and provides static methods", () => {
      assertExists(ErrorOverlay);
      assertExists(ErrorOverlay.getRuntime);
      assertExists(ErrorOverlay.getSuggestion);
      assertExists(ErrorOverlay.createHTML);
    });
  });

  describe("ErrorOverlay - getRuntime", () => {
    it("returns complete runtime script", () => {
      const runtime = ErrorOverlay.getRuntime();

      assertExists(runtime, "Runtime script should exist");
      assertStringIncludes(
        runtime,
        "window.showErrorOverlay",
        "Runtime should define showErrorOverlay function",
      );
      assertStringIncludes(
        runtime,
        "veryfront-error-overlay",
        "Runtime should reference overlay element ID",
      );
      assertStringIncludes(
        runtime,
        "window.addEventListener('error'",
        "Runtime should listen for error events",
      );
      assertStringIncludes(
        runtime,
        "window.addEventListener('unhandledrejection'",
        "Runtime should listen for unhandled rejections",
      );
    });

    it("includes error display functionality", () => {
      const runtime = ErrorOverlay.getRuntime();

      assertStringIncludes(runtime, "errorInfo.type", "Runtime should access error type");
      assertStringIncludes(runtime, "errorInfo.error.name", "Runtime should access error name");
      assertStringIncludes(runtime, "errorInfo.error.message", "Runtime should access error message");
      assertStringIncludes(runtime, "errorInfo.file", "Runtime should access file path");
      assertStringIncludes(runtime, "errorInfo.line", "Runtime should access line number");
      assertStringIncludes(runtime, "errorInfo.suggestion", "Runtime should access suggestion");
      assertStringIncludes(runtime, "errorInfo.error.stack", "Runtime should access stack trace");
    });

    it("includes dismiss functionality", () => {
      const runtime = ErrorOverlay.getRuntime();

      assertStringIncludes(
        runtime,
        'onclick="document.getElementById',
        "Runtime should include dismiss onclick handler",
      );
      assertStringIncludes(runtime, "Dismiss", "Runtime should include dismiss button text");
    });

    it("applies correct overlay styles", () => {
      const runtime = ErrorOverlay.getRuntime();

      assertStringIncludes(runtime, "position: fixed", "Overlay should be fixed position");
      assertStringIncludes(runtime, "z-index: 999999", "Overlay should have high z-index");
      assertStringIncludes(runtime, "rgba(0, 0, 0, 0.9)", "Overlay should have dark background");
      assertStringIncludes(runtime, "font-family:", "Overlay should specify monospace font");
    });

    it("captures window error events", () => {
      const runtime = ErrorOverlay.getRuntime();

      assertStringIncludes(
        runtime,
        "event.error || new Error(event.message)",
        "Runtime should handle error events",
      );
      assertStringIncludes(runtime, "event.filename", "Runtime should capture filename from event");
      assertStringIncludes(runtime, "event.lineno", "Runtime should capture line number from event");
      assertStringIncludes(runtime, "event.colno", "Runtime should capture column from event");
    });

    it("captures unhandled promise rejections", () => {
      const runtime = ErrorOverlay.getRuntime();

      assertStringIncludes(
        runtime,
        "unhandledrejection",
        "Runtime should listen for unhandled rejections",
      );
      assertStringIncludes(runtime, "event.reason", "Runtime should access rejection reason");
    });

    it("removes existing overlay before creating new one", () => {
      const runtime = ErrorOverlay.getRuntime();

      assertStringIncludes(
        runtime,
        "const existing = document.getElementById('veryfront-error-overlay')",
        "Runtime should check for existing overlay",
      );
      assertStringIncludes(runtime, "existing.remove()", "Runtime should remove existing overlay");
    });
  });

  describe("ErrorOverlay - getSuggestion", () => {
    it("detects parse errors", () => {
      const suggestion = ErrorOverlay.getSuggestion(new Error("Unexpected token <"));

      assertExists(suggestion, "Should provide suggestion for parse errors");
      assertStringIncludes(suggestion!, "syntax errors", "Suggestion should mention syntax errors");
      assertStringIncludes(suggestion!, "JSX", "Suggestion should mention JSX tags");
    });

    it("detects module not found errors", () => {
      const suggestion = ErrorOverlay.getSuggestion(
        new Error('Cannot find module "./components/Header"'),
      );

      assertExists(suggestion, "Should provide suggestion for missing modules");
      assertStringIncludes(suggestion!, "module exists", "Suggestion should mention module existence");
      assertStringIncludes(
        suggestion!,
        "path is correct",
        "Suggestion should mention path correctness",
      );
    });

    it("detects frontmatter errors", () => {
      const suggestion = ErrorOverlay.getSuggestion(new Error("Invalid frontmatter YAML syntax"));

      assertExists(suggestion, "Should provide suggestion for frontmatter errors");
      assertStringIncludes(suggestion!, "frontmatter", "Suggestion should mention frontmatter");
      assertStringIncludes(suggestion!, "YAML", "Suggestion should mention YAML format");
      assertStringIncludes(suggestion!, "---", "Suggestion should mention YAML markers");
    });

    it("detects component errors", () => {
      const suggestion = ErrorOverlay.getSuggestion(new Error("Component not exported correctly"));

      assertExists(suggestion, "Should provide suggestion for component errors");
      assertStringIncludes(suggestion!, "exported", "Suggestion should mention export");
      assertStringIncludes(suggestion!, "import path", "Suggestion should mention import path");
    });

    it("detects React hooks errors", () => {
      const suggestion = ErrorOverlay.getSuggestion(
        new Error("Invalid hook call. useState cannot be called."),
      );

      assertExists(suggestion, "Should provide suggestion for hooks errors");
      assertStringIncludes(suggestion!, "hooks", "Suggestion should mention hooks");
      assertStringIncludes(
        suggestion!,
        "function components",
        "Suggestion should mention function components",
      );
      assertStringIncludes(suggestion!, "server-side", "Suggestion should mention server-side code");
    });

    it("detects hydration errors", () => {
      const suggestion = ErrorOverlay.getSuggestion(
        new Error(
          "Hydration failed because the initial UI does not match what was rendered on the server.",
        ),
      );

      assertExists(suggestion, "Should provide suggestion for hydration errors");
      assertStringIncludes(suggestion!, "Hydration", "Suggestion should mention hydration");
      assertStringIncludes(
        suggestion!,
        "server and client",
        "Suggestion should mention server/client mismatch",
      );
      assertStringIncludes(
        suggestion!,
        "window",
        "Suggestion should mention window/document access",
      );
    });

    it("returns undefined for unknown errors", () => {
      const suggestion = ErrorOverlay.getSuggestion(new Error("Some completely custom error message xyz123"));

      assertEquals(suggestion, undefined, "Should return undefined for unknown error types");
    });

    it("is case-insensitive", () => {
      const suggestion = ErrorOverlay.getSuggestion(new Error("UNEXPECTED TOKEN IN LINE 42"));

      assertExists(suggestion, "Should provide suggestion regardless of case");
      assertStringIncludes(suggestion!, "syntax", "Should detect error type case-insensitively");
    });
  });

  describe("ErrorOverlay - createHTML", () => {
    it("generates complete HTML document", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("Test error message"),
      });

      assertStringIncludes(html, "<!DOCTYPE html>", "Should include DOCTYPE");
      assertStringIncludes(html, "<html>", "Should include html tag");
      assertStringIncludes(html, "<head>", "Should include head tag");
      assertStringIncludes(html, "<body>", "Should include body tag");
      assertStringIncludes(html, '<meta charset="UTF-8">', "Should include charset meta");
      assertStringIncludes(html, "<title>", "Should include title tag");
    });

    it("displays error type correctly", () => {
      const html = ErrorOverlay.createHTML({
        type: "runtime",
        error: new Error("Runtime error"),
      });

      assertStringIncludes(html, "Runtime Error", "Should display error type with capitalization");
    });

    it("displays error name and message", () => {
      const error = new Error("Something went wrong");
      error.name = "CustomError";

      const html = ErrorOverlay.createHTML({
        type: "build",
        error,
      });

      assertStringIncludes(html, "CustomError", "Should display error name");
      assertStringIncludes(html, "Something went wrong", "Should display error message");
    });

    it("includes file location when provided", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("Parse error"),
        file: "/src/components/Header.tsx",
        line: 42,
        column: 15,
      });

      assertStringIncludes(html, "/src/components/Header.tsx", "Should display file path");
      assertStringIncludes(html, ":42", "Should display line number");
      assertStringIncludes(html, ":15", "Should display column number");
    });

    it("omits file location when not provided", () => {
      const html = ErrorOverlay.createHTML({
        type: "runtime",
        error: new Error("Runtime error"),
      });

      assertExists(html, "Should generate HTML without file info");
    });

    it("includes custom suggestion", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("Custom error"),
        suggestion: "Try reinstalling your dependencies with npm install",
      });

      assertStringIncludes(html, "Suggestion:", "Should display suggestion header");
      assertStringIncludes(html, "Try reinstalling your dependencies", "Should display suggestion text");
    });

    it("auto-generates suggestion from error", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error('Cannot find module "@/components/Button"'),
      });

      assertStringIncludes(html, "Suggestion:", "Should display auto-generated suggestion");
      assertStringIncludes(html, "module exists", "Should include suggestion about module existence");
    });

    it("includes stack trace", () => {
      const error = new Error("Error with stack");

      const html = ErrorOverlay.createHTML({
        type: "runtime",
        error,
      });

      if (!error.stack) return;

      assertStringIncludes(html, "Stack Trace", "Should display stack trace header");
      assertStringIncludes(html, "<details", "Should use details element for collapsible stack");
      assertStringIncludes(html, "<summary>", "Should use summary element");
      assertStringIncludes(html, "<pre>", "Should use pre element for stack formatting");
    });

    it("includes all necessary styles", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("Style test"),
      });

      assertStringIncludes(html, "<style>", "Should include style tag");
      assertStringIncludes(html, ".error-container", "Should define error-container class");
      assertStringIncludes(html, ".error-header", "Should define error-header class");
      assertStringIncludes(html, ".error-box", "Should define error-box class");
      assertStringIncludes(html, ".error-name", "Should define error-name class");
      assertStringIncludes(html, ".error-message", "Should define error-message class");
      assertStringIncludes(html, ".suggestion", "Should define suggestion class");
      assertStringIncludes(html, ".stack-trace", "Should define stack-trace class");
    });

    it("handles build error type", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("Build failed"),
      });

      assertStringIncludes(html, "Build Error", "Should display build error type");
    });

    it("handles runtime error type", () => {
      const html = ErrorOverlay.createHTML({
        type: "runtime",
        error: new Error("Runtime failed"),
      });

      assertStringIncludes(html, "Runtime Error", "Should display runtime error type");
    });

    it("handles hydration error type", () => {
      const html = ErrorOverlay.createHTML({
        type: "hydration",
        error: new Error("Hydration failed"),
      });

      assertStringIncludes(html, "Hydration Error", "Should display hydration error type");
    });

    it("handles error messages with special characters", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("Expected <div> but got <span>"),
      });

      assertExists(html, "Should handle special HTML characters in error messages");
      assertStringIncludes(html, "Expected", "Should include error message content");
    });

    it("displays line without column", () => {
      const html = ErrorOverlay.createHTML({
        type: "build",
        error: new Error("Parse error"),
        file: "/src/app.tsx",
        line: 100,
      });

      assertStringIncludes(html, "/src/app.tsx", "Should display file");
      assertStringIncludes(html, ":100", "Should display line number");
    });

    it("handles all optional fields", () => {
      const error = new Error("Complex error scenario");
      error.name = "SyntaxError";

      const html = ErrorOverlay.createHTML({
        type: "build",
        error,
        file: "/pages/index.tsx",
        line: 25,
        column: 10,
        suggestion: "Check your JSX syntax",
      });

      assertStringIncludes(html, "Build Error", "Should display error type");
      assertStringIncludes(html, "SyntaxError", "Should display error name");
      assertStringIncludes(html, "Complex error scenario", "Should display error message");
      assertStringIncludes(html, "/pages/index.tsx:25:10", "Should display complete location");
      assertStringIncludes(html, "Check your JSX syntax", "Should display suggestion");
    });

    it("handles empty error messages", () => {
      const error = new Error("");
      error.name = "EmptyError";

      const html = ErrorOverlay.createHTML({
        type: "runtime",
        error,
      });

      assertExists(html, "Should generate HTML for empty error message");
      assertStringIncludes(html, "EmptyError", "Should still display error name");
    });
  });
});
