import { assertEquals } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { redirect, notFound } from "./helpers.ts";

describe("helpers", () => {
  describe("redirect", () => {
    it("should create a redirect result with default permanent false", () => {
      const result = redirect("/new-path");

      assertEquals(result, {
        redirect: {
          destination: "/new-path",
          permanent: false,
        },
      });
    });

    it("should create a redirect result with permanent true", () => {
      const result = redirect("/new-path", true);

      assertEquals(result, {
        redirect: {
          destination: "/new-path",
          permanent: true,
        },
      });
    });

    it("should create a temporary redirect when permanent is false", () => {
      const result = redirect("/temporary", false);

      assertEquals(result, {
        redirect: {
          destination: "/temporary",
          permanent: false,
        },
      });
    });

    it("should handle various URL formats", () => {
      const absoluteUrl = redirect("https://example.com/page");
      const relativePath = redirect("../relative");
      const rootPath = redirect("/");
      const withQuery = redirect("/page?foo=bar");
      const withHash = redirect("/page#section");

      assertEquals(absoluteUrl.redirect?.destination, "https://example.com/page");
      assertEquals(relativePath.redirect?.destination, "../relative");
      assertEquals(rootPath.redirect?.destination, "/");
      assertEquals(withQuery.redirect?.destination, "/page?foo=bar");
      assertEquals(withHash.redirect?.destination, "/page#section");
    });
  });

  describe("notFound", () => {
    it("should create a notFound result", () => {
      const result = notFound();

      assertEquals(result, {
        notFound: true,
      });
    });

    it("should return consistent results on multiple calls", () => {
      const result1 = notFound();
      const result2 = notFound();

      assertEquals(result1, result2);
    });
  });
});
