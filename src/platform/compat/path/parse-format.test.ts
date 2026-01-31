import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { format, parse } from "./parse-format.ts";

describe("platform/compat/path/parse-format", () => {
  describe("parse", () => {
    it("should parse absolute path", () => {
      const { root, dir, base, ext, name } = parse("/home/user/file.ts");
      assertEquals(root, "/");
      assertEquals(dir, "/home/user");
      assertEquals(base, "file.ts");
      assertEquals(ext, ".ts");
      assertEquals(name, "file");
    });

    it("should parse relative path", () => {
      const { root, base, ext, name } = parse("src/utils.js");
      assertEquals(root, "");
      assertEquals(base, "utils.js");
      assertEquals(ext, ".js");
      assertEquals(name, "utils");
    });

    it("should parse file without extension", () => {
      const { ext, name } = parse("/usr/bin/deno");
      assertEquals(ext, "");
      assertEquals(name, "deno");
    });
  });

  describe("format", () => {
    it("should format from dir and base", () => {
      const result = format({
        root: "/",
        dir: "/home/user",
        base: "file.ts",
        ext: ".ts",
        name: "file",
      });
      assertEquals(result, "/home/user/file.ts");
    });

    it("should format from name and ext when no base", () => {
      const result = format({
        root: "",
        dir: "src",
        base: "",
        ext: ".js",
        name: "utils",
      });
      assertEquals(result, "src/utils.js");
    });

    it("should format base without dir", () => {
      const result = format({
        root: "",
        dir: "",
        base: "file.ts",
        ext: ".ts",
        name: "file",
      });
      assertEquals(result, "file.ts");
    });
  });
});
