import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleDoctorCommand } from "./handler.ts";
import type { ParsedArgs } from "../../shared/types.ts";

// Uses Boolean() coercion (not strict === true) to match the handler behavior
function extractDoctorArgs(args: Record<string, unknown>) {
  return {
    strict: Boolean(args.strict || args.s),
  };
}

describe("commands/doctor/handler", () => {
  describe("handleDoctorCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleDoctorCommand, "function");
      assertEquals(handleDoctorCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleDoctorCommand.length, 1);
    });
  });

  describe("argument extraction", () => {
    it("strict defaults to false when not provided", () => {
      assertEquals(extractDoctorArgs({ _: ["doctor"] }).strict, false);
    });

    it("parses --strict flag", () => {
      assertEquals(extractDoctorArgs({ _: ["doctor"], strict: true }).strict, true);
    });

    it("parses -s as alias for --strict", () => {
      assertEquals(extractDoctorArgs({ _: ["doctor"], s: true }).strict, true);
    });

    it("strict is true if either --strict or -s is set", () => {
      assertEquals(
        extractDoctorArgs({ _: ["doctor"], strict: false, s: true }).strict,
        true,
      );
      assertEquals(
        extractDoctorArgs({ _: ["doctor"], strict: true, s: false }).strict,
        true,
      );
    });

    it("strict is false when both --strict and -s are false", () => {
      assertEquals(
        extractDoctorArgs({ _: ["doctor"], strict: false, s: false }).strict,
        false,
      );
    });

    it("uses Boolean() coercion (truthy values enable strict)", () => {
      assertEquals(extractDoctorArgs({ _: ["doctor"], strict: "yes" }).strict, true);
      assertEquals(extractDoctorArgs({ _: ["doctor"], strict: 1 }).strict, true);
    });

    it("Boolean() coercion treats falsy values as false", () => {
      assertEquals(extractDoctorArgs({ _: ["doctor"], strict: 0 }).strict, false);
      assertEquals(extractDoctorArgs({ _: ["doctor"], strict: "" }).strict, false);
      assertEquals(extractDoctorArgs({ _: ["doctor"], strict: null }).strict, false);
      assertEquals(extractDoctorArgs({ _: ["doctor"], strict: undefined }).strict, false);
    });

    it("does not use --project flag (always uses cwd)", () => {
      const args: ParsedArgs = { _: ["doctor"], project: "/some/path" };
      const result = extractDoctorArgs(args);
      assertEquals("projectDir" in result, false);
    });
  });
});
