import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import {
  basename,
  delimiter,
  dirname,
  extname,
  format,
  fromFileUrl,
  hasNodePath,
  isAbsolute,
  isDeno,
  join,
  nodePath,
  normalize,
  parse,
  relative,
  resolve,
  sep,
  toFileUrl,
  validatePathSecurity,
} from "./index.ts";

describe("compat/path/index.ts exports", () => {
  describe("runtime exports", () => {
    it("should export delimiter", () => {
      assertExists(delimiter);
      assertEquals(typeof delimiter, "string");
    });

    it("should export sep", () => {
      assertExists(sep);
      assertEquals(typeof sep, "string");
    });

    it("should export hasNodePath", () => {
      assertEquals(typeof hasNodePath, "boolean");
    });

    it("should export isDeno", () => {
      assertEquals(typeof isDeno, "boolean");
    });

    it("should export nodePath (may be null)", () => {
      assertEquals(nodePath === null || typeof nodePath === "object", true);
    });
  });

  describe("basic operations", () => {
    it("should export basename", () => {
      assertExists(basename);
      assertEquals(typeof basename, "function");
    });

    it("should export dirname", () => {
      assertExists(dirname);
      assertEquals(typeof dirname, "function");
    });

    it("should export extname", () => {
      assertExists(extname);
      assertEquals(typeof extname, "function");
    });

    it("should export join", () => {
      assertExists(join);
      assertEquals(typeof join, "function");
    });

    it("basename should extract filename", () => {
      assertEquals(basename("/path/to/file.txt"), "file.txt");
    });

    it("dirname should extract directory", () => {
      assertEquals(dirname("/path/to/file.txt"), "/path/to");
    });

    it("extname should extract extension", () => {
      assertEquals(extname("/path/to/file.txt"), ".txt");
    });

    it("join should combine paths", () => {
      const result = join("path", "to", "file.txt");
      assertEquals(result.includes("path") && result.includes("file.txt"), true);
    });
  });

  describe("resolution operations", () => {
    it("should export isAbsolute", () => {
      assertExists(isAbsolute);
      assertEquals(typeof isAbsolute, "function");
    });

    it("should export normalize", () => {
      assertExists(normalize);
      assertEquals(typeof normalize, "function");
    });

    it("should export relative", () => {
      assertExists(relative);
      assertEquals(typeof relative, "function");
    });

    it("should export resolve", () => {
      assertExists(resolve);
      assertEquals(typeof resolve, "function");
    });

    it("isAbsolute should detect absolute paths", () => {
      assertEquals(isAbsolute("/absolute/path"), true);
      assertEquals(isAbsolute("relative/path"), false);
    });
  });

  describe("parse/format operations", () => {
    it("should export parse", () => {
      assertExists(parse);
      assertEquals(typeof parse, "function");
    });

    it("should export format", () => {
      assertExists(format);
      assertEquals(typeof format, "function");
    });

    it("parse should break down path", () => {
      const parsed = parse("/path/to/file.txt");
      assertExists(parsed.dir);
      assertExists(parsed.base);
      assertExists(parsed.ext);
      assertExists(parsed.name);
    });
  });

  describe("URL conversion", () => {
    it("should export fromFileUrl", () => {
      assertExists(fromFileUrl);
      assertEquals(typeof fromFileUrl, "function");
    });

    it("should export toFileUrl", () => {
      assertExists(toFileUrl);
      assertEquals(typeof toFileUrl, "function");
    });
  });

  describe("security", () => {
    it("should export validatePathSecurity", () => {
      assertExists(validatePathSecurity);
      assertEquals(typeof validatePathSecurity, "function");
    });
  });
});
