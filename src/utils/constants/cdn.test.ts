import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DENO_STD_BASE, ESM_CDN_BASE, getDenoStdNodeBase, getTailwindCSSUrl } from "./cdn.ts";

describe("constants/cdn", () => {
  describe("getDenoStdNodeBase", () => {
    it("should return a URL starting with DENO_STD_BASE", () => {
      const url = getDenoStdNodeBase();
      assertEquals(url.startsWith(DENO_STD_BASE), true);
    });

    it("should include /node path", () => {
      const url = getDenoStdNodeBase();
      assertEquals(url.endsWith("/node"), true);
    });

    it("should include std@ version", () => {
      const url = getDenoStdNodeBase();
      assertEquals(url.includes("/std@"), true);
    });
  });

  describe("getTailwindCSSUrl", () => {
    it("should return a URL on ESM_CDN_BASE", () => {
      const url = getTailwindCSSUrl();
      assertEquals(url.startsWith(ESM_CDN_BASE), true);
    });

    it("should include tailwindcss in path", () => {
      const url = getTailwindCSSUrl();
      assertEquals(url.includes("tailwindcss@"), true);
    });

    it("should end with index.css", () => {
      const url = getTailwindCSSUrl();
      assertEquals(url.endsWith("/index.css"), true);
    });
  });
});
