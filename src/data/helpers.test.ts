import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDataControlResult, notFound, redirect } from "./helpers.ts";

describe("helpers.ts", () => {
  describe("redirect", () => {
    it("should create a redirect result with destination", () => {
      const result = redirect("/login");

      assertEquals(result.redirect?.destination, "/login");
      assertEquals(result.redirect?.permanent, false);
    });

    it("should default to temporary redirect (permanent: false)", () => {
      const result = redirect("/dashboard");

      assertEquals(result.redirect?.permanent, false);
    });

    it("should support permanent redirect", () => {
      const result = redirect("/new-page", true);

      assertEquals(result.redirect?.destination, "/new-page");
      assertEquals(result.redirect?.permanent, true);
    });

    it("should support explicit temporary redirect", () => {
      const result = redirect("/temp-page", false);

      assertEquals(result.redirect?.permanent, false);
    });

    it("should handle absolute URLs", () => {
      const result = redirect("https://example.com/external");

      assertEquals(result.redirect?.destination, "https://example.com/external");
    });

    it("should handle URLs with query parameters", () => {
      const result = redirect("/search?q=test&page=1");

      assertEquals(result.redirect?.destination, "/search?q=test&page=1");
    });

    it("should handle URLs with hash fragments", () => {
      const result = redirect("/docs#getting-started");

      assertEquals(result.redirect?.destination, "/docs#getting-started");
    });

    it("should not set props or notFound", () => {
      const result = redirect("/somewhere");

      assertEquals(result.props, undefined);
      assertEquals(result.notFound, undefined);
    });
  });

  describe("notFound", () => {
    it("should create a notFound result", () => {
      const result = notFound();

      assertEquals(result.notFound, true);
    });

    it("should not set props or redirect", () => {
      const result = notFound();

      assertEquals(result.props, undefined);
      assertEquals(result.redirect, undefined);
    });

    it("should return consistent result on multiple calls", () => {
      const result1 = notFound();
      const result2 = notFound();

      assertEquals(result1.notFound, result2.notFound);
    });
  });

  describe("isDataControlResult", () => {
    it("recognises a thrown notFound()", () => {
      assertEquals(isDataControlResult(notFound()), true);
    });

    it("recognises a thrown redirect()", () => {
      assertEquals(isDataControlResult(redirect("/login")), true);
      assertEquals(isDataControlResult(redirect("/login", true)), true);
    });

    it("does not treat an Error as a control result", () => {
      // A real failure must keep flowing to the error handler.
      assertEquals(isDataControlResult(new Error("boom")), false);
      const tagged = new Error("boom") as Error & { notFound?: boolean };
      tagged.notFound = true;
      assertEquals(isDataControlResult(tagged), false);
    });

    it("rejects primitives and null", () => {
      assertEquals(isDataControlResult(null), false);
      assertEquals(isDataControlResult(undefined), false);
      assertEquals(isDataControlResult("notFound"), false);
      assertEquals(isDataControlResult(404), false);
    });

    it("rejects a props-only result", () => {
      assertEquals(isDataControlResult({ props: { a: 1 } }), false);
    });

    it("rejects a malformed redirect", () => {
      assertEquals(isDataControlResult({ redirect: {} }), false);
      assertEquals(isDataControlResult({ redirect: { destination: 42 } }), false);
    });

    it("rejects notFound: false", () => {
      assertEquals(isDataControlResult({ notFound: false }), false);
    });
  });
});
