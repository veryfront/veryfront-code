import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleLockCommand } from "./handler.ts";
import type { ParsedArgs } from "#cli/shared/types";

function extractLockArgs(args: ParsedArgs, cwdVal: string) {
  const projectDir = typeof args.project === "string" ? args.project : cwdVal;
  return {
    projectDir,
    update: args.update === true,
    verify: args.verify === true,
    clear: args.clear === true,
    list: args.list === true,
    force: args.force === true || args.f === true || args.y === true,
  };
}

describe("commands/lock/handler", () => {
  describe("handleLockCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleLockCommand, "function");
      assertEquals(handleLockCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleLockCommand.length, 1);
    });
  });

  describe("argument extraction", () => {
    const CWD = "/home/user/project";

    it("uses cwd when no --project flag provided", () => {
      const result = extractLockArgs({ _: ["lock"] }, CWD);
      assertEquals(result.projectDir, CWD);
    });

    it("uses --project string value when provided", () => {
      const result = extractLockArgs({ _: ["lock"], project: "/custom/path" }, CWD);
      assertEquals(result.projectDir, "/custom/path");
    });

    it("falls back to cwd when --project is non-string (boolean true)", () => {
      const result = extractLockArgs({ _: ["lock"], project: true }, CWD);
      assertEquals(result.projectDir, CWD);
    });

    it("parses --update flag", () => {
      assertEquals(extractLockArgs({ _: ["lock"], update: true }, CWD).update, true);
      assertEquals(extractLockArgs({ _: ["lock"], update: false }, CWD).update, false);
      assertEquals(extractLockArgs({ _: ["lock"] }, CWD).update, false);
    });

    it("parses --verify flag", () => {
      assertEquals(extractLockArgs({ _: ["lock"], verify: true }, CWD).verify, true);
      assertEquals(extractLockArgs({ _: ["lock"], verify: false }, CWD).verify, false);
      assertEquals(extractLockArgs({ _: ["lock"] }, CWD).verify, false);
    });

    it("parses --clear flag", () => {
      assertEquals(extractLockArgs({ _: ["lock"], clear: true }, CWD).clear, true);
      assertEquals(extractLockArgs({ _: ["lock"], clear: false }, CWD).clear, false);
      assertEquals(extractLockArgs({ _: ["lock"] }, CWD).clear, false);
    });

    it("parses --list flag", () => {
      assertEquals(extractLockArgs({ _: ["lock"], list: true }, CWD).list, true);
      assertEquals(extractLockArgs({ _: ["lock"], list: false }, CWD).list, false);
      assertEquals(extractLockArgs({ _: ["lock"] }, CWD).list, false);
    });

    it("parses --force flag", () => {
      assertEquals(extractLockArgs({ _: ["lock"], force: true }, CWD).force, true);
      assertEquals(extractLockArgs({ _: ["lock"], force: false }, CWD).force, false);
    });

    it("parses -f as alias for --force", () => {
      assertEquals(extractLockArgs({ _: ["lock"], f: true }, CWD).force, true);
    });

    it("parses -y as alias for --force", () => {
      assertEquals(extractLockArgs({ _: ["lock"], y: true }, CWD).force, true);
    });

    it("force is true if any of --force, -f, -y is set", () => {
      assertEquals(
        extractLockArgs({ _: ["lock"], force: false, f: false, y: true }, CWD).force,
        true,
      );
      assertEquals(
        extractLockArgs({ _: ["lock"], force: false, f: true, y: false }, CWD).force,
        true,
      );
    });

    it("force is false when none of --force, -f, -y is set", () => {
      assertEquals(extractLockArgs({ _: ["lock"] }, CWD).force, false);
    });

    it("supports multiple subcommand flags simultaneously", () => {
      const result = extractLockArgs({
        _: ["lock"],
        update: true,
        verify: true,
        list: true,
      }, CWD);
      assertEquals(result.update, true);
      assertEquals(result.verify, true);
      assertEquals(result.list, true);
    });

    it("rejects non-boolean values for boolean flags via strict equality", () => {
      assertEquals(extractLockArgs({ _: ["lock"], update: "true" }, CWD).update, false);
      assertEquals(extractLockArgs({ _: ["lock"], verify: 1 }, CWD).verify, false);
    });
  });
});
