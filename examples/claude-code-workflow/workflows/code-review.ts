/**
 * Code Review Workflow
 *
 * Uses Claude Code in analysis mode (read-only) to review a codebase
 * and produce a structured report.
 *
 * Steps:
 * 1. Analyze - Claude Code reads the codebase and identifies issues
 * 2. Summarize - Produces a structured review report
 */

import { step, workflow } from "veryfront/workflow";
import { z } from "zod";

const inputSchema = z.object({
  /** Directory or files to review */
  target: z.string().describe("Directory or file path to review"),
  /** What to focus on */
  focus: z
    .enum(["security", "performance", "quality", "all"])
    .default("all")
    .describe("Review focus area"),
});

export type CodeReviewInput = z.infer<typeof inputSchema>;

export const codeReviewWorkflow = workflow<CodeReviewInput>({
  id: "code-review",
  description: "AI-powered code review using Claude Code",
  version: "1.0.0",
  inputSchema,

  steps: ({ input }) => [
    step("analyze", {
      tool: "claude-code-review",
      input: {
        task: `Review the code in ${input.target}. Focus on: ${input.focus}.

Produce a structured analysis covering:
- Critical issues (bugs, security vulnerabilities)
- Warnings (performance, potential issues)
- Suggestions (code style, readability, best practices)

For each finding, include the file path, line number, severity, and a clear explanation.`,
        files: [input.target],
      },
      timeout: "10m",
    }),
  ],

  onComplete: (_result, context) => {
    console.log(`[CodeReview] Completed review for run ${context.runId}`);
  },
});

export default codeReviewWorkflow;
