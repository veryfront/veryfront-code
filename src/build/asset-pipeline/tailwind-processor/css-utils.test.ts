import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { countUtilities, minifyCSS } from "./css-utils.ts";

describe("css-utils", () => {
  describe("minifyCSS", () => {
    it("should remove CSS comments", () => {
      const result = minifyCSS("/* Comment */ .container { padding: 1rem; }");
      expect(result).not.toContain("/*");
      expect(result).not.toContain("*/");
      expect(result).toContain(".container");
    });

    it("should remove multiline comments", () => {
      const result = minifyCSS(`
        /* This is a
           multiline comment */
        .btn { color: blue; }
      `);
      expect(result).not.toContain("/*");
      expect(result).toContain(".btn");
    });

    it("should collapse whitespace", () => {
      expect(minifyCSS(".container  {  padding:  1rem;  }")).toBe(
        ".container{padding:1rem;}",
      );
    });

    it("should remove spaces around punctuation", () => {
      expect(minifyCSS(".btn { color : red ; }")).toBe(".btn{color:red;}");
    });

    it("should trim leading and trailing whitespace", () => {
      expect(minifyCSS("  .container { padding: 1rem; }  ")).toBe(
        ".container{padding:1rem;}",
      );
    });

    it("should handle empty CSS", () => {
      expect(minifyCSS("")).toBe("");
    });

    it("should handle CSS with only whitespace", () => {
      expect(minifyCSS("   \n  \t  ")).toBe("");
    });

    it("should handle CSS with only comments", () => {
      expect(minifyCSS("/* Comment 1 */ /* Comment 2 */")).toBe("");
    });

    it("should handle complex CSS", () => {
      const result = minifyCSS(`
        /* Header styles */
        .header {
          display: flex;
          padding: 1rem;
        }

        /* Body styles */
        .body {
          margin: 0;
        }
      `);
      expect(result).toBe(".header{display:flex;padding:1rem;}.body{margin:0;}");
    });

    it("should preserve CSS property values", () => {
      expect(minifyCSS('.container { background: url("image.png"); }')).toContain(
        'url("image.png")',
      );
    });

    it("should handle CSS with newlines", () => {
      expect(minifyCSS(".btn\n{\n  color:\n  red;\n}")).toBe(".btn{color:red;}");
    });

    it("should handle CSS with tabs", () => {
      expect(minifyCSS(".btn\t{\tcolor:\tred;\t}")).toBe(".btn{color:red;}");
    });

    it("should remove spaces around commas", () => {
      expect(minifyCSS(".btn , .link { color: red; }")).toBe(
        ".btn,.link{color:red;}",
      );
    });

    it("should remove spaces around colons", () => {
      expect(minifyCSS(".btn { color : red ; }")).toBe(".btn{color:red;}");
    });

    it("should remove spaces around semicolons", () => {
      expect(minifyCSS(".btn { color: red ; margin: 0 ; }")).toBe(
        ".btn{color:red;margin:0;}",
      );
    });
  });

  describe("countUtilities", () => {
    it("should count single class selector", () => {
      expect(countUtilities(".btn { color: blue; }")).toBe(1);
    });

    it("should count multiple unique class selectors", () => {
      expect(countUtilities(".btn { } .btn-primary { } .btn-secondary { }"))
        .toBe(3);
    });

    it("should count duplicate class selectors only once", () => {
      expect(countUtilities(".btn { } .btn-primary { } .btn { }")).toBe(2);
    });

    it("should return 0 for empty CSS", () => {
      expect(countUtilities("")).toBe(0);
    });

    it("should return 0 for CSS without class selectors", () => {
      expect(countUtilities("div { color: red; } #id { margin: 0; }")).toBe(0);
    });

    it("should count classes with hyphens", () => {
      expect(countUtilities(".btn-primary { } .btn-secondary { }")).toBe(2);
    });

    it("should count classes with underscores", () => {
      expect(countUtilities(".btn_primary { } .btn_secondary { }")).toBe(2);
    });

    it("should count classes with numbers", () => {
      expect(countUtilities(".col-12 { } .col-6 { } .col-3 { }")).toBe(3);
    });

    it("should count classes in complex selectors", () => {
      expect(countUtilities(".container .btn { } .container .link { }")).toBe(3);
    });

    it("should count pseudo-class selectors", () => {
      expect(countUtilities(".btn:hover { } .btn:active { }")).toBe(1);
    });

    it("should handle mixed selectors", () => {
      expect(countUtilities(".btn, #id, div, .link { }")).toBe(2);
    });

    it("should handle classes with special characters", () => {
      expect(countUtilities(".btn-primary-2 { } .link_active { }")).toBe(2);
    });

    it("should handle minified CSS", () => {
      expect(countUtilities(".a{}.b{}.c{}.a{}")).toBe(3);
    });
  });
});
