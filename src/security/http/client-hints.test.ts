import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { getColorSchemeFromRequest } from "./client-hints.ts";

function assertScheme(
  req: Request,
  expectedScheme: "light" | "dark",
  expectedFromParam: boolean,
  url?: URL,
): void {
  const result = getColorSchemeFromRequest(req, url);
  assertEquals(result.scheme, expectedScheme);
  assertEquals(result.fromParam, expectedFromParam);
}

describe("security/http/client-hints", () => {
  describe("getColorSchemeFromRequest", () => {
    it("should default to light when no hints are present", () => {
      assertScheme(new Request("http://localhost/"), "light", false);
    });

    it("should return dark from color_mode query param", () => {
      assertScheme(new Request("http://localhost/?color_mode=dark"), "dark", true);
    });

    it("should return light from color_mode query param", () => {
      assertScheme(new Request("http://localhost/?color_mode=light"), "light", true);
    });

    it("should handle color_mode param with extra whitespace", () => {
      assertScheme(new Request("http://localhost/?color_mode=%20dark%20"), "dark", true);
    });

    it("should handle color_mode param case-insensitively", () => {
      assertScheme(new Request("http://localhost/?color_mode=DARK"), "dark", true);
    });

    it("should return dark from Sec-CH-Prefers-Color-Scheme header", () => {
      assertScheme(
        new Request("http://localhost/", {
          headers: { "Sec-CH-Prefers-Color-Scheme": "dark" },
        }),
        "dark",
        false,
      );
    });

    it("should handle quoted header value", () => {
      assertScheme(
        new Request("http://localhost/", {
          headers: { "Sec-CH-Prefers-Color-Scheme": '"dark"' },
        }),
        "dark",
        false,
      );
    });

    it("should default to light when header value is not dark", () => {
      assertScheme(
        new Request("http://localhost/", {
          headers: { "Sec-CH-Prefers-Color-Scheme": "light" },
        }),
        "light",
        false,
      );
    });

    it("should prioritize query param over header", () => {
      assertScheme(
        new Request("http://localhost/?color_mode=light", {
          headers: { "Sec-CH-Prefers-Color-Scheme": "dark" },
        }),
        "light",
        true,
      );
    });

    it("should accept an optional URL parameter", () => {
      assertScheme(
        new Request("http://localhost/"),
        "dark",
        true,
        new URL("http://localhost/?color_mode=dark"),
      );
    });

    it("should fall back to light for unrecognized color_mode param", () => {
      assertScheme(new Request("http://localhost/?color_mode=sepia"), "light", false);
    });
  });
});
