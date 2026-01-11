import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { notFound, redirect } from "./helpers.ts";

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
});
