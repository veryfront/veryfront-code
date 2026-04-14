/**
 * MCP tool: vf_run_tests
 *
 * Runs the project test suite via subprocess and returns structured results.
 * Reuses parseTestOutput from the CLI test command.
 */

import { z } from "zod";
import type { MCPTool } from "veryfront/mcp";
import { parseTestOutput, type TestResult } from "../../commands/test/command.ts";

const runTestsInput = z.object({
  filter: z.string().optional().describe(
    "Filter tests by name pattern. Example: 'router' to run only tests matching 'router'.",
  ),
  parallel: z.boolean().optional().default(false).describe(
    "Run tests in parallel. Defaults to false.",
  ),
});

type RunTestsInput = z.infer<typeof runTestsInput>;

export const vfRunTests: MCPTool<RunTestsInput, TestResult> = {
  name: "vf_run_tests",
  title: "Run Tests",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Use this when you need to run the project's test suite and get structured pass/fail results. " +
    "Returns a summary with total, passed, failed, skipped counts and failure details including " +
    "file path, test name, error message, and line number. " +
    "Do not use for lint checks — use vf_run_lint instead.",
  inputSchema: runTestsInput,
  execute: async (input) => {
    const cmd = new Deno.Command("deno", {
      args: [
        "test",
        "--no-check",
        "--allow-all",
        "--unstable-worker-options",
        "--unstable-net",
        ...(input.parallel ? ["--parallel"] : []),
        ...(input.filter ? [`--filter=${input.filter}`] : []),
      ],
      stdout: "piped",
      stderr: "piped",
      env: {
        VF_DISABLE_LRU_INTERVAL: "1",
        SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
        REVALIDATION_PER_PROJECT_LIMIT: "0",
        NODE_ENV: "production",
        LOG_FORMAT: "text",
      },
    });

    const result = await cmd.output();
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    return parseTestOutput(stdout + "\n" + stderr, result.code);
  },
};
