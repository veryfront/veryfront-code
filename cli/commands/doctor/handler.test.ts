import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleDoctorCommand, parseDoctorArgs } from "./handler.ts";
import type { ParsedArgs } from "#cli/shared/types";

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

  describe("parseDoctorArgs", () => {
    it("strict defaults to false when not provided", () => {
      const result = parseDoctorArgs({ _: ["doctor"] });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.strict, false);
    });

    it("parses --strict flag", () => {
      const result = parseDoctorArgs({ _: ["doctor"], strict: true });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.strict, true);
    });

    it("parses -s as alias for --strict", () => {
      const result = parseDoctorArgs({ _: ["doctor"], s: true });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.strict, true);
    });

    it("strict is false when flag is explicitly false", () => {
      const result = parseDoctorArgs({ _: ["doctor"], strict: false });
      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.strict, false);
    });

    it("does not use --project flag (always uses cwd)", () => {
      const args: ParsedArgs = { _: ["doctor"], project: "/some/path" };
      const result = parseDoctorArgs(args);
      assertEquals(result.success, true);
      if (result.success) assertEquals("projectDir" in result.data, false);
    });
  });
});
