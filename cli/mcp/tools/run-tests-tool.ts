/**
 * MCP tool: vf_run_tests
 *
 * Runs the project test suite via subprocess and returns structured results.
 * Reuses parseTestOutput from the CLI test command.
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import type { MCPTool } from "veryfront/mcp";
import { parseTestOutput, type TestResult } from "../../commands/test/command.ts";

const getRunTestsInput = defineSchema((v) =>
  v.object({
    filter: v.string().optional().describe(
      "Filter tests by name pattern. Example: 'router' to run only tests matching 'router'.",
    ),
    parallel: v.boolean().optional().default(false).describe(
      "Run tests in parallel. Defaults to false.",
    ),
    timeout: v.number().optional().default(300000).describe(
      "Maximum time to wait for test completion in milliseconds. Defaults to 300000 (5 minutes).",
    ),
  })
);
const runTestsInput = lazySchema(getRunTestsInput);

type RunTestsInput = InferSchema<ReturnType<typeof getRunTestsInput>>;

/** Build the deno test command args from input options. */
export function buildTestArgs(input: { filter?: string; parallel?: boolean }): string[] {
  return [
    "test",
    "--no-check",
    "--allow-all",
    "--unstable-worker-options",
    "--unstable-net",
    ...(input.parallel ? ["--parallel"] : []),
    ...(input.filter ? [`--filter=${input.filter}`] : []),
  ];
}

/** Env vars required for deterministic test runs. */
export const TEST_ENV: Record<string, string> = {
  VF_DISABLE_LRU_INTERVAL: "1",
  SSR_TRANSFORM_PER_PROJECT_LIMIT: "0",
  REVALIDATION_PER_PROJECT_LIMIT: "0",
  NODE_ENV: "production",
  LOG_FORMAT: "text",
};

/** Spawn deno test and return structured results. Exported for standalone reuse. */
export async function executeTests(
  input: { filter?: string; parallel?: boolean; timeout?: number },
): Promise<TestResult> {
  const cmd = new Deno.Command("deno", {
    args: buildTestArgs(input),
    stdout: "piped",
    stderr: "piped",
    env: TEST_ENV,
  });

  const child = cmd.spawn();
  const timeoutMs = input.timeout ?? 300000;

  const result = await Promise.race([
    child.output(),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Process may have already exited
        }
        reject(new Error(`Test execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      // Don't prevent process exit while waiting
      Deno.unrefTimer(timer);
    }),
  ]);

  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  return parseTestOutput(stdout + "\n" + stderr, result.code);
}

export const vfRunTests: MCPTool<RunTestsInput, TestResult> = {
  name: "vf_run_tests",
  title: "Run Tests",
  annotations: {
    readOnlyHint: false,
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
  execute: (input) => executeTests(input),
};
