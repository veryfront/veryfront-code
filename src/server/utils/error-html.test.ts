import { assertEquals } from "#veryfront/testing/assert.ts";
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
  });

  describe("postMessage errors", () => {
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
  });
});
