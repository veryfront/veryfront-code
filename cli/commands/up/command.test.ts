import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseUpArgs, UpArgsSchema } from "./index.ts";
import type { ParsedArgs } from "#cli/shared/types";

function createArgs(flags: Record<string, unknown> = {}): ParsedArgs {
  return { _: ["up"], ...flags };
}

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

describe("Up Command", () => {
  describe("UpArgsSchema", () => {
    it("should have correct defaults", () => {
      const result = UpArgsSchema.parse({});
      assertEquals(result.force, false);
      assertEquals(result.dryRun, false);
    });

    it("should accept force option", () => {
      const result = UpArgsSchema.parse({ force: true });
      assertEquals(result.force, true);
    });

    it("should accept dryRun option", () => {
      const result = UpArgsSchema.parse({ dryRun: true });
      assertEquals(result.dryRun, true);
    });
  });

  describe("parseUpArgs", () => {
    it("should parse empty args with defaults", () => {
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

    it("should parse -f short flag", () => {
      const result = parseUpArgs(createArgs({ f: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse --dry-run flag", () => {
      const result = parseUpArgs(createArgs({ "dry-run": true }));
      assertSuccess(result);
      assertEquals(result.data.dryRun, true);
    });

    it("should parse multiple flags", () => {
      const result = parseUpArgs(createArgs({ force: true, "dry-run": true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
      assertEquals(result.data.dryRun, true);
    });
  });
});
