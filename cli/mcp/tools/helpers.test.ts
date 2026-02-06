/**
 * Tests for MCP tools helpers
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  formatError,
  getProjectDir,
  ROUTE_FILTER_MAP,
  toComponentName,
  toSlug,
} from "./helpers.ts";

describe("mcp/tools/helpers", () => {
  describe("toComponentName", () => {
    it("converts simple slug to PascalCase", () => {
      assertEquals(toComponentName("about"), "About");
    });

    it("converts hyphenated slug to PascalCase", () => {
      assertEquals(toComponentName("about-us"), "AboutUs");
    });

    it("converts slug with path to PascalCase using last segment", () => {
      assertEquals(toComponentName("pages/about-us"), "AboutUs");
    });

    it("handles underscores (preserved in component name)", () => {
      // Underscores are not word separators, only non-word characters
      assertEquals(toComponentName("user_profile"), "User_profile");
    });

    it("handles multiple hyphens", () => {
      assertEquals(toComponentName("my-super-component"), "MySuperComponent");
    });

    it("handles empty string", () => {
      assertEquals(toComponentName(""), "");
    });

    it("handles single character", () => {
      assertEquals(toComponentName("a"), "A");
    });

    it("handles numbers", () => {
      assertEquals(toComponentName("page-1"), "Page1");
    });
  });

  describe("toSlug", () => {
    it("converts spaces to hyphens", () => {
      assertEquals(toSlug("hello world"), "hello-world");
    });

    it("converts to lowercase", () => {
      assertEquals(toSlug("HelloWorld"), "helloworld");
    });

    it("removes special characters", () => {
      assertEquals(toSlug("hello@world!"), "helloworld");
    });

    it("preserves hyphens", () => {
      assertEquals(toSlug("hello-world"), "hello-world");
    });

    it("preserves underscores", () => {
      assertEquals(toSlug("hello_world"), "hello_world");
    });

    it("preserves forward slashes", () => {
      assertEquals(toSlug("pages/about"), "pages/about");
    });

    it("preserves square brackets for dynamic routes", () => {
      assertEquals(toSlug("users/[id]"), "users/[id]");
    });

    it("collapses multiple slashes", () => {
      assertEquals(toSlug("pages//about///test"), "pages/about/test");
    });

    it("handles empty string", () => {
      assertEquals(toSlug(""), "");
    });
  });

  describe("formatError", () => {
    it("extracts message from Error objects", () => {
      const error = new Error("Something went wrong");
      assertEquals(formatError(error), "Something went wrong");
    });

    it("converts string to string", () => {
      assertEquals(formatError("string error"), "string error");
    });

    it("converts number to string", () => {
      assertEquals(formatError(42), "42");
    });

    it("converts null to string", () => {
      assertEquals(formatError(null), "null");
    });

    it("converts undefined to string", () => {
      assertEquals(formatError(undefined), "undefined");
    });

    it("converts object to string", () => {
      const result = formatError({ foo: "bar" });
      assertEquals(result, "[object Object]");
    });
  });

  describe("getProjectDir", () => {
    it("returns provided path if specified", () => {
      assertEquals(getProjectDir("/custom/path"), "/custom/path");
    });

    it("returns cwd() if path not specified", () => {
      const result = getProjectDir();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });
  });

  describe("ROUTE_FILTER_MAP", () => {
    it("maps pages to page types", () => {
      assertEquals(ROUTE_FILTER_MAP.pages, ["page"]);
    });

    it("maps api to api types", () => {
      assertEquals(ROUTE_FILTER_MAP.api, ["api"]);
    });

    it("maps layouts to layout types", () => {
      assertEquals(ROUTE_FILTER_MAP.layouts, ["layout"]);
    });
  });
});
