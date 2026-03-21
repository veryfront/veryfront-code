/**
 * Claude Agent SDK Tools
 *
 * Pre-configured tools for using the Claude Agent SDK in workflow steps.
 */

import { z } from "zod";
import type { Tool } from "#veryfront/tool";
import { executeAgent } from "./agent.ts";
import type { ClaudeCodeMode, ClaudeCodeResult } from "./types.ts";

/**
 * Input schema for claude-code tool
 */
const claudeCodeInputSchema = z.object({
  /** Task description for the agent */
  task: z.string().describe("The task for the Claude Code agent to perform"),

  /** Tool mode */
  mode: z
    .enum(["code", "analysis", "custom"])
    .optional()
    .default("code")
    .describe("Tool mode: code (read-write), analysis (read-only), custom (user-specified)"),

  /** Maximum turns */
  maxTurns: z
    .number()
    .max(100)
    .optional()
    .default(20)
    .describe("Maximum agentic loop turns"),

  /** Files to focus on */
  files: z
    .array(z.string())
    .optional()
    .describe("Specific files to focus on"),

  /** Additional context */
  context: z
    .record(z.unknown())
    .optional()
    .describe("Additional context to include in the prompt"),
});

type ClaudeCodeInput = z.infer<typeof claudeCodeInputSchema>;

/**
 * Build the full prompt from input
 */
function buildPrompt(input: ClaudeCodeInput): string {
  let prompt = input.task;

  if (input.files && input.files.length > 0) {
    prompt += `\n\nFocus on these files:\n${input.files.map((f) => `- ${f}`).join("\n")}`;
  }

  if (input.context) {
    prompt += `\n\nAdditional context:\n${JSON.stringify(input.context, null, 2)}`;
  }

  return prompt;
}

/**
 * Claude Code tool for workflow steps
 *
 * @example
 * ```typescript
 * import { workflow, step } from "veryfront/workflow";
 *
 * export const migration = workflow({
 *   id: "migration",
 *   steps: [
 *     step("migrate", {
 *       tool: "claude-code",
 *       input: {
 *         task: "Migrate from React 17 to React 19",
 *         mode: "code",
 *         maxTurns: 15,
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export const claudeCodeTool: Tool<ClaudeCodeInput, ClaudeCodeResult> = {
  id: "claude-code",
  type: "function",
  description: "Run a Claude Code agent for complex coding tasks. " +
    "Supports file editing, bash commands, and iterative problem-solving.",
  inputSchema: claudeCodeInputSchema as unknown as z.ZodSchema<ClaudeCodeInput>,
  inputSchemaJson: {
    type: "object",
    properties: {
      task: { type: "string", description: "The task for the agent" },
      mode: {
        type: "string",
        enum: ["code", "analysis", "custom"],
        default: "code",
      },
      maxTurns: { type: "number", default: 20 },
      files: { type: "array", items: { type: "string" } },
      context: { type: "object" },
    },
    required: ["task"],
  },

  execute: async (input, _context) => {
    return executeAgent(buildPrompt(input), {
      mode: input.mode as ClaudeCodeMode,
      maxTurns: input.maxTurns,
      debug: true,
    });
  },
};

/**
 * Create a customized Claude Code tool
 */
export function createClaudeCodeTool(
  options: {
    id?: string;
    description?: string;
    defaultMode?: ClaudeCodeMode;
    defaultMaxTurns?: number;
    system?: string;
  } = {},
): Tool<ClaudeCodeInput, ClaudeCodeResult> {
  return {
    ...claudeCodeTool,
    id: options.id || claudeCodeTool.id,
    description: options.description || claudeCodeTool.description,

    execute: (input, _context) => {
      const mergedInput: ClaudeCodeInput = {
        ...input,
        mode: input.mode || options.defaultMode || "code",
        maxTurns: input.maxTurns || options.defaultMaxTurns || 20,
      };

      return executeAgent(buildPrompt(mergedInput), {
        mode: mergedInput.mode as ClaudeCodeMode,
        maxTurns: mergedInput.maxTurns,
        systemPrompt: options.system,
        debug: true,
      });
    },
  };
}

/**
 * Pre-configured tools for common use cases
 */

/** Code review tool (analysis mode, read-only) */
export const codeReviewTool = createClaudeCodeTool({
  id: "claude-code-review",
  description: "Analyze code for issues, improvements, and best practices",
  defaultMode: "analysis",
  defaultMaxTurns: 10,
  system: `You are an expert code reviewer. Analyze the code for:
- Security vulnerabilities
- Performance issues
- Code style and best practices
- Potential bugs
- Improvement suggestions

Provide specific, actionable feedback with file paths and line numbers.`,
});

/** Bug fix tool (code mode) */
export const bugFixTool = createClaudeCodeTool({
  id: "claude-bug-fix",
  description: "Investigate and fix bugs in the codebase",
  defaultMode: "code",
  defaultMaxTurns: 15,
  system: `You are an expert debugger. Your goal is to:
1. Understand the bug from the description
2. Locate the relevant code
3. Identify the root cause
4. Implement a minimal fix
5. Verify the fix works

Be methodical and make minimal changes to fix the issue.`,
});

/** Refactoring tool (code mode) */
export const refactorTool = createClaudeCodeTool({
  id: "claude-refactor",
  description: "Refactor code for better structure and maintainability",
  defaultMode: "code",
  defaultMaxTurns: 20,
  system: `You are an expert at code refactoring. Your goals are:
- Improve code structure and organization
- Reduce duplication
- Improve naming and readability
- Maintain existing behavior (no functional changes)
- Keep changes focused and reviewable

Read the existing code thoroughly before making changes.`,
});

/** Documentation tool (code mode) */
export const docsTool = createClaudeCodeTool({
  id: "claude-docs",
  description: "Generate or improve code documentation",
  defaultMode: "code",
  defaultMaxTurns: 10,
  system: `You are a technical writer. Generate clear, accurate documentation:
- JSDoc/TSDoc comments for functions and classes
- README files for modules
- Inline comments for complex logic
- Usage examples

Match the existing documentation style in the codebase.`,
});
