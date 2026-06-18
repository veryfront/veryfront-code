/**
 * MCP tool: vf_run_lint
 *
 * Runs the linter via subprocess and returns structured diagnostics.
 * Reuses parseLintJsonOutput from the CLI lint command.
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { runCommand } from "veryfront/platform";
import type { MCPTool } from "../tools.ts";
import { type LintResult, parseLintJsonOutput } from "../../commands/lint/command.ts";

const getRunLintInput = defineSchema((v) =>
  v.object({
    timeout: v.number().optional().default(120000).describe(
      "Maximum time to wait for lint completion in milliseconds. Defaults to 120000 (2 minutes).",
    ),
  })
);
const runLintInput = lazySchema(getRunLintInput);

type RunLintInput = InferSchema<ReturnType<typeof getRunLintInput>>;

/** Spawn deno lint and return structured results. Exported for standalone reuse. */
export async function executeLint(
  input: { timeout?: number } = {},
): Promise<LintResult> {
  const timeoutMs = input.timeout ?? 120000;
  const result = await runCommand("deno", {
    args: ["lint", "--json"],
    capture: true,
    timeoutMs,
  });

  if (result.code === 124) {
    throw new Error(`Lint execution timed out after ${timeoutMs}ms`);
  }

  return parseLintJsonOutput(result.stdout ?? "", result.code);
}

export const vfRunLint: MCPTool<RunLintInput, LintResult> = {
  name: "vf_run_lint",
  title: "Run Lint",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: "Use this when you need to check for lint issues in the project. " +
    "Returns structured diagnostics with file path, line, column, rule code, and message for each issue. " +
    "Do not use for test results. Use vf_run_tests instead. " +
    "Do not use for compile/runtime errors. Use vf_get_errors instead.",
  inputSchema: runLintInput,
  execute: (input) => executeLint(input),
};
