import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
  posix,
  relative,
  resolve,
  sep,
  toFileUrl,
  validatePathSecurity,
} from "./index.ts";

function assertExportedFunction(value: unknown): void {
  assertExists(value);
  assertEquals(typeof value, "function");
}

function assertExportedString(value: unknown): void {
  assertExists(value);
  assertEquals(typeof value, "string");
}

describe("compat/path/index.ts exports", () => {
  describe("runtime exports", () => {
    it("should export delimiter", () => {
      assertExportedString(delimiter);
    });

    it("should export sep", () => {
      assertExportedString(sep);
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
      assertExportedFunction(basename);
    });

    it("should export dirname", () => {
      assertExportedFunction(dirname);
    });

    it("should export extname", () => {
      assertExportedFunction(extname);
    });

    it("should export join", () => {
      assertExportedFunction(join);
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
      assertExportedFunction(isAbsolute);
    });

    it("should export normalize", () => {
      assertExportedFunction(normalize);
    });

    it("should export relative", () => {
      assertExportedFunction(relative);
    });

    it("should export resolve", () => {
      assertExportedFunction(resolve);
    });

    it("isAbsolute should detect absolute paths", () => {
      assertEquals(isAbsolute("/absolute/path"), true);
      assertEquals(isAbsolute("relative/path"), false);
    });
  });

  describe("dependency-free POSIX operations", () => {
    it("matches POSIX path edge semantics", () => {
      assertEquals(posix.join(), ".");
      assertEquals(posix.join("", ""), ".");
      assertEquals(posix.normalize("/src//pages/../index.ts/"), "/src/index.ts/");
      assertEquals(posix.normalize("../../src/./index.ts"), "../../src/index.ts");
      assertEquals(posix.relative("/project/src", "/project/src"), "");
      assertEquals(posix.relative("/project/src", "/project/tests/unit"), "../tests/unit");
      assertEquals(posix.dirname("//server/file.ts"), "//server");
      assertEquals(posix.extname(".env"), "");
      assertEquals(posix.extname("archive.tar.gz"), ".gz");
    });

    it("treats backslashes as ordinary POSIX filename characters", () => {
      assertEquals(
        posix.basename(String.raw`C:\\project\\file.ts`),
        String.raw`C:\\project\\file.ts`,
      );
      assertEquals(posix.isAbsolute(String.raw`C:\\project\\file.ts`), false);
      assertEquals(
        posix.normalize(String.raw`C:\\project\\file.ts`),
        String.raw`C:\\project\\file.ts`,
      );
    });

    it("rejects non-string runtime inputs", () => {
      assertThrows(() => posix.normalize(null as unknown as string), TypeError);
      assertThrows(() => posix.join("src", 1 as unknown as string), TypeError);
      assertThrows(() => posix.basename("file.ts", 1 as unknown as string), TypeError);
    });
  });

  describe("parse/format operations", () => {
    it("should export parse", () => {
      assertExportedFunction(parse);
    });

    it("should export format", () => {
      assertExportedFunction(format);
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
      assertExportedFunction(fromFileUrl);
    });

    it("should export toFileUrl", () => {
      assertExportedFunction(toFileUrl);
    });
  });

  describe("security", () => {
    it("should export validatePathSecurity", () => {
      assertExportedFunction(validatePathSecurity);
    });
  });
});
