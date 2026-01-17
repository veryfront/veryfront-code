import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parseUpArgs, UpArgsSchema } from "./up.ts";
import type { ParsedArgs } from "../index/types.ts";

function createArgs(flags: Record<string, unknown> = {}): ParsedArgs {
  return { _: ["up"], ...flags };
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
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.force, false);
        assertEquals(result.data.dryRun, false);
      }
    });

    it("should parse --force flag", () => {
      const result = parseUpArgs(createArgs({ force: true }));
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.force, true);
      }
    });

    it("should parse -f short flag", () => {
      const result = parseUpArgs(createArgs({ f: true }));
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.force, true);
      }
    });

    it("should parse --dry-run flag", () => {
      const result = parseUpArgs(createArgs({ "dry-run": true }));
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.dryRun, true);
      }
    });

    it("should parse multiple flags", () => {
      const result = parseUpArgs(createArgs({ force: true, "dry-run": true }));
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.force, true);
        assertEquals(result.data.dryRun, true);
      }
    });
  });
});
