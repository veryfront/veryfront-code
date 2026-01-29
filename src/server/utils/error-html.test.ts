import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ErrorPages, generateErrorHtml } from "./error-html.ts";

describe("server/utils/error-html", () => {
  describe("generateErrorHtml", () => {
    it("should generate styled HTML by default", () => {
      const html = generateErrorHtml({
        statusCode: 500,
        title: "Server Error",
        message: "Something broke",
      });
      assertEquals(html.includes("<!DOCTYPE html>"), true);
      assertEquals(html.includes("Server Error"), true);
      assertEquals(html.includes("Something broke"), true);
      assertEquals(html.includes("500"), true);
    });

    it("should generate minimal HTML when minimal=true", () => {
      const html = generateErrorHtml({
        statusCode: 404,
        title: "Not Found",
        message: "Page not found",
        minimal: true,
      });
      assertEquals(html.includes("<h1>404 Not Found</h1>"), true);
      assertEquals(html.includes("Page not found"), true);
      // Minimal should NOT have the styled CSS
      assertEquals(html.includes("--bg"), false);
    });

    it("should replace {path} in minimal mode with pathname", () => {
      const html = generateErrorHtml({
        statusCode: 404,
        title: "Not Found",
        message: "Could not find{path}",
        pathname: "/foo/bar",
        minimal: true,
      });
      assertEquals(html.includes('"/foo/bar"'), true);
    });

    it("should include Veryfront favicon in styled mode", () => {
      const html = generateErrorHtml({
        statusCode: 503,
        title: "Unavailable",
        message: "Try again",
      });
      assertEquals(html.includes("veryfront-favicon.png"), true);
    });
  });

  describe("ErrorPages", () => {
    it("should generate notFound page", () => {
      const html = ErrorPages.notFound("/missing");
      assertEquals(html.includes("Not Found"), true);
      assertEquals(html.includes("/missing"), true);
    });

    it("should generate notFound without pathname", () => {
      const html = ErrorPages.notFound();
      assertEquals(html.includes("Not Found"), true);
      assertEquals(html.includes("could not be found"), true);
    });

    it("should generate serverError page", () => {
      const html = ErrorPages.serverError("Render failed");
      assertEquals(html.includes("Internal Server Error"), true);
      assertEquals(html.includes("Render failed"), true);
    });

    it("should generate serverError with default message", () => {
      const html = ErrorPages.serverError();
      assertEquals(html.includes("Something went wrong"), true);
    });

    it("should generate undeployed page", () => {
      const html = ErrorPages.undeployed();
      assertEquals(html.includes("Not Yet Deployed"), true);
    });

    it("should generate memoryPressure page", () => {
      const html = ErrorPages.memoryPressure();
      assertEquals(html.includes("Service Temporarily Unavailable"), true);
    });
  });
});
