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
        name: " value",
        other: " data",
      });
    });

    it("should decode URL-encoded values", () => {
      assertEquals(parseCookies("name=hello%20world"), { name: "hello world" });
    });

    it("should omit malformed URL encoding without discarding valid siblings", () => {
      assertEquals(parseCookies("name=incomplete%2; other=valid"), {
        other: "valid",
      });
    });

    it("should safely parse cookie names inherited from Object.prototype", () => {
      const cookies = parseCookies("__proto__=safe; constructor=value");

      assertEquals(Object.hasOwn(cookies, "__proto__"), true);
      assertEquals(cookies["__proto__"], "safe");
      assertEquals(Object.hasOwn(cookies, "constructor"), true);
      assertEquals(cookies["constructor"], "value");
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
