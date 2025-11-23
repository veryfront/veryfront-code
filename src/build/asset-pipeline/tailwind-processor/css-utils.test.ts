/**
 * Tests for CSS utility functions
 */

import { describe, it } from "@std/testing/bdd.ts";
import { expect } from "@std/expect";
import { countUtilities, minifyCSS } from "./css-utils.ts";

describe("css-utils", () => {
  describe("minifyCSS", () => {
    it("should remove CSS comments", () => {
      const css = "/* Comment */ .container { padding: 1rem; }";
      const result = minifyCSS(css);
      expect(result).not.toContain("/*");
      expect(result).not.toContain("*/");
      expect(result).toContain(".container");
    });

    it("should remove multiline comments", () => {
      const css = `
        /* This is a
           multiline comment */
        .btn { color: blue; }
      `;
      const result = minifyCSS(css);
      expect(result).not.toContain("/*");
      expect(result).toContain(".btn");
    });

    it("should collapse whitespace", () => {
      const css = ".container  {  padding:  1rem;  }";
      const result = minifyCSS(css);
      expect(result).toBe(".container{padding:1rem;}");
    });

    it("should remove spaces around punctuation", () => {
      const css = ".btn { color : red ; }";
      const result = minifyCSS(css);
      expect(result).toBe(".btn{color:red;}");
    });

    it("should trim leading and trailing whitespace", () => {
      const css = "  .container { padding: 1rem; }  ";
      const result = minifyCSS(css);
      expect(result).toBe(".container{padding:1rem;}");
    });

    it("should handle empty CSS", () => {
      const result = minifyCSS("");
      expect(result).toBe("");
    });

    it("should handle CSS with only whitespace", () => {
      const result = minifyCSS("   \n  \t  ");
      expect(result).toBe("");
    });

    it("should handle CSS with only comments", () => {
      const css = "/* Comment 1 */ /* Comment 2 */";
      const result = minifyCSS(css);
      expect(result).toBe("");
    });

    it("should handle complex CSS", () => {
      const css = `
        /* Header styles */
        .header {
          display: flex;
          padding: 1rem;
        }

        /* Body styles */
        .body {
          margin: 0;
        }
      `;
      const result = minifyCSS(css);
      expect(result).toBe(".header{display:flex;padding:1rem;}.body{margin:0;}");
    });

    it("should preserve CSS property values", () => {
      const css = '.container { background: url("image.png"); }';
      const result = minifyCSS(css);
      expect(result).toContain('url("image.png")');
    });

    it("should handle CSS with newlines", () => {
      const css = ".btn\n{\n  color:\n  red;\n}";
      const result = minifyCSS(css);
      expect(result).toBe(".btn{color:red;}");
    });

    it("should handle CSS with tabs", () => {
      const css = ".btn\t{\tcolor:\tred;\t}";
      const result = minifyCSS(css);
      expect(result).toBe(".btn{color:red;}");
    });

    it("should remove spaces around commas", () => {
      const css = ".btn , .link { color: red; }";
      const result = minifyCSS(css);
      expect(result).toBe(".btn,.link{color:red;}");
    });

    it("should remove spaces around colons", () => {
      const css = ".btn { color : red ; }";
      const result = minifyCSS(css);
      expect(result).toBe(".btn{color:red;}");
    });

    it("should remove spaces around semicolons", () => {
      const css = ".btn { color: red ; margin: 0 ; }";
      const result = minifyCSS(css);
      expect(result).toBe(".btn{color:red;margin:0;}");
    });
  });

  describe("countUtilities", () => {
    it("should count single class selector", () => {
      const css = ".btn { color: blue; }";
      const count = countUtilities(css);
      expect(count).toBe(1);
    });

    it("should count multiple unique class selectors", () => {
      const css = ".btn { } .btn-primary { } .btn-secondary { }";
      const count = countUtilities(css);
      expect(count).toBe(3);
    });

    it("should count duplicate class selectors only once", () => {
      const css = ".btn { } .btn-primary { } .btn { }";
      const count = countUtilities(css);
      expect(count).toBe(2);
    });

    it("should return 0 for empty CSS", () => {
      const count = countUtilities("");
      expect(count).toBe(0);
    });

    it("should return 0 for CSS without class selectors", () => {
      const css = "div { color: red; } #id { margin: 0; }";
      const count = countUtilities(css);
      expect(count).toBe(0);
    });

    it("should count classes with hyphens", () => {
      const css = ".btn-primary { } .btn-secondary { }";
      const count = countUtilities(css);
      expect(count).toBe(2);
    });

    it("should count classes with underscores", () => {
      const css = ".btn_primary { } .btn_secondary { }";
      const count = countUtilities(css);
      expect(count).toBe(2);
    });

    it("should count classes with numbers", () => {
      const css = ".col-12 { } .col-6 { } .col-3 { }";
      const count = countUtilities(css);
      expect(count).toBe(3);
    });

    it("should count classes in complex selectors", () => {
      const css = ".container .btn { } .container .link { }";
      const count = countUtilities(css);
      expect(count).toBe(3); // .container, .btn, .link
    });

    it("should count pseudo-class selectors", () => {
      const css = ".btn:hover { } .btn:active { }";
      const count = countUtilities(css);
      expect(count).toBe(1); // Only .btn counts
    });

    it("should handle mixed selectors", () => {
      const css = ".btn, #id, div, .link { }";
      const count = countUtilities(css);
      expect(count).toBe(2); // .btn and .link
    });

    it("should handle classes with special characters", () => {
      const css = ".btn-primary-2 { } .link_active { }";
      const count = countUtilities(css);
      expect(count).toBe(2);
    });

    it("should handle minified CSS", () => {
      const css = ".a{}.b{}.c{}.a{}";
      const count = countUtilities(css);
      expect(count).toBe(3); // .a, .b, .c
    });
  });
});
