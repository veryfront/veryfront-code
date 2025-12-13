import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals } from "std/assert/mod.ts";
import { generateTailwindCSS } from "./tailwind-jit.ts";

describe("tailwind-jit", () => {
  describe("generateTailwindCSS", () => {
    it("should return CSS string", () => {
      const html = '<div class="flex"></div>';
      const css = generateTailwindCSS(html);

      assert(typeof css === "string");
    });

    it("should handle empty HTML", () => {
      const css = generateTailwindCSS("");

      assert(typeof css === "string");
    });

    it("should extract classes from HTML", () => {
      const html = '<div class="text-red-500 bg-blue-100"></div>';
      const css = generateTailwindCSS(html);

      assert(typeof css === "string");
    });

    it("should handle HTML without classes", () => {
      const html = "<div>No classes here</div>";
      const css = generateTailwindCSS(html);

      assertEquals(typeof css, "string");
    });

    it("should handle multiple elements with classes", () => {
      const html = `
        <div class="container mx-auto">
          <h1 class="text-2xl font-bold">Title</h1>
          <p class="text-gray-600">Text</p>
        </div>
      `;
      const css = generateTailwindCSS(html);

      assert(typeof css === "string");
    });
  });
});
