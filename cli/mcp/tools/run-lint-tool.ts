/**
 * MCP tool: vf_run_lint
 *
 * Runs the linter via subprocess and returns structured diagnostics.
 * Reuses parseLintJsonOutput from the CLI lint command.
 */

import { defineSchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import type { MCPTool } from "../tools.ts";
import { type LintResult, parseLintJsonOutput } from "../../commands/lint/command.ts";

const getRunLintInput = defineSchema((v) =>
  v.object({
    timeout: v.number().optional().default(120000).describe(
      "Maximum time to wait for lint completion in milliseconds. Defaults to 120000 (2 minutes).",
    ),
  })
);
const runLintInput = getRunLintInput();

type RunLintInput = InferSchema<ReturnType<typeof getRunLintInput>>;

const PROCESS_CLEANUP_TIMEOUT_MS = 1000;

async function waitForProcessCleanup(outputSettled: Promise<void>): Promise<void> {
  let cleanupTimeout: number | undefined;
  try {
    await Promise.race([
      outputSettled,
      new Promise<void>((resolve) => {
        cleanupTimeout = setTimeout(resolve, PROCESS_CLEANUP_TIMEOUT_MS);
        Deno.unrefTimer(cleanupTimeout);
      }),
    ]);
  } finally {
    if (cleanupTimeout !== undefined) {
      clearTimeout(cleanupTimeout);
    }
  }
}

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
  const outputPromise = child.output();
  const outputSettled = outputPromise.then(
    () => undefined,
    () => undefined,
  );
  let timeout: number | undefined;

  try {
    const result = await Promise.race([
      outputPromise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          try {
            child.kill();
          } catch {
            // Process may have already exited
          }
          reject(new Error(`Lint execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        Deno.unrefTimer(timeout);
      }),
    ]);

    const stdout = new TextDecoder().decode(result.stdout);
    return parseLintJsonOutput(stdout, result.code);
  } catch (error) {
    if (error instanceof Error && error.message.includes("timed out")) {
      await waitForProcessCleanup(outputSettled);
    }
    throw error;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
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
