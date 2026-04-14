/**
 * MCP tool for running the linter via MCP.
 *
 * Spawns `deno lint --json` and returns structured diagnostics.
 *
 * @module cli/mcp/tools/run-lint-tool
 */

import { z } from "zod";
import type { MCPTool } from "../tools.ts";
import { type LintResult, parseLintJsonOutput } from "../../commands/lint/command.ts";

// ============================================================================
// Tool: vf_run_lint
// ============================================================================

const runLintInput = z.object({});

type RunLintInput = z.infer<typeof runLintInput>;

export const vfRunLint: MCPTool<RunLintInput, LintResult> = {
  name: "vf_run_lint",
  title: "Run Lint",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Use this when you need to check the project for lint errors and style violations. Runs `deno lint` and returns structured diagnostics with file, line, column, code, and message. Do not use for runtime errors — use vf_get_errors instead. Do not use for formatting — use a formatter tool instead.",
  inputSchema: runLintInput,
  execute: async () => {
    const command = new Deno.Command("deno", {
      args: ["lint", "--json"],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);

    return parseLintJsonOutput(output, code);
  },
};
