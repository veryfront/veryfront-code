import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleUpCommand } from "./handler.ts";
import { parseUpArgs } from "./command.ts";
import type { ParsedArgs } from "../../shared/types.ts";

function createArgs(flags: Record<string, unknown> = {}): ParsedArgs {
  return { _: ["up"], ...flags };
}

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

describe("Up Handler", () => {
  describe("handleUpCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleUpCommand, "function");
      assertEquals(handleUpCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ParsedArgs parameter", () => {
      assertEquals(handleUpCommand.length, 1);
    });
  });

  describe("parseUpArgs via handler", () => {
    it("should parse defaults when no flags provided", () => {
      const result = parseUpArgs(createArgs());
      assertSuccess(result);
      assertEquals(result.data.force, false);
      assertEquals(result.data.dryRun, false);
    });

    it("should parse --force flag", () => {
      const result = parseUpArgs(createArgs({ force: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse -f short flag as force", () => {
      const result = parseUpArgs(createArgs({ f: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse --dry-run flag", () => {
      const result = parseUpArgs(createArgs({ "dry-run": true }));
      assertSuccess(result);
      assertEquals(result.data.dryRun, true);
    });

    it("should parse multiple flags together", () => {
      const result = parseUpArgs(createArgs({ force: true, "dry-run": true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
      assertEquals(result.data.dryRun, true);
    });

    it("should always succeed parsing (all fields have defaults)", () => {
      const result = parseUpArgs(createArgs());
      assertEquals(result.success, true);
    });
  });
});
