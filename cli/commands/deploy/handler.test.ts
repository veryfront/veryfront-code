import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleDeployCommand } from "./handler.ts";
import { parseDeployArgs } from "./command.ts";
import type { ParsedArgs } from "#cli/shared/types";

function createArgs(flags: Record<string, unknown> = {}): ParsedArgs {
  return { _: ["deploy"], ...flags };
}

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

describe("Deploy Handler", () => {
  describe("handleDeployCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handleDeployCommand, "function");
      assertEquals(handleDeployCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ParsedArgs parameter", () => {
      assertEquals(handleDeployCommand.length, 1);
    });
  });

  describe("parseDeployArgs via handler", () => {
    it("should use defaults when no flags provided", () => {
      const result = parseDeployArgs(createArgs());
      assertSuccess(result);
      assertEquals(result.data.branch, "main");
      assertEquals(result.data.env, "production");
      assertEquals(result.data.dryRun, false);
      assertEquals(result.data.force, false);
      assertEquals(result.data.quiet, false);
    });

    it("should parse --branch flag", () => {
      const result = parseDeployArgs(createArgs({ branch: "develop" }));
      assertSuccess(result);
      assertEquals(result.data.branch, "develop");
    });

    it("should parse -b short flag as branch", () => {
      const result = parseDeployArgs(createArgs({ b: "feature-x" }));
      assertSuccess(result);
      assertEquals(result.data.branch, "feature-x");
    });

    it("should parse --env flag", () => {
      const result = parseDeployArgs(createArgs({ env: "staging" }));
      assertSuccess(result);
      assertEquals(result.data.env, "staging");
    });

    it("should parse --release-name flag", () => {
      const result = parseDeployArgs(createArgs({ "release-name": "v2.0.0" }));
      assertSuccess(result);
      assertEquals(result.data.releaseName, "v2.0.0");
    });

    it("should parse --dry-run flag", () => {
      const result = parseDeployArgs(createArgs({ "dry-run": true }));
      assertSuccess(result);
      assertEquals(result.data.dryRun, true);
    });

    it("should parse --force flag", () => {
      const result = parseDeployArgs(createArgs({ force: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse -f short flag as force", () => {
      const result = parseDeployArgs(createArgs({ f: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse --quiet flag", () => {
      const result = parseDeployArgs(createArgs({ quiet: true }));
      assertSuccess(result);
      assertEquals(result.data.quiet, true);
    });

    it("should parse -q short flag as quiet", () => {
      const result = parseDeployArgs(createArgs({ q: true }));
      assertSuccess(result);
      assertEquals(result.data.quiet, true);
    });

    it("should parse multiple flags together", () => {
      const result = parseDeployArgs(createArgs({
        branch: "staging",
        env: "preview",
        "dry-run": true,
        force: true,
        quiet: true,
      }));
      assertSuccess(result);
      assertEquals(result.data.branch, "staging");
      assertEquals(result.data.env, "preview");
      assertEquals(result.data.dryRun, true);
      assertEquals(result.data.force, true);
      assertEquals(result.data.quiet, true);
    });
  });

  describe("handleDeployCommand error handling", () => {
    it("should throw on invalid args (empty branch)", () => {
      assertRejects(
        () => handleDeployCommand({ _: ["deploy"], branch: "" } as ParsedArgs),
        Error,
        "Invalid deploy arguments",
      );
    });

    it("should throw on invalid args (empty env)", () => {
      assertRejects(
        () => handleDeployCommand({ _: ["deploy"], env: "" } as ParsedArgs),
        Error,
        "Invalid deploy arguments",
      );
    });
  });
});
