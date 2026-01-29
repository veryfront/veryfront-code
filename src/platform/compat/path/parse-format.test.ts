import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { format, parse } from "./parse-format.ts";

describe("platform/compat/path/parse-format", () => {
  describe("parse", () => {
    it("should parse absolute path", () => {
      const result = parse("/home/user/file.ts");
      assertEquals(result.root, "/");
      assertEquals(result.dir, "/home/user");
      assertEquals(result.base, "file.ts");
      assertEquals(result.ext, ".ts");
      assertEquals(result.name, "file");
    });

    it("should parse relative path", () => {
      const result = parse("src/utils.js");
      assertEquals(result.root, "");
      assertEquals(result.base, "utils.js");
      assertEquals(result.ext, ".js");
      assertEquals(result.name, "utils");
    });

    it("should parse file without extension", () => {
      const result = parse("/usr/bin/deno");
      assertEquals(result.ext, "");
      assertEquals(result.name, "deno");
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
      const result = format({ root: "", dir: "src", base: "", ext: ".js", name: "utils" });
      assertEquals(result, "src/utils.js");
    });

    it("should format base without dir", () => {
      const result = format({ root: "", dir: "", base: "file.ts", ext: ".ts", name: "file" });
      assertEquals(result, "file.ts");
    });
  });
});
