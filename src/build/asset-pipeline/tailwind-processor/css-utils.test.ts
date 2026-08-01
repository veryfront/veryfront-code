import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { countUtilities } from "./css-utils.ts";

describe("css-utils", () => {
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
