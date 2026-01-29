import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseArrayArg, parseCliArgs } from "./arg-parser.ts";

describe("cli/index/arg-parser", () => {
  describe("parseCliArgs", () => {
    it("should parse positional arguments", () => {
      const args = parseCliArgs(["dev"]);
      assertEquals(args._[0], "dev");
    });

    it("should parse long flags with values", () => {
      const args = parseCliArgs(["--port", "8080"]);
      assertEquals(args.port, 8080);
    });

    it("should parse long flags with equals", () => {
      const args = parseCliArgs(["--port=3000"]);
      assertEquals(args.port, 3000);
    });

    it("should parse boolean flags", () => {
      const args = parseCliArgs(["--help"]);
      assertEquals(args.help, true);
    });

    it("should resolve short aliases", () => {
      const args = parseCliArgs(["-p", "9000"]);
      assertEquals(args.port, 9000);
    });

    it("should resolve -h to help", () => {
      const args = parseCliArgs(["-h"]);
      assertEquals(args.help, true);
    });

    it("should handle --with as array flag", () => {
      const args = parseCliArgs(["--with", "react", "--with", "tailwind"]);
      assertEquals(args.with, ["react", "tailwind"]);
    });

    it("should set default port", () => {
      const args = parseCliArgs([]);
      assertEquals(typeof args.port, "number");
    });

    it("should convert numeric string values", () => {
      const args = parseCliArgs(["--port", "4000"]);
      assertEquals(args.port, 4000);
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
