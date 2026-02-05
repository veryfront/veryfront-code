import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handlePushCommand } from "./handler.ts";
import { parsePushArgs } from "./command.ts";
import type { ParsedArgs } from "../../shared/types.ts";

function createArgs(flags: Record<string, unknown> = {}): ParsedArgs {
  return { _: ["push"], ...flags };
}

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

describe("Push Handler", () => {
  describe("handlePushCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handlePushCommand, "function");
      assertEquals(handlePushCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ParsedArgs parameter", () => {
      assertEquals(handlePushCommand.length, 1);
    });
  });

  describe("parsePushArgs via handler", () => {
    it("should parse defaults when no flags provided", () => {
      const result = parsePushArgs(createArgs());
      assertSuccess(result);
      assertEquals(result.data.projectSlug, undefined);
      assertEquals(result.data.branch, undefined);
      assertEquals(result.data.force, false);
      assertEquals(result.data.dryRun, false);
      assertEquals(result.data.quiet, false);
    });

    it("should parse positional project slug", () => {
      const result = parsePushArgs({ _: ["push", "my-project"] } as ParsedArgs);
      assertSuccess(result);
      assertEquals(result.data.projectSlug, "my-project");
    });

    it("should parse --branch flag", () => {
      const result = parsePushArgs(createArgs({ branch: "feature-x" }));
      assertSuccess(result);
      assertEquals(result.data.branch, "feature-x");
    });

    it("should parse -b short flag as branch", () => {
      const result = parsePushArgs(createArgs({ b: "hotfix" }));
      assertSuccess(result);
      assertEquals(result.data.branch, "hotfix");
    });

    it("should parse --force flag", () => {
      const result = parsePushArgs(createArgs({ force: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse -f short flag as force", () => {
      const result = parsePushArgs(createArgs({ f: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse --dry-run flag", () => {
      const result = parsePushArgs(createArgs({ "dry-run": true }));
      assertSuccess(result);
      assertEquals(result.data.dryRun, true);
    });

    it("should parse --quiet flag", () => {
      const result = parsePushArgs(createArgs({ quiet: true }));
      assertSuccess(result);
      assertEquals(result.data.quiet, true);
    });

    it("should parse -q short flag as quiet", () => {
      const result = parsePushArgs(createArgs({ q: true }));
      assertSuccess(result);
      assertEquals(result.data.quiet, true);
    });

    it("should parse --dir flag as project dir", () => {
      const result = parsePushArgs(createArgs({ dir: "/tmp/my-project" }));
      assertSuccess(result);
      assertEquals(result.data.projectDir, "/tmp/my-project");
    });

    it("should parse -d short flag as project dir", () => {
      const result = parsePushArgs(createArgs({ d: "/tmp/short" }));
      assertSuccess(result);
      assertEquals(result.data.projectDir, "/tmp/short");
    });

    it("should parse multiple flags together", () => {
      const result = parsePushArgs(createArgs({
        branch: "release/v2",
        force: true,
        "dry-run": true,
        quiet: true,
      }));
      assertSuccess(result);
      assertEquals(result.data.branch, "release/v2");
      assertEquals(result.data.force, true);
      assertEquals(result.data.dryRun, true);
      assertEquals(result.data.quiet, true);
    });

    it("should always succeed parsing (all fields are optional)", () => {
      const result = parsePushArgs(createArgs());
      assertEquals(result.success, true);
    });
  });
});
