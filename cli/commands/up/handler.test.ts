import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { parseCliArgs } from "#cli/shared/args";
import { VeryfrontError } from "veryfront/errors";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleUpCommand } from "./handler.ts";
import { parseUpArgs } from "./command.ts";
import type { ParsedArgs } from "#cli/shared/types";

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

    it("registers the builtin bundler before publishing the preview", async () => {
      const calls: string[] = [];

      await handleUpCommand(createArgs(), {
        ensureBundlerContracts: () => {
          calls.push("ensure");
          return Promise.resolve();
        },
        up: () => {
          calls.push("up");
          return Promise.resolve();
        },
      });

      assertEquals(calls, ["ensure", "up"]);
    });
  });

  describe("--name", () => {
    function recordingDependencies(calls: unknown[]) {
      return {
        ensureBundlerContracts: () => Promise.resolve(),
        up: (options: unknown) => {
          calls.push(options);
          return Promise.resolve();
        },
      };
    }

    it("passes the parsed name to up", async () => {
      const calls: unknown[] = [];
      await handleUpCommand(
        parseCliArgs(["up", "--name", "Support Desk"]),
        recordingDependencies(calls),
      );
      assertEquals(calls.length, 1, "up runs once");
      assertEquals(
        (calls[0] as { name?: string }).name,
        "Support Desk",
        "the name reaches up as typed",
      );
    });

    it("rejects a bare --name as a usage error before up runs", async () => {
      for (const argv of [["up", "--name"], ["up", "--name", "--force"]]) {
        const calls: unknown[] = [];
        const error = await assertRejects(
          () => handleUpCommand(parseCliArgs(argv), recordingDependencies(calls)),
          VeryfrontError,
        );
        assertInstanceOf(error, VeryfrontError, "the failure is a typed Veryfront error");
        assertEquals(error.slug, "invalid-argument", `${argv.join(" ")} is an invalid argument`);
        assertEquals(error.exitCode, 2, `${argv.join(" ")} exits as a usage error`);
        assertEquals(
          error.message,
          'Invalid up arguments: --name requires a value, for example veryfront up --name "Support Desk"',
          `${argv.join(" ")} names the fix`,
        );
        assertEquals(calls.length, 0, `${argv.join(" ")} does not run up`);
      }
    });

    it("rejects an empty or symbol-only --name as a usage error before up runs", async () => {
      for (const name of ["", "   ", "!!!"]) {
        const calls: unknown[] = [];
        const error = await assertRejects(
          () => handleUpCommand(parseCliArgs(["up", "--name", name]), recordingDependencies(calls)),
          VeryfrontError,
        );
        assertInstanceOf(error, VeryfrontError, "the failure is a typed Veryfront error");
        assertEquals(error.slug, "invalid-argument", `${JSON.stringify(name)} is invalid`);
        assertEquals(error.exitCode, 2, `${JSON.stringify(name)} exits as a usage error`);
        assertEquals(
          error.message.includes("--name must contain at least one letter (a to z) or digit"),
          true,
          `${JSON.stringify(name)} names the rule`,
        );
        assertEquals(calls.length, 0, `${JSON.stringify(name)} does not run up`);
      }
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
