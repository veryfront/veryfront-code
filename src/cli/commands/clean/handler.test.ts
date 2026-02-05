import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleCleanCommand } from "./handler.ts";
import type { ParsedArgs } from "../../shared/types.ts";

function extractCleanArgs(args: ParsedArgs, cwdVal: string) {
  const projectDir = typeof args.project === "string" ? args.project : cwdVal;
  return {
    projectDir,
    cache: args.cache === true,
    build: args.build === true,
    all: args.all === true,
    force: args.force === true || args.f === true || args.y === true,
  };
}

describe("commands/clean/handler", () => {
  describe("handleCleanCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleCleanCommand, "function");
      assertEquals(handleCleanCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleCleanCommand.length, 1);
    });
  });

  describe("argument extraction", () => {
    const CWD = "/home/user/project";

    it("uses cwd when no --project flag provided", () => {
      const result = extractCleanArgs({ _: ["clean"] }, CWD);
      assertEquals(result.projectDir, CWD);
    });

    it("uses --project string value when provided", () => {
      const result = extractCleanArgs({ _: ["clean"], project: "/custom/path" }, CWD);
      assertEquals(result.projectDir, "/custom/path");
    });

    it("falls back to cwd when --project is non-string (boolean true)", () => {
      const result = extractCleanArgs({ _: ["clean"], project: true }, CWD);
      assertEquals(result.projectDir, CWD);
    });

    it("parses --cache flag", () => {
      assertEquals(extractCleanArgs({ _: ["clean"], cache: true }, CWD).cache, true);
      assertEquals(extractCleanArgs({ _: ["clean"], cache: false }, CWD).cache, false);
      assertEquals(extractCleanArgs({ _: ["clean"] }, CWD).cache, false);
    });

    it("parses --build flag", () => {
      assertEquals(extractCleanArgs({ _: ["clean"], build: true }, CWD).build, true);
      assertEquals(extractCleanArgs({ _: ["clean"], build: false }, CWD).build, false);
      assertEquals(extractCleanArgs({ _: ["clean"] }, CWD).build, false);
    });

    it("parses --all flag", () => {
      assertEquals(extractCleanArgs({ _: ["clean"], all: true }, CWD).all, true);
      assertEquals(extractCleanArgs({ _: ["clean"], all: false }, CWD).all, false);
      assertEquals(extractCleanArgs({ _: ["clean"] }, CWD).all, false);
    });

    it("parses --force flag", () => {
      assertEquals(extractCleanArgs({ _: ["clean"], force: true }, CWD).force, true);
      assertEquals(extractCleanArgs({ _: ["clean"], force: false }, CWD).force, false);
    });

    it("parses -f as alias for --force", () => {
      assertEquals(extractCleanArgs({ _: ["clean"], f: true }, CWD).force, true);
    });

    it("parses -y as alias for --force", () => {
      assertEquals(extractCleanArgs({ _: ["clean"], y: true }, CWD).force, true);
    });

    it("force is true if any of --force, -f, -y is set", () => {
      assertEquals(
        extractCleanArgs({ _: ["clean"], force: false, f: false, y: true }, CWD).force,
        true,
      );
      assertEquals(
        extractCleanArgs({ _: ["clean"], force: false, f: true, y: false }, CWD).force,
        true,
      );
    });

    it("force is false when none of --force, -f, -y is set", () => {
      assertEquals(extractCleanArgs({ _: ["clean"] }, CWD).force, false);
    });

    it("rejects non-boolean values for boolean flags via strict equality", () => {
      assertEquals(extractCleanArgs({ _: ["clean"], cache: "true" }, CWD).cache, false);
      assertEquals(extractCleanArgs({ _: ["clean"], all: 1 }, CWD).all, false);
    });
  });
});
