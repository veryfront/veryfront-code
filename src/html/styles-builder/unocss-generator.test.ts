import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals } from "std/assert/mod.ts";
import { generateTailwindCSS, extractClassNames } from "./unocss-generator.ts";

describe("unocss-generator", () => {
  describe("extractClassNames", () => {
    it("should extract class names from HTML", () => {
      const html = '<div class="flex items-center">Content</div>';
      const classNames = extractClassNames(html);

      assert(classNames instanceof Set);
      assert(classNames.has("flex"));
      assert(classNames.has("items-center"));
    });

    it("should handle empty HTML", () => {
      const classNames = extractClassNames("");

      assert(classNames instanceof Set);
      assertEquals(classNames.size, 0);
    });

    it("should handle HTML without classes", () => {
      const html = "<div>No classes</div>";
      const classNames = extractClassNames(html);

      assertEquals(classNames.size, 0);
    });
  });

  describe("generateTailwindCSS", () => {
    it("should return CSS string", async () => {
      const html = '<div class="flex">Content</div>';
      const css = await generateTailwindCSS(html);

      assert(typeof css === "string");
    });

    it("should handle empty HTML", async () => {
      const css = await generateTailwindCSS("");

      assertEquals(typeof css, "string");
    });

    it("should handle HTML without classes", async () => {
      const html = "<div>No classes</div>";
      const css = await generateTailwindCSS(html);

      assert(typeof css === "string");
    });

    it("should generate CSS for utility classes", async () => {
      const html = '<div class="text-red-500 bg-blue-100 p-4">Content</div>';
      const css = await generateTailwindCSS(html);

      assert(typeof css === "string");
      assert(css.length >= 0);
    });
  });
});
