import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorPages, generateErrorHtml } from "./error-html.ts";

function assertIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), true);
}

function assertNotIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), false);
}

describe("server/utils/error-html", () => {
  describe("generateErrorHtml", () => {
    it("should generate styled HTML by default", () => {
      const html = generateErrorHtml({
        statusCode: 500,
        title: "Server Error",
        message: "Something broke",
      });

      assertIncludes(html, "<!DOCTYPE html>");
      assertIncludes(html, "Server Error");
      assertIncludes(html, "Something broke");
      assertIncludes(html, "500");
    });

    it("should generate minimal HTML when minimal=true", () => {
      const html = generateErrorHtml({
        statusCode: 404,
        title: "Not Found",
        message: "Page not found",
        minimal: true,
      });

      assertIncludes(html, "<h1>404 Not Found</h1>");
      assertIncludes(html, "Page not found");
      assertNotIncludes(html, "--bg");
    });

    it("should replace {path} in minimal mode with pathname", () => {
      const html = generateErrorHtml({
        statusCode: 404,
        title: "Not Found",
        message: "Could not find{path}",
        pathname: "/foo/bar",
        minimal: true,
      });

      assertIncludes(html, "&quot;/foo/bar&quot;");
    });

    it("should include Veryfront favicon in styled mode", () => {
      const html = generateErrorHtml({
        statusCode: 503,
        title: "Unavailable",
        message: "Try again",
      });

      assertIncludes(html, "veryfront-favicon.png");
    });
  });

  describe("ErrorPages", () => {
    it("should generate notFound page", () => {
      const html = ErrorPages.notFound("/missing");

      assertIncludes(html, "Not Found");
      assertIncludes(html, "/missing");
    });

    it("should generate notFound without pathname", () => {
      const html = ErrorPages.notFound();

      assertIncludes(html, "Not Found");
      assertIncludes(html, "could not be found");
    });

    it("should generate serverError page", () => {
      const html = ErrorPages.serverError("Render failed");

      assertIncludes(html, "Internal Server Error");
      assertIncludes(html, "Render failed");
    });

    it("should generate serverError with default message", () => {
      const html = ErrorPages.serverError();

      assertIncludes(html, "Something went wrong");
    });

    it("should generate undeployed page", () => {
      const html = ErrorPages.undeployed();

      assertIncludes(html, "Not Yet Deployed");
    });

    it("should generate memoryPressure page", () => {
      const html = ErrorPages.memoryPressure();

      assertIncludes(html, "Service Temporarily Unavailable");
    });

    it("escapes request-controlled text in the styled page", () => {
      const html = ErrorPages.notFound("/<img src=x onerror=alert(1)>");

      assertEquals(
        html.includes("<img src=x"),
        false,
        "a reflected pathname must not reach the 404 body as live markup",
      );
      assertStringIncludes(
        html,
        "&lt;img src=x",
        "a reflected pathname must be HTML-escaped in the 404 body",
      );
    });

    it("escapes title and message metacharacters in the styled page", () => {
      const html = generateErrorHtml({
        statusCode: 500,
        title: "A & B <b>",
        message: '"quoted" <script>alert(1)</script>',
      });

      assertStringIncludes(html, "&lt;script&gt;", "the message script tag must be escaped");
      assertStringIncludes(html, "&amp;", "the title ampersand must be escaped");
      assertEquals(
        html.includes("<script>alert(1)</script>"),
        false,
        "the raw message script must not appear anywhere in the document",
      );
      assertEquals(
        html.includes("<b>"),
        false,
        "the raw title markup must not appear anywhere in the document, including <title>",
      );
    });
  });

  describe("postMessage errors", () => {
    it("targets only an exact trusted Studio origin", () => {
      const html = ErrorPages.serverError();

      assertIncludes(html, "vfStudioTargetOrigin()");
      assertIncludes(html, '"https://veryfront.com"');
      assertNotIncludes(html, "studio.veryfront.com");
      assertNotIncludes(html, "endsWith");
      assertNotIncludes(html, "}, '*'");
    });

    it("should emit postMessage with type 'warning' for 404 pages", () => {
      const html = ErrorPages.notFound("/missing");

      assertIncludes(html, "type: 'warning'");
      assertIncludes(html, "appUpdated");
      assertIncludes(html, "hasError: true");
    });

    it("should emit postMessage with type 'warning' for undeployed pages", () => {
      const html = ErrorPages.undeployed();

      assertIncludes(html, "type: 'warning'");
    });

    it("should emit postMessage with type 'error' for 500 pages", () => {
      const html = ErrorPages.serverError();

      assertIncludes(html, "type: 'error'");
    });

    it("should emit postMessage with type 'error' for 503 pages", () => {
      const html = ErrorPages.memoryPressure();

      assertIncludes(html, "type: 'error'");
    });

    it("unicode-escapes a closing script tag inside the inline script", () => {
      const html = ErrorPages.notFound("/a</script><img src=x onerror=alert(1)>");

      assertStringIncludes(
        html,
        "\\u003c/script>",
        "a path containing </script> must be unicode-escaped inside the inline script",
      );
      assertEquals(
        html.includes("/a</script>"),
        false,
        "the raw closing tag must never reach the inline script body",
      );
    });
  });
});
