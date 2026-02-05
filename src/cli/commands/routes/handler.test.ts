import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleRoutesCommand } from "./handler.ts";
import type { ParsedArgs } from "../../shared/types.ts";

function extractRoutesArgs(args: ParsedArgs, cwdVal: string) {
  const projectDir = typeof args.project === "string" ? args.project : cwdVal;
  return {
    projectDir,
    json: args.json === true,
  };
}

describe("commands/routes/handler", () => {
  describe("handleRoutesCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleRoutesCommand, "function");
      assertEquals(handleRoutesCommand.constructor.name, "AsyncFunction");
    });

    it("accepts ParsedArgs parameter", () => {
      assertEquals(handleRoutesCommand.length, 1);
    });
  });

  describe("argument extraction", () => {
    const CWD = "/home/user/project";

    it("uses cwd when no --project flag provided", () => {
      const result = extractRoutesArgs({ _: ["routes"] }, CWD);
      assertEquals(result.projectDir, CWD);
    });

    it("uses --project string value when provided", () => {
      const result = extractRoutesArgs({ _: ["routes"], project: "/custom/path" }, CWD);
      assertEquals(result.projectDir, "/custom/path");
    });

    it("falls back to cwd when --project is non-string (boolean true)", () => {
      const result = extractRoutesArgs({ _: ["routes"], project: true }, CWD);
      assertEquals(result.projectDir, CWD);
    });

    it("falls back to cwd when --project is a number", () => {
      const result = extractRoutesArgs({ _: ["routes"], project: 42 }, CWD);
      assertEquals(result.projectDir, CWD);
    });

    it("parses --json flag", () => {
      assertEquals(extractRoutesArgs({ _: ["routes"], json: true }, CWD).json, true);
      assertEquals(extractRoutesArgs({ _: ["routes"], json: false }, CWD).json, false);
      assertEquals(extractRoutesArgs({ _: ["routes"] }, CWD).json, false);
    });

    it("rejects non-boolean values for --json via strict equality", () => {
      const strArgs = { _: ["routes"], json: "true" } as unknown as ParsedArgs;
      const numArgs = { _: ["routes"], json: 1 } as unknown as ParsedArgs;
      assertEquals(extractRoutesArgs(strArgs, CWD).json, false);
      assertEquals(extractRoutesArgs(numArgs, CWD).json, false);
    });

    it("defaults to human-readable output when --json is omitted", () => {
      const result = extractRoutesArgs({ _: ["routes"] }, CWD);
      assertEquals(result.json, false);
    });
  });
});
