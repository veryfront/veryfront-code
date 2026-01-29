import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { getColorSchemeFromRequest } from "./client-hints.ts";

describe("security/http/client-hints", () => {
  describe("getColorSchemeFromRequest", () => {
    it("should default to light when no hints are present", () => {
      const req = new Request("http://localhost/");
      const result = getColorSchemeFromRequest(req);
      assertEquals(result.scheme, "light");
      assertEquals(result.fromParam, false);
    });

    it("should return dark from color_mode query param", () => {
      const req = new Request("http://localhost/?color_mode=dark");
      const result = getColorSchemeFromRequest(req);
      assertEquals(result.scheme, "dark");
      assertEquals(result.fromParam, true);
    });

    it("should return light from color_mode query param", () => {
      const req = new Request("http://localhost/?color_mode=light");
      const result = getColorSchemeFromRequest(req);
      assertEquals(result.scheme, "light");
      assertEquals(result.fromParam, true);
    });

    it("should handle color_mode param with extra whitespace", () => {
      const req = new Request("http://localhost/?color_mode=%20dark%20");
      const result = getColorSchemeFromRequest(req);
      assertEquals(result.scheme, "dark");
      assertEquals(result.fromParam, true);
    });

    it("should handle color_mode param case-insensitively", () => {
      const req = new Request("http://localhost/?color_mode=DARK");
      const result = getColorSchemeFromRequest(req);
      assertEquals(result.scheme, "dark");
      assertEquals(result.fromParam, true);
    });

    it("should return dark from Sec-CH-Prefers-Color-Scheme header", () => {
      const req = new Request("http://localhost/", {
        headers: { "Sec-CH-Prefers-Color-Scheme": "dark" },
      });
      const result = getColorSchemeFromRequest(req);
      assertEquals(result.scheme, "dark");
      assertEquals(result.fromParam, false);
    });

    it("should handle quoted header value", () => {
      const req = new Request("http://localhost/", {
        headers: { "Sec-CH-Prefers-Color-Scheme": '"dark"' },
      });
      const result = getColorSchemeFromRequest(req);
      assertEquals(result.scheme, "dark");
      assertEquals(result.fromParam, false);
    });

    it("should default to light when header value is not dark", () => {
      const req = new Request("http://localhost/", {
        headers: { "Sec-CH-Prefers-Color-Scheme": "light" },
      });
      const result = getColorSchemeFromRequest(req);
      assertEquals(result.scheme, "light");
      assertEquals(result.fromParam, false);
    });

    it("should prioritize query param over header", () => {
      const req = new Request("http://localhost/?color_mode=light", {
        headers: { "Sec-CH-Prefers-Color-Scheme": "dark" },
      });
      const result = getColorSchemeFromRequest(req);
      assertEquals(result.scheme, "light");
      assertEquals(result.fromParam, true);
    });

    it("should accept an optional URL parameter", () => {
      const req = new Request("http://localhost/");
      const url = new URL("http://localhost/?color_mode=dark");
      const result = getColorSchemeFromRequest(req, url);
      assertEquals(result.scheme, "dark");
      assertEquals(result.fromParam, true);
    });

    it("should fall back to light for unrecognized color_mode param", () => {
      const req = new Request("http://localhost/?color_mode=sepia");
      const result = getColorSchemeFromRequest(req);
      assertEquals(result.scheme, "light");
      assertEquals(result.fromParam, false);
    });
  });
});
