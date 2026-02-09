/**
 * Bug Fix Workflow
 *
 * Uses Claude Code to investigate and fix a bug, then review the fix.
 *
 * Steps:
 * 1. Investigate - Claude Code analyzes the bug (read-only)
 * 2. Fix - Claude Code implements the fix (code mode)
 * 3. Verify - Claude Code reviews its own fix (read-only)
 */

import { step, workflow } from "veryfront/workflow";
import { z } from "zod";

const inputSchema = z.object({
  /** Bug description */
  description: z.string().describe("Description of the bug"),
  /** Files likely involved */
  files: z.array(z.string()).optional().describe("Files that might be relevant"),
  /** Error message if available */
  errorMessage: z.string().optional().describe("Error message or stack trace"),
});

export type BugFixInput = z.infer<typeof inputSchema>;

export const bugFixWorkflow = workflow<BugFixInput>({
  id: "bug-fix",
  description: "Investigate and fix a bug using Claude Code",
  version: "1.0.0",
  inputSchema,

  steps: ({ input }) => [
    // Step 1: Investigate the bug (read-only)
    step("investigate", {
      tool: "claude-code-review",
      input: {
        task: `Investigate this bug:

${input.description}
${input.errorMessage ? `\nError: ${input.errorMessage}` : ""}

Read the relevant code and identify the root cause. Do not make any changes yet.
Explain what's happening and where the fix should be applied.`,
        files: input.files,
      },
      timeout: "5m",
    }),

    // Step 2: Implement the fix
    step("fix", {
      tool: "claude-bug-fix",
      input: {
        task: `Fix this bug:

${input.description}
${input.errorMessage ? `\nError: ${input.errorMessage}` : ""}

Make the minimal change needed to fix the issue. Run any relevant tests after.`,
        files: input.files,
      },
      timeout: "10m",
    }),

    // Step 3: Verify the fix (read-only)
    step("verify", {
      tool: "claude-code-review",
      input: {
        task: `Review the changes that were just made to fix this bug:

${input.description}

Verify that:
1. The fix addresses the root cause
2. No new issues were introduced
3. Edge cases are handled
4. The fix is minimal and focused`,
        files: input.files,
      },
      timeout: "5m",
    }),
  ],

  onComplete: (_result, context) => {
    console.log(`[BugFix] Completed fix for run ${context.runId}`);
  },
});

export default bugFixWorkflow;
