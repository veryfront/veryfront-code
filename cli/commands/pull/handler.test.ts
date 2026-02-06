import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handlePullCommand } from "./handler.ts";
import { parsePullArgs } from "./command.ts";
import type { ParsedArgs } from "#cli/shared/types";

function createArgs(flags: Record<string, unknown> = {}): ParsedArgs {
  return { _: ["pull"], ...flags };
}

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

describe("Pull Handler", () => {
  describe("handlePullCommand", () => {
    it("is an async function", () => {
      assertEquals(typeof handlePullCommand, "function");
      assertEquals(handlePullCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ParsedArgs parameter", () => {
      assertEquals(handlePullCommand.length, 1);
    });
  });

  describe("parsePullArgs via handler", () => {
    it("should parse defaults when no flags provided", () => {
      const result = parsePullArgs(createArgs());
      assertSuccess(result);
      assertEquals(result.data.projectSlug, undefined);
      assertEquals(result.data.projects, undefined);
      assertEquals(result.data.branch, undefined);
      assertEquals(result.data.env, undefined);
      assertEquals(result.data.release, undefined);
      assertEquals(result.data.force, false);
      assertEquals(result.data.dryRun, false);
      assertEquals(result.data.quiet, false);
    });

    it("should parse positional project slug", () => {
      const result = parsePullArgs({ _: ["pull", "my-project"] } as ParsedArgs);
      assertSuccess(result);
      assertEquals(result.data.projectSlug, "my-project");
    });

    it("should parse --branch flag", () => {
      const result = parsePullArgs(createArgs({ branch: "develop" }));
      assertSuccess(result);
      assertEquals(result.data.branch, "develop");
    });

    it("should parse -b short flag as branch", () => {
      const result = parsePullArgs(createArgs({ b: "feature-x" }));
      assertSuccess(result);
      assertEquals(result.data.branch, "feature-x");
    });

    it("should parse --env flag", () => {
      const result = parsePullArgs(createArgs({ env: "staging" }));
      assertSuccess(result);
      assertEquals(result.data.env, "staging");
    });

    it("should parse --release flag", () => {
      const result = parsePullArgs(createArgs({ release: "v1.2.0" }));
      assertSuccess(result);
      assertEquals(result.data.release, "v1.2.0");
    });

    it("should parse --force flag", () => {
      const result = parsePullArgs(createArgs({ force: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse -f short flag as force", () => {
      const result = parsePullArgs(createArgs({ f: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse --dry-run flag", () => {
      const result = parsePullArgs(createArgs({ "dry-run": true }));
      assertSuccess(result);
      assertEquals(result.data.dryRun, true);
    });

    it("should parse --quiet flag", () => {
      const result = parsePullArgs(createArgs({ quiet: true }));
      assertSuccess(result);
      assertEquals(result.data.quiet, true);
    });

    it("should parse -q short flag as quiet", () => {
      const result = parsePullArgs(createArgs({ q: true }));
      assertSuccess(result);
      assertEquals(result.data.quiet, true);
    });

    it("should parse --projects as CSV string", () => {
      const result = parsePullArgs(createArgs({ projects: "app-a,app-b,app-c" }));
      assertSuccess(result);
      assertEquals(result.data.projects, ["app-a", "app-b", "app-c"]);
    });

    it("should parse --projects as array", () => {
      const result = parsePullArgs(createArgs({ projects: ["app-a", "app-b"] }));
      assertSuccess(result);
      assertEquals(result.data.projects, ["app-a", "app-b"]);
    });

    it("should parse --project-dir flag", () => {
      const result = parsePullArgs(createArgs({ "project-dir": "/tmp/my-project" }));
      assertSuccess(result);
      assertEquals(result.data.projectDir, "/tmp/my-project");
    });

    it("should parse --dir flag as project dir", () => {
      const result = parsePullArgs(createArgs({ dir: "/tmp/other" }));
      assertSuccess(result);
      assertEquals(result.data.projectDir, "/tmp/other");
    });

    it("should parse -d short flag as project dir", () => {
      const result = parsePullArgs(createArgs({ d: "/tmp/short" }));
      assertSuccess(result);
      assertEquals(result.data.projectDir, "/tmp/short");
    });

    it("should parse multiple flags together", () => {
      const result = parsePullArgs(createArgs({
        branch: "staging",
        env: "preview",
        force: true,
        "dry-run": true,
        quiet: true,
      }));
      assertSuccess(result);
      assertEquals(result.data.branch, "staging");
      assertEquals(result.data.env, "preview");
      assertEquals(result.data.force, true);
      assertEquals(result.data.dryRun, true);
      assertEquals(result.data.quiet, true);
    });

    it("should always succeed parsing (all fields are optional)", () => {
      const result = parsePullArgs(createArgs());
      assertEquals(result.success, true);
    });
  });
});
