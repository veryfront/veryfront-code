import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { parseCookies, parseCookiesFromHeaders } from "./cookie-utils.ts";

describe("cookie-utils", () => {
  describe("parseCookies", () => {
    it("should return empty object for empty string", () => {
      assertEquals(parseCookies(""), {});
    });

    it("should parse single cookie", () => {
      assertEquals(parseCookies("name=value"), { name: "value" });
    });

    it("should parse multiple cookies", () => {
      assertEquals(parseCookies("name=value; other=data"), {
        name: "value",
        other: "data",
      });
    });

    it("should handle whitespace", () => {
      assertEquals(parseCookies("  name = value ; other = data  "), {
        name: "value",
        other: "data",
      });
      assertEquals(parseCookies('session = "abc" '), { session: "abc" });
    });

    it("should decode URL-encoded values", () => {
      assertEquals(parseCookies("name=hello%20world"), { name: "hello world" });
    });

    it("should strip RFC 6265 double quotes around values", () => {
      assertEquals(parseCookies('session="abc123"; plain=value'), {
        session: "abc123",
        plain: "value",
      });
      assertEquals(parseCookies('name="hello%20world"'), { name: "hello world" });
      assertEquals(parseCookies('empty=""'), { empty: "" });
    });

    it("should keep unbalanced quotes literal", () => {
      assertEquals(parseCookies('name="; other="unterminated'), {
        name: '"',
        other: '"unterminated',
      });
    });

    it("should omit malformed URL encoding without discarding valid siblings", () => {
      assertEquals(parseCookies("name=incomplete%2; other=valid"), {
        other: "valid",
      });
    });

    it("should return a null-prototype map and preserve prototype-named cookies", () => {
      const cookies = parseCookies(
        "__proto__=safe; constructor=value; toString=string-value",
      );

      assertEquals(Object.getPrototypeOf(cookies), null);
      assertEquals(Object.hasOwn(cookies, "__proto__"), true);
      assertEquals(cookies["__proto__"], "safe");
      assertEquals(Object.hasOwn(cookies, "constructor"), true);
      assertEquals(cookies["constructor"], "value");
      assertEquals(Object.hasOwn(cookies, "toString"), true);
      assertEquals(cookies["toString"], "string-value");
    });

    it("should handle empty cookies", () => {
      assertEquals(parseCookies("name=value;;other=data"), {
        name: "value",
        other: "data",
      });
    });

    it("should skip cookies without value", () => {
      assertEquals(parseCookies("name=value;invalid;other=data"), {
        name: "value",
        other: "data",
      });
    });

    it("should handle cookies with equals in value", () => {
      assertEquals(parseCookies("name=value=with=equals"), {
        name: "value=with=equals",
      });
    });
  });

  describe("parseCookiesFromHeaders", () => {
    it("should parse cookies from Headers object", () => {
      const headers = new Headers({ cookie: "name=value; other=data" });
      assertEquals(parseCookiesFromHeaders(headers), {
        name: "value",
        other: "data",
      });
    });

    it("should return empty object when no cookie header", () => {
      assertEquals(parseCookiesFromHeaders(new Headers()), {});
    });
  });
});
