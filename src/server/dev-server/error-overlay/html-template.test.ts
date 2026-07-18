import "#veryfront/schemas/_test-setup.ts";
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

    it("should include url in runtimeError postMessage payload", () => {
      const script = generateRuntimeScript();
      assertEquals(script.includes("action: 'runtimeError'"), true);
      assertEquals(script.includes("url: window.location.href"), true);
    });

    it("targets runtime errors only at a validated Studio origin", () => {
      const script = generateRuntimeScript();
      assertEquals(script.includes("}, vfStudioTargetOrigin());"), true);
      assertEquals(script.includes("}, '*');"), false);
    });

    it("should use vfStudioTargetOrigin (not wildcard) for chatMessage postMessage (SEC-004)", () => {
      const script = generateRuntimeScript();
      // chatMessage (the Fix-in-Veryfront action triggered from the runtime
      // overlay) must target a validated parent origin, never '*'.
      assertEquals(
        script.includes(
          "postMessage({ action: 'chatMessage', prompt: prompt }, vfStudioTargetOrigin())",
        ),
        true,
      );
      assertEquals(
        script.includes("postMessage({ action: 'chatMessage', prompt: prompt }, '*')"),
        false,
      );
    });

    it("embeds the exact hosted Studio origin policy", () => {
      const script = generateRuntimeScript();
      assertEquals(script.includes("function vfStudioTargetOrigin()"), true);
      assertEquals(script.includes('"https://studio.veryfront.com"'), true);
      assertEquals(script.includes('"https://studio.veryfront.org"'), true);
      assertEquals(script.includes("endsWith"), false);
      assertEquals(script.includes(".veryfront.dev"), false);
      assertEquals(script.includes("return window.location.origin"), true);
    });
  });

  describe("generateErrorHTML", () => {
    it("should include error type and message", () => {
      const html = generateErrorHTML({ type: "build", error: new Error("Syntax error") });
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
      const html = generateErrorHTML({ type: "build", error: new Error("oops") });
      assertEquals(html.includes("Suggestion:"), false);
    });

    it("should include stack trace", () => {
      const html = generateErrorHTML({ type: "runtime", error: new Error("test") });
      assertEquals(html.includes("Stack Trace"), true);
    });

    it("should escape HTML in error messages", () => {
      const html = generateErrorHTML({
        type: "build",
        error: new Error("<script>alert(1)</script>"),
      });
      // The escaped version must appear in the visible HTML error display
      assertEquals(html.includes("&lt;script&gt;"), true);
      // The raw tag must NOT appear in the visible HTML sections (error-name, error-message).
      // It may appear inside JSON.stringify() in the postMessage script, which is safe.
      const htmlBodySection = html.split("<script>")[0];
      assertEquals(
        htmlBodySection!.includes("<script>alert(1)</script>"),
        false,
      );
    });

    it("should include error details in postMessage using errors[] array format", () => {
      const html = generateErrorHTML({
        type: "runtime",
        error: new Error("Something broke"),
        file: "src/components/Button.tsx",
        line: 42,
        column: 7,
      });
      // postMessage should use errors[] array with { type, message, file, line, column }
      assertEquals(html.includes("action: 'appUpdated'"), true);
      assertEquals(html.includes("hasError: true"), true);
      assertEquals(html.includes("errors: ["), true);
      assertEquals(html.includes("type: 'error'"), true);
      assertEquals(html.includes(JSON.stringify("Something broke")), true); // message
      assertEquals(html.includes(JSON.stringify("src/components/Button.tsx")), true); // file
      // line and column are emitted as bare values (not JSON-stringified)
      assertEquals(html.includes("line: 42"), true);
      assertEquals(html.includes("column: 7"), true);
    });

    it("targets build errors only at a validated Studio origin", () => {
      const html = generateErrorHTML({ type: "build", error: new Error("fail") });
      assertEquals(html.includes("}, vfStudioTargetOrigin());"), true);
      assertEquals(html.includes("}, '*');"), false);
    });

    it("notifies Studio when projectSlug is omitted", () => {
      const html = generateErrorHTML({ type: "build", error: new Error("fail") });
      const script = html.match(/<script[^>]*>([\s\S]*)<\/script>/)?.[1];
      if (!script) throw new Error("Expected generated error-page script");

      const calls: Array<{ message: unknown; targetOrigin: string }> = [];
      const parent = {
        postMessage(message: unknown, targetOrigin: string): void {
          calls.push({ message, targetOrigin });
        },
      };
      const fakeWindow = {
        parent,
        location: {
          origin: "https://project.preview.veryfront.org",
          href: "https://project.preview.veryfront.org/broken",
          protocol: "https:",
          host: "project.preview.veryfront.org",
          reload(): void {},
        },
      };

      new Function("window", "document", "WebSocket", script)(
        fakeWindow,
        { referrer: "https://studio.veryfront.com/project" },
        class FakeWebSocket {},
      );

      assertEquals(calls.length, 1);
      assertEquals((calls[0]?.message as { action?: unknown })?.action, "appUpdated");
      assertEquals(calls[0]?.targetOrigin, "https://studio.veryfront.com");
    });

    it("should use undefined for missing file/line/column in postMessage errors[]", () => {
      const html = generateErrorHTML({
        type: "build",
        error: new Error("No file info"),
      });
      assertEquals(html.includes("action: 'appUpdated'"), true);
      assertEquals(html.includes("hasError: true"), true);
      assertEquals(html.includes("errors: ["), true);
      assertEquals(html.includes("type: 'error'"), true);
      assertEquals(html.includes(JSON.stringify("No file info")), true); // message
      // file should be JSON.stringify(undefined) which is undefined (bare)
      // line and column should be undefined when not provided
      assertEquals(html.includes("line: undefined"), true);
      assertEquals(html.includes("column: undefined"), true);
    });

    it("should include 'Fix in Veryfront' button when projectSlug is provided", () => {
      const html = generateErrorHTML(
        { type: "runtime", error: new Error("fail"), file: "src/app.tsx" },
        undefined,
        "my-project",
      );
      assertEquals(html.includes("Fix in Veryfront"), true);
      assertEquals(html.includes("vf-fix-btn"), true);
      assertEquals(html.includes('"my-project"'), true);
      assertEquals(html.includes("chatMessage"), true);
    });

    it("should use vfStudioTargetOrigin (not wildcard) for chatMessage postMessage (SEC-004)", () => {
      const html = generateErrorHTML(
        { type: "runtime", error: new Error("fail"), file: "src/app.tsx" },
        undefined,
        "my-project",
      );
      // The chatMessage postMessage must target a validated parent origin derived
      // from document.referrer, never '*'. Error context (stack traces, prompts)
      // must not leak to cross-origin embedders, but a legitimate Studio embed
      // running on a different origin (e.g. veryfront-hosted Studio embedding a
      // localhost dev app) must still receive the message.
      assertEquals(
        html.includes(
          "postMessage({ action: 'chatMessage', prompt: prompt }, vfStudioTargetOrigin())",
        ),
        true,
      );
      assertEquals(
        html.includes("postMessage({ action: 'chatMessage', prompt: prompt }, '*')"),
        false,
      );
    });

    it("embeds the exact hosted Studio origin policy", () => {
      const html = generateErrorHTML(
        { type: "runtime", error: new Error("fail"), file: "src/app.tsx" },
        undefined,
        "my-project",
      );
      assertEquals(html.includes("function vfStudioTargetOrigin()"), true);
      assertEquals(html.includes('"https://studio.veryfront.com"'), true);
      assertEquals(html.includes('"https://studio.veryfront.org"'), true);
      assertEquals(html.includes("endsWith"), false);
      assertEquals(html.includes(".veryfront.dev"), false);
      assertEquals(html.includes("return window.location.origin"), true);
    });

    it("should not include 'Fix in Veryfront' button when projectSlug is not provided", () => {
      const html = generateErrorHTML(
        { type: "runtime", error: new Error("fail") },
      );
      assertEquals(html.includes("Fix in Veryfront"), false);
      assertEquals(html.includes("vf-fix-btn"), false);
    });

    it("should safely embed special characters in postMessage via JSON.stringify", () => {
      const html = generateErrorHTML({
        type: "runtime",
        error: new Error('He said "hello" & <goodbye>'),
        file: "path/with spaces/file.tsx",
      });
      // < is escaped to \u003c to prevent </script> injection
      assertEquals(html.includes("\\u003cgoodbye>"), true);
      assertEquals(html.includes(JSON.stringify("path/with spaces/file.tsx")), true);
    });

    it("should escape </script> in error messages to prevent XSS", () => {
      const html = generateErrorHTML({
        type: "runtime",
        error: new Error("</script><img src=x onerror=alert(1)>"),
      });
      // Must not contain literal </script> from error message
      // The only </script> should be the actual closing tag
      const scriptCloseCount = (html.match(/<\/script>/gi) || []).length;
      assertEquals(scriptCloseCount, 1);
    });

    it("should add CSP nonces to inline style and script tags when provided", () => {
      const html = generateErrorHTML(
        { type: "runtime", error: new Error("nonce test") },
        undefined,
        undefined,
        "nonce-123",
      );

      assertEquals(html.includes('<style nonce="nonce-123">'), true);
      assertEquals(html.includes('<script nonce="nonce-123">'), true);
    });
  });
});
