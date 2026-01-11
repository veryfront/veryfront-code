/**
 * Claude Code Tool
 *
 * Pre-configured tool for using Claude Code in workflow steps.
 */

import { z } from "zod";
import type { Tool } from "../../types/tool.ts";
import { claudeCodeAgent } from "./agent.ts";
import type { ClaudeCodeMode, ClaudeCodeResult, SandboxMode } from "./types.ts";

/**
 * Input schema for claude-code tool
 */
const claudeCodeInputSchema = z.object({
  /** Task description for the agent */
  task: z.string().describe("The task for the Claude Code agent to perform"),

  /** Tool mode */
  mode: z
    .enum(["code", "analysis", "full", "custom"])
    .optional()
    .default("code")
    .describe("Tool mode: code (bash+editor), analysis (read-only), full (includes computer)"),

  /** Sandbox mode */
  sandbox: z
    .enum(["strict", "permissive", "none"])
    .optional()
    .describe("Sandbox isolation level"),

  /** Maximum iterations */
  maxIterations: z
    .number()
    .optional()
    .default(20)
    .describe("Maximum agentic loop iterations"),

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

  /** Custom system prompt */
  system: z
    .string()
    .optional()
    .describe("Custom system prompt override"),
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
 * import { workflow, step } from "veryfront/ai/workflow";
 *
 * export const migration = workflow({
 *   id: "migration",
 *   steps: [
 *     step("migrate", {
 *       tool: "claude-code",
 *       input: {
 *         task: "Migrate from React 17 to React 19",
 *         mode: "code",
 *         maxIterations: 15,
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
  inputSchema: claudeCodeInputSchema,
  jsonSchema: {
    type: "object",
    properties: {
      task: { type: "string", description: "The task for the agent" },
      mode: {
        type: "string",
        enum: ["code", "analysis", "full", "custom"],
        default: "code",
      },
      sandbox: {
        type: "string",
        enum: ["strict", "permissive", "none"],
      },
      maxIterations: { type: "number", default: 20 },
      files: { type: "array", items: { type: "string" } },
      context: { type: "object" },
      system: { type: "string" },
    },
    required: ["task"],
  },

  execute: async (input, _context) => {
    const agent = claudeCodeAgent({
      mode: input.mode as ClaudeCodeMode,
      sandbox: input.sandbox as SandboxMode | undefined,
      maxIterations: input.maxIterations,
      system: input.system,
      debug: true,
    });

    const prompt = buildPrompt(input);

    const response = await agent.generate({
      input: prompt,
      context: {},
    });

    // Parse result from response
    try {
      return JSON.parse(response.text) as ClaudeCodeResult;
    } catch {
      // If not JSON, wrap in result
      return {
        success: true,
        iterations: 1,
        response: response.text,
        filesModified: [],
        commandsExecuted: [],
        executionTime: 0,
        iterationHistory: [],
      };
    }
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
    defaultMaxIterations?: number;
    system?: string;
  } = {},
): Tool<ClaudeCodeInput, ClaudeCodeResult> {
  return {
    ...claudeCodeTool,
    id: options.id || claudeCodeTool.id,
    description: options.description || claudeCodeTool.description,

    execute: (input, context) => {
      const mergedInput: ClaudeCodeInput = {
        ...input,
        mode: input.mode || options.defaultMode || "code",
        maxIterations: input.maxIterations || options.defaultMaxIterations || 20,
        system: input.system || options.system,
      };

      return claudeCodeTool.execute(mergedInput, context);
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
  defaultMaxIterations: 10,
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
  defaultMaxIterations: 15,
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
  defaultMaxIterations: 20,
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
  defaultMaxIterations: 10,
  system: `You are a technical writer. Generate clear, accurate documentation:
- JSDoc/TSDoc comments for functions and classes
- README files for modules
- Inline comments for complex logic
- Usage examples

Match the existing documentation style in the codebase.`,
});
