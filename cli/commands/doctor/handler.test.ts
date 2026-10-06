import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseCliArgs } from "#cli/shared/args";
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
    it("parses an explicit server port from raw argv", () => {
      const result = parseDoctorArgs(parseCliArgs(["doctor", "--port", "4321"]));

      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.port, 4321);
    });

    it("keeps -p as a compatibility alias for --port", () => {
      const result = parseDoctorArgs(parseCliArgs(["doctor", "-p", "4321"]));

      assertEquals(result.success, true);
      if (result.success) assertEquals(result.data.port, 4321);
    });

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

    it("rejects --project instead of silently ignoring it", () => {
      const args: ParsedArgs = { _: ["doctor"], project: "/some/path" };
      const result = parseDoctorArgs(args);

      assertEquals(result.success, false);
      if (!result.success) assertStringIncludes(result.error.message, "Unknown option --project");
    });

    it("rejects invalid ports", () => {
      const result = parseDoctorArgs(parseCliArgs(["doctor", "--port", "-1"]));

      assertEquals(result.success, false);
      if (!result.success) assertStringIncludes(result.error.message, "Too small");
    });

    it("rejects unknown options instead of silently ignoring them", () => {
      const result = parseDoctorArgs(parseCliArgs(["doctor", "--totally-bogus-flag", "--json"]));

      assertEquals(result.success, false);
      if (!result.success) assertStringIncludes(result.error.message, "Unknown option");
    });
  });
});
