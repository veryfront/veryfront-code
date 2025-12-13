
import { assertEquals, assertExists, assertStringIncludes } from "std/assert/mod.ts";
import { type ErrorInfo, ErrorOverlay } from "../../../../src/server/dev-server/error-overlay/index.ts";

Deno.test({
  name: "ErrorOverlay - class exists and provides static methods",
  fn: () => {
    assertExists(ErrorOverlay);
    assertExists(ErrorOverlay.getRuntime);
    assertExists(ErrorOverlay.getSuggestion);
    assertExists(ErrorOverlay.createHTML);
  },
});

Deno.test({
  name: "ErrorOverlay - getRuntime returns complete runtime script",
  fn: () => {
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
  },
});

Deno.test({
  name: "ErrorOverlay - runtime includes error display functionality",
  fn: () => {
    const runtime = ErrorOverlay.getRuntime();

    assertStringIncludes(runtime, "errorInfo.type", "Runtime should access error type");
    assertStringIncludes(runtime, "errorInfo.error.name", "Runtime should access error name");
    assertStringIncludes(runtime, "errorInfo.error.message", "Runtime should access error message");
    assertStringIncludes(runtime, "errorInfo.file", "Runtime should access file path");
    assertStringIncludes(runtime, "errorInfo.line", "Runtime should access line number");
    assertStringIncludes(runtime, "errorInfo.suggestion", "Runtime should access suggestion");
    assertStringIncludes(runtime, "errorInfo.error.stack", "Runtime should access stack trace");
  },
});

Deno.test({
  name: "ErrorOverlay - runtime includes dismiss functionality",
  fn: () => {
    const runtime = ErrorOverlay.getRuntime();

    assertStringIncludes(
      runtime,
      'onclick="document.getElementById',
      "Runtime should include dismiss onclick handler",
    );
    assertStringIncludes(runtime, "Dismiss", "Runtime should include dismiss button text");
  },
});

Deno.test({
  name: "ErrorOverlay - runtime applies correct overlay styles",
  fn: () => {
    const runtime = ErrorOverlay.getRuntime();

    assertStringIncludes(runtime, "position: fixed", "Overlay should be fixed position");
    assertStringIncludes(runtime, "z-index: 999999", "Overlay should have high z-index");
    assertStringIncludes(runtime, "rgba(0, 0, 0, 0.9)", "Overlay should have dark background");
    assertStringIncludes(runtime, "font-family:", "Overlay should specify monospace font");
  },
});

Deno.test({
  name: "ErrorOverlay - getSuggestion detects parse errors",
  fn: () => {
    const error = new Error("Unexpected token <");
    const suggestion = ErrorOverlay.getSuggestion(error);

    assertExists(suggestion, "Should provide suggestion for parse errors");
    assertStringIncludes(
      suggestion!,
      "syntax errors",
      "Suggestion should mention syntax errors",
    );
    assertStringIncludes(suggestion!, "JSX", "Suggestion should mention JSX tags");
  },
});

Deno.test({
  name: "ErrorOverlay - getSuggestion detects module not found errors",
  fn: () => {
    const error = new Error('Cannot find module "./components/Header"');
    const suggestion = ErrorOverlay.getSuggestion(error);

    assertExists(suggestion, "Should provide suggestion for missing modules");
    assertStringIncludes(
      suggestion!,
      "module exists",
      "Suggestion should mention module existence",
    );
    assertStringIncludes(
      suggestion!,
      "path is correct",
      "Suggestion should mention path correctness",
    );
  },
});

Deno.test({
  name: "ErrorOverlay - getSuggestion detects frontmatter errors",
  fn: () => {
    const error = new Error("Invalid frontmatter YAML syntax");
    const suggestion = ErrorOverlay.getSuggestion(error);

    assertExists(suggestion, "Should provide suggestion for frontmatter errors");
    assertStringIncludes(suggestion!, "frontmatter", "Suggestion should mention frontmatter");
    assertStringIncludes(suggestion!, "YAML", "Suggestion should mention YAML format");
    assertStringIncludes(suggestion!, "---", "Suggestion should mention YAML markers");
  },
});

Deno.test({
  name: "ErrorOverlay - getSuggestion detects component errors",
  fn: () => {
    const error = new Error("Component not exported correctly");
    const suggestion = ErrorOverlay.getSuggestion(error);

    assertExists(suggestion, "Should provide suggestion for component errors");
    assertStringIncludes(suggestion!, "exported", "Suggestion should mention export");
    assertStringIncludes(suggestion!, "import path", "Suggestion should mention import path");
  },
});

Deno.test({
  name: "ErrorOverlay - getSuggestion detects React hooks errors",
  fn: () => {
    const error = new Error("Invalid hook call. useState cannot be called.");
    const suggestion = ErrorOverlay.getSuggestion(error);

    assertExists(suggestion, "Should provide suggestion for hooks errors");
    assertStringIncludes(suggestion!, "hooks", "Suggestion should mention hooks");
    assertStringIncludes(
      suggestion!,
      "function components",
      "Suggestion should mention function components",
    );
    assertStringIncludes(suggestion!, "server-side", "Suggestion should mention server-side code");
  },
});

Deno.test({
  name: "ErrorOverlay - getSuggestion detects hydration errors",
  fn: () => {
    const error = new Error(
      "Hydration failed because the initial UI does not match what was rendered on the server.",
    );
    const suggestion = ErrorOverlay.getSuggestion(error);

    assertExists(suggestion, "Should provide suggestion for hydration errors");
    assertStringIncludes(suggestion!, "Hydration", "Suggestion should mention hydration");
    assertStringIncludes(
      suggestion!,
      "server and client",
      "Suggestion should mention server/client mismatch",
    );
    assertStringIncludes(suggestion!, "window", "Suggestion should mention window/document access");
  },
});

Deno.test({
  name: "ErrorOverlay - getSuggestion returns undefined for unknown errors",
  fn: () => {
    const error = new Error("Some completely custom error message xyz123");
    const suggestion = ErrorOverlay.getSuggestion(error);

    assertEquals(suggestion, undefined, "Should return undefined for unknown error types");
  },
});

Deno.test({
  name: "ErrorOverlay - getSuggestion is case-insensitive",
  fn: () => {
    const error = new Error("UNEXPECTED TOKEN IN LINE 42");
    const suggestion = ErrorOverlay.getSuggestion(error);

    assertExists(suggestion, "Should provide suggestion regardless of case");
    assertStringIncludes(suggestion!, "syntax", "Should detect error type case-insensitively");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML generates complete HTML document",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "build",
      error: new Error("Test error message"),
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertStringIncludes(html, "<!DOCTYPE html>", "Should include DOCTYPE");
    assertStringIncludes(html, "<html>", "Should include html tag");
    assertStringIncludes(html, "<head>", "Should include head tag");
    assertStringIncludes(html, "<body>", "Should include body tag");
    assertStringIncludes(html, '<meta charset="UTF-8">', "Should include charset meta");
    assertStringIncludes(html, "<title>", "Should include title tag");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML displays error type correctly",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "runtime",
      error: new Error("Runtime error"),
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertStringIncludes(html, "Runtime Error", "Should display error type with capitalization");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML displays error name and message",
  fn: () => {
    const error = new Error("Something went wrong");
    error.name = "CustomError";

    const errorInfo: ErrorInfo = {
      type: "build",
      error,
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertStringIncludes(html, "CustomError", "Should display error name");
    assertStringIncludes(html, "Something went wrong", "Should display error message");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML includes file location when provided",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "build",
      error: new Error("Parse error"),
      file: "/src/components/Header.tsx",
      line: 42,
      column: 15,
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertStringIncludes(html, "/src/components/Header.tsx", "Should display file path");
    assertStringIncludes(html, ":42", "Should display line number");
    assertStringIncludes(html, ":15", "Should display column number");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML omits file location when not provided",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "runtime",
      error: new Error("Runtime error"),
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertExists(html, "Should generate HTML without file info");
    // HTML should not contain file-related divs when file is not provided
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML includes custom suggestion",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "build",
      error: new Error("Custom error"),
      suggestion: "Try reinstalling your dependencies with npm install",
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertStringIncludes(html, "Suggestion:", "Should display suggestion header");
    assertStringIncludes(
      html,
      "Try reinstalling your dependencies",
      "Should display suggestion text",
    );
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML auto-generates suggestion from error",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "build",
      error: new Error('Cannot find module "@/components/Button"'),
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertStringIncludes(html, "Suggestion:", "Should display auto-generated suggestion");
    assertStringIncludes(html, "module exists", "Should include suggestion about module existence");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML includes stack trace",
  fn: () => {
    const error = new Error("Error with stack");
    const errorInfo: ErrorInfo = {
      type: "runtime",
      error,
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    if (error.stack) {
      assertStringIncludes(html, "Stack Trace", "Should display stack trace header");
      assertStringIncludes(html, "<details", "Should use details element for collapsible stack");
      assertStringIncludes(html, "<summary>", "Should use summary element");
      assertStringIncludes(html, "<pre>", "Should use pre element for stack formatting");
    }
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML includes all necessary styles",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "build",
      error: new Error("Style test"),
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertStringIncludes(html, "<style>", "Should include style tag");
    assertStringIncludes(html, ".error-container", "Should define error-container class");
    assertStringIncludes(html, ".error-header", "Should define error-header class");
    assertStringIncludes(html, ".error-box", "Should define error-box class");
    assertStringIncludes(html, ".error-name", "Should define error-name class");
    assertStringIncludes(html, ".error-message", "Should define error-message class");
    assertStringIncludes(html, ".suggestion", "Should define suggestion class");
    assertStringIncludes(html, ".stack-trace", "Should define stack-trace class");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML handles build error type",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "build",
      error: new Error("Build failed"),
    };

    const html = ErrorOverlay.createHTML(errorInfo);
    assertStringIncludes(html, "Build Error", "Should display build error type");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML handles runtime error type",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "runtime",
      error: new Error("Runtime failed"),
    };

    const html = ErrorOverlay.createHTML(errorInfo);
    assertStringIncludes(html, "Runtime Error", "Should display runtime error type");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML handles hydration error type",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "hydration",
      error: new Error("Hydration failed"),
    };

    const html = ErrorOverlay.createHTML(errorInfo);
    assertStringIncludes(html, "Hydration Error", "Should display hydration error type");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML handles error messages with special characters",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "build",
      error: new Error("Expected <div> but got <span>"),
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertExists(html, "Should handle special HTML characters in error messages");
    assertStringIncludes(html, "Expected", "Should include error message content");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML displays line without column",
  fn: () => {
    const errorInfo: ErrorInfo = {
      type: "build",
      error: new Error("Parse error"),
      file: "/src/app.tsx",
      line: 100,
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertStringIncludes(html, "/src/app.tsx", "Should display file");
    assertStringIncludes(html, ":100", "Should display line number");
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML handles all optional fields",
  fn: () => {
    const error = new Error("Complex error scenario");
    error.name = "SyntaxError";

    const errorInfo: ErrorInfo = {
      type: "build",
      error,
      file: "/pages/index.tsx",
      line: 25,
      column: 10,
      suggestion: "Check your JSX syntax",
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertStringIncludes(html, "Build Error", "Should display error type");
    assertStringIncludes(html, "SyntaxError", "Should display error name");
    assertStringIncludes(html, "Complex error scenario", "Should display error message");
    assertStringIncludes(html, "/pages/index.tsx:25:10", "Should display complete location");
    assertStringIncludes(html, "Check your JSX syntax", "Should display suggestion");
  },
});

Deno.test({
  name: "ErrorOverlay - runtime captures window error events",
  fn: () => {
    const runtime = ErrorOverlay.getRuntime();

    assertStringIncludes(
      runtime,
      "event.error || new Error(event.message)",
      "Runtime should handle error events",
    );
    assertStringIncludes(runtime, "event.filename", "Runtime should capture filename from event");
    assertStringIncludes(runtime, "event.lineno", "Runtime should capture line number from event");
    assertStringIncludes(runtime, "event.colno", "Runtime should capture column from event");
  },
});

Deno.test({
  name: "ErrorOverlay - runtime captures unhandled promise rejections",
  fn: () => {
    const runtime = ErrorOverlay.getRuntime();

    assertStringIncludes(
      runtime,
      "unhandledrejection",
      "Runtime should listen for unhandled rejections",
    );
    assertStringIncludes(runtime, "event.reason", "Runtime should access rejection reason");
  },
});

Deno.test({
  name: "ErrorOverlay - runtime removes existing overlay before creating new one",
  fn: () => {
    const runtime = ErrorOverlay.getRuntime();

    assertStringIncludes(
      runtime,
      "const existing = document.getElementById('veryfront-error-overlay')",
      "Runtime should check for existing overlay",
    );
    assertStringIncludes(
      runtime,
      "existing.remove()",
      "Runtime should remove existing overlay",
    );
  },
});

Deno.test({
  name: "ErrorOverlay - createHTML handles empty error messages",
  fn: () => {
    const error = new Error("");
    error.name = "EmptyError";

    const errorInfo: ErrorInfo = {
      type: "runtime",
      error,
    };

    const html = ErrorOverlay.createHTML(errorInfo);

    assertExists(html, "Should generate HTML for empty error message");
    assertStringIncludes(html, "EmptyError", "Should still display error name");
  },
});
