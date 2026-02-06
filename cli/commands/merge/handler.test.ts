import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleMergeCommand } from "./handler.ts";
import { parseMergeArgs } from "./command.ts";
import type { ParsedArgs } from "#cli/shared/types";

function createArgs(flags: Record<string, unknown> = {}): ParsedArgs {
  return { _: ["merge"], ...flags };
}

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

describe("Merge Handler", () => {
  describe("handleMergeCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleMergeCommand, "function");
      assertEquals(handleMergeCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ParsedArgs parameter", () => {
      assertEquals(handleMergeCommand.length, 1);
    });
  });

  describe("parseMergeArgs via handler", () => {
    it("should parse positional branch argument", () => {
      const result = parseMergeArgs({ _: ["merge", "feature-branch"] } as ParsedArgs);
      assertSuccess(result);
      assertEquals(result.data.branch, "feature-branch");
    });

    it("should parse defaults for optional flags", () => {
      const result = parseMergeArgs({ _: ["merge", "feature"] } as ParsedArgs);
      assertSuccess(result);
      assertEquals(result.data.dryRun, false);
      assertEquals(result.data.force, false);
      assertEquals(result.data.into, undefined);
    });

    it("should parse --into flag", () => {
      const result = parseMergeArgs({ _: ["merge", "feature"], into: "staging" } as ParsedArgs);
      assertSuccess(result);
      assertEquals(result.data.into, "staging");
    });

    it("should parse --dry-run flag", () => {
      const result = parseMergeArgs({ _: ["merge", "feature"], "dry-run": true } as ParsedArgs);
      assertSuccess(result);
      assertEquals(result.data.dryRun, true);
    });

    it("should parse --force flag", () => {
      const result = parseMergeArgs({ _: ["merge", "feature"], force: true } as ParsedArgs);
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse -f short flag as force", () => {
      const result = parseMergeArgs({ _: ["merge", "feature"], f: true } as ParsedArgs);
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should fail when branch is missing", () => {
      const result = parseMergeArgs(createArgs());
      assertEquals(result.success, false);
    });

    it("should parse multiple flags together", () => {
      const result = parseMergeArgs({
        _: ["merge", "release/v3"],
        into: "production",
        "dry-run": true,
        force: true,
      } as ParsedArgs);
      assertSuccess(result);
      assertEquals(result.data.branch, "release/v3");
      assertEquals(result.data.into, "production");
      assertEquals(result.data.dryRun, true);
      assertEquals(result.data.force, true);
    });
  });

  describe("handleMergeCommand error handling", () => {
    it("should throw on missing branch argument", () => {
      assertRejects(
        () => handleMergeCommand(createArgs()),
        Error,
        "Invalid merge arguments",
      );
    });
  });
});
