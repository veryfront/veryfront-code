import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseArrayArg, parseCliArgs } from "./arg-parser.ts";

describe("cli/shared/arg-parser", () => {
  describe("parseCliArgs", () => {
    it("should parse positional arguments", () => {
      assertEquals(parseCliArgs(["dev"])._[0], "dev");
    });

    it("should parse long flags with values", () => {
      assertEquals(parseCliArgs(["--port", "8080"]).port, 8080);
    });

    it("should parse long flags with equals", () => {
      assertEquals(parseCliArgs(["--port=3000"]).port, 3000);
    });

    it("should parse boolean flags", () => {
      assertEquals(parseCliArgs(["--help"]).help, true);
    });

    it("should resolve short aliases", () => {
      assertEquals(parseCliArgs(["-p", "9000"]).port, 9000);
    });

    it("should resolve -h to help", () => {
      assertEquals(parseCliArgs(["-h"]).help, true);
    });

    it("should handle --with as array flag", () => {
      assertEquals(parseCliArgs(["--with", "react", "--with", "tailwind"]).with, [
        "react",
        "tailwind",
      ]);
    });

    it("should not set default port", () => {
      assertEquals(parseCliArgs([]).port, undefined);
    });

    it("should convert numeric string values", () => {
      assertEquals(parseCliArgs(["--port", "4000"]).port, 4000);
    });
  });

  describe("parseArrayArg", () => {
    it("should return array as-is", () => {
      assertEquals(parseArrayArg(["a", "b"]), ["a", "b"]);
    });

    it("should wrap single value in array", () => {
      assertEquals(parseArrayArg("single"), ["single"]);
    });

    it("should return undefined for falsy", () => {
      assertEquals(parseArrayArg(undefined), undefined);
      assertEquals(parseArrayArg(null), undefined);
      assertEquals(parseArrayArg(""), undefined);
    });
  });
});
