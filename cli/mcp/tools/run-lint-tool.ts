/**
 * MCP tool: vf_run_lint
 *
 * Runs the linter via subprocess and returns structured diagnostics.
 * Reuses parseLintJsonOutput from the CLI lint command.
 */

import { z } from "zod";
import type { MCPTool } from "../tools.ts";
import { type LintResult, parseLintJsonOutput } from "../../commands/lint/command.ts";

const runLintInput = z.object({
  timeout: z.number().optional().default(120000).describe(
    "Maximum time to wait for lint completion in milliseconds. Defaults to 120000 (2 minutes).",
  ),
});

type RunLintInput = z.infer<typeof runLintInput>;

/** Spawn deno lint and return structured results. Exported for standalone reuse. */
export async function executeLint(
  input: { timeout?: number } = {},
): Promise<LintResult> {
  const cmd = new Deno.Command("deno", {
    args: ["lint", "--json"],
    stdout: "piped",
    stderr: "piped",
  });

  const child = cmd.spawn();
  const timeoutMs = input.timeout ?? 120000;

  const result = await Promise.race([
    child.output(),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Process may have already exited
        }
        reject(new Error(`Lint execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      Deno.unrefTimer(timer);
    }),
  ]);

  const stdout = new TextDecoder().decode(result.stdout);
  return parseLintJsonOutput(stdout, result.code);
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
    "Do not use for test results — use vf_run_tests instead. " +
    "Do not use for compile/runtime errors — use vf_get_errors instead.",
  inputSchema: runLintInput,
  execute: (input) => executeLint(input),
};
