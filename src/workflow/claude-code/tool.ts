/**
 * Claude Agent SDK Tools
 *
 * Pre-configured tools for using the Claude Agent SDK in workflow steps.
 */

import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import type { Tool } from "#veryfront/tool";
import { isAbsolute, resolve } from "veryfront/platform/path";
import { executeAgent, MAX_CLAUDE_CODE_AGENT_TURNS } from "./agent.ts";
import type { ClaudeCodeMode, ClaudeCodeResult } from "./types.ts";

const getClaudeCodeInputSchema = (defaultMode: ClaudeCodeMode = "analysis") =>
  defineSchema((v) =>
    v.object({
      task: v.string().min(1).describe("The task for the Claude Code agent to perform"),
      mode: v
        .enum(["code", "analysis", "custom"])
        .optional()
        .default(defaultMode)
        .describe("Tool mode: code (read-write), analysis (read-only), custom (user-specified)"),
      maxTurns: v
        .number()
        .int()
        .positive()
        .max(MAX_CLAUDE_CODE_AGENT_TURNS)
        .optional()
        .default(20)
        .describe("Maximum agentic loop turns"),
      files: v
        .array(v.string())
        .optional()
        .describe("Specific files to focus on"),
      context: v
        .record(v.string(), v.unknown())
        .optional()
        .describe("Additional context to include in the prompt"),
    })
  );

type ClaudeCodeInput = InferSchema<
  ReturnType<ReturnType<typeof getClaudeCodeInputSchema>>
>;

const CLAUDE_CODE_INPUT_SCHEMA_JSON: NonNullable<
  Tool<ClaudeCodeInput, ClaudeCodeResult>["inputSchemaJson"]
> = {
  type: "object",
  properties: {
    task: { type: "string", description: "The task for the agent" },
    mode: {
      type: "string",
      enum: ["code", "analysis", "custom"],
      default: "analysis",
    },
    maxTurns: { type: "number", default: 20 },
    files: { type: "array", items: { type: "string" } },
    context: { type: "object" },
  },
  required: ["task"],
};

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

async function executeToolAgent(
  task: string,
  config: Parameters<typeof executeAgent>[1],
): Promise<ClaudeCodeResult> {
  const result = await executeAgent(task, config);
  if (!result.success) {
    throw new Error(`Claude Code agent execution failed: ${result.error}`);
  }
  return result;
}

function admittedWorkingDirectory(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.includes("\0") || !isAbsolute(value) || resolve(value) !== value
  ) {
    throw new TypeError(
      "Claude Code tool working directory must be an explicit canonical absolute path",
    );
  }
  return value;
}

function resolveToolWorkingDirectory(
  mode: ClaudeCodeMode,
  configuredCwd: string | undefined,
  contextCwd: unknown,
): string | undefined {
  const cwd = configuredCwd ?? admittedWorkingDirectory(contextCwd);
  if (mode !== "analysis" && cwd === undefined) {
    throw new TypeError(
      "Writable Claude Code tool execution requires an explicit absolute working directory",
    );
  }
  return cwd;
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
  inputSchema: getClaudeCodeInputSchema()() as unknown as Schema<ClaudeCodeInput>,
  inputSchemaJson: CLAUDE_CODE_INPUT_SCHEMA_JSON,

  execute: async (input, context) => {
    const mode = input.mode as ClaudeCodeMode;
    return executeToolAgent(buildPrompt(input), {
      mode,
      maxTurns: input.maxTurns,
      cwd: resolveToolWorkingDirectory(mode, undefined, context?.cwd),
      abortSignal: context?.abortSignal,
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
    /** Host-admitted absolute working directory used for provider file operations. */
    cwd?: string;
  } = {},
): Tool<ClaudeCodeInput, ClaudeCodeResult> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Claude Code tool options must be an object");
  }
  if (options.id !== undefined && options.id.trim().length === 0) {
    throw new TypeError("Claude Code tool id must be a non-empty string");
  }
  if (
    options.description !== undefined &&
    options.description.trim().length === 0
  ) {
    throw new TypeError("Claude Code tool description must be a non-empty string");
  }
  if (
    options.defaultMode !== undefined &&
    !(["analysis", "code", "custom"] as const).includes(options.defaultMode)
  ) {
    throw new TypeError("Claude Code tool defaultMode must be analysis, code, or custom");
  }
  if (
    options.defaultMaxTurns !== undefined &&
    (!Number.isSafeInteger(options.defaultMaxTurns) ||
      options.defaultMaxTurns < 1 ||
      options.defaultMaxTurns > MAX_CLAUDE_CODE_AGENT_TURNS)
  ) {
    throw new RangeError(
      `Claude Code tool defaultMaxTurns must be between 1 and ${MAX_CLAUDE_CODE_AGENT_TURNS}`,
    );
  }
  if (options.system !== undefined && options.system.trim().length === 0) {
    throw new TypeError("Claude Code tool system prompt must be a non-empty string");
  }
  const configuredCwd = admittedWorkingDirectory(options.cwd);

  const id = options.id ?? claudeCodeTool.id;
  const description = options.description ?? claudeCodeTool.description;
  const defaultMode = options.defaultMode ?? "analysis";
  const defaultMaxTurns = options.defaultMaxTurns ?? 20;
  const systemPrompt = options.system;

  return {
    ...claudeCodeTool,
    id,
    description,
    inputSchema: getClaudeCodeInputSchema(defaultMode)() as unknown as Schema<ClaudeCodeInput>,
    inputSchemaJson: {
      ...CLAUDE_CODE_INPUT_SCHEMA_JSON,
      properties: {
        ...CLAUDE_CODE_INPUT_SCHEMA_JSON.properties,
        mode: {
          type: "string",
          enum: ["code", "analysis", "custom"],
          default: defaultMode,
        },
      },
    },

    execute: (input, context) => {
      const mergedInput: ClaudeCodeInput = {
        ...input,
        mode: input.mode ?? defaultMode,
        maxTurns: input.maxTurns ?? defaultMaxTurns,
      };

      return executeToolAgent(buildPrompt(mergedInput), {
        mode: mergedInput.mode as ClaudeCodeMode,
        maxTurns: mergedInput.maxTurns,
        systemPrompt,
        cwd: resolveToolWorkingDirectory(
          mergedInput.mode as ClaudeCodeMode,
          configuredCwd,
          context?.cwd,
        ),
        abortSignal: context?.abortSignal,
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
