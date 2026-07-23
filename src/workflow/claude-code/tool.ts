/** Claude Code workflow tools. */

import { INVALID_ARGUMENT } from "#veryfront/errors";
import { defineSchema, getJsonValueSchema } from "#veryfront/schemas/index.ts";
import { type Tool, tool, type ToolExecutionContext } from "#veryfront/tool";
import {
  type AgentConfig,
  CLAUDE_CODE_DEFAULT_MAX_TURNS,
  CLAUDE_CODE_MAX_MAX_TURNS,
  CLAUDE_CODE_MIN_MAX_TURNS,
  executeAgent,
} from "./agent.ts";
import type { ClaudeCodeMode, ClaudeCodeResult, ClaudeCodeToolInput } from "./types.ts";

const DEFAULT_TOOL_ID = "claude-code";
const DEFAULT_TOOL_DESCRIPTION = "Run a trusted local Claude Code agent for iterative coding tasks";
const DEFAULT_MODE: ClaudeCodeMode = "code";
const DEFAULT_MAX_TURNS = CLAUDE_CODE_DEFAULT_MAX_TURNS;
const MIN_MAX_TURNS = CLAUDE_CODE_MIN_MAX_TURNS;
const MAX_MAX_TURNS = CLAUDE_CODE_MAX_MAX_TURNS;
const CLAUDE_CODE_MODES = [
  "code",
  "analysis",
  "custom",
] as const satisfies readonly ClaudeCodeMode[];

interface ClaudeCodeToolOptions {
  id?: string;
  description?: string;
  defaultMode?: ClaudeCodeMode;
  defaultMaxTurns?: number;
  system?: string;
  /** SDK tools available to the agent. */
  tools?: string[];
  /** Available SDK tools that may run without an interactive approval prompt. */
  allowedTools?: string[];
  /** Enable metadata-only agent debug logging. */
  debug?: boolean;
}

type ClaudeCodeExecutor = (
  task: string,
  config: AgentConfig,
) => Promise<ClaudeCodeResult>;

function assertSupportedMode(mode: unknown, label: string): asserts mode is ClaudeCodeMode {
  if (!CLAUDE_CODE_MODES.includes(mode as ClaudeCodeMode)) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} must be one of: ${CLAUDE_CODE_MODES.join(", ")}`,
    });
  }
}

function assertDefaultMaxTurns(value: number): void {
  if (
    !Number.isInteger(value) || value < MIN_MAX_TURNS || value > MAX_MAX_TURNS
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `defaultMaxTurns must be an integer from ${MIN_MAX_TURNS} through ${MAX_MAX_TURNS}`,
    });
  }
}

function createClaudeCodeInputSchema(
  defaultMode: ClaudeCodeMode,
  defaultMaxTurns: number,
  enforcedMode?: ClaudeCodeMode,
) {
  return defineSchema((v) =>
    v.object({
      task: v.string().min(1).describe("Task for the Claude Code agent to perform"),
      mode: enforcedMode === undefined
        ? v.enum(CLAUDE_CODE_MODES)
          .optional()
          .default(defaultMode)
          .describe("Permission mode for the task")
        : v.literal(enforcedMode)
          .optional()
          .default(enforcedMode)
          .describe("Permission mode enforced for this tool"),
      maxTurns: v.number()
        .int()
        .min(MIN_MAX_TURNS)
        .max(MAX_MAX_TURNS)
        .optional()
        .default(defaultMaxTurns)
        .describe("Maximum number of agent turns"),
      files: v.array(v.string())
        .optional()
        .describe("File paths to highlight in the task prompt"),
      context: v.record(v.string(), getJsonValueSchema())
        .optional()
        .describe("Structured context to append to the task prompt"),
      system: v.string()
        .optional()
        .describe("System prompt override for this execution"),
    }).strict()
  )();
}

function buildPrompt(input: ClaudeCodeToolInput): string {
  let prompt = input.task;

  if (input.files && input.files.length > 0) {
    prompt += `\n\nFocus on these files:\n${input.files.map((file) => `- ${file}`).join("\n")}`;
  }

  if (input.context) {
    prompt += `\n\nAdditional context:\n${JSON.stringify(input.context, null, 2)}`;
  }

  return prompt;
}

function createTool(
  options: ClaudeCodeToolOptions,
  executor: ClaudeCodeExecutor,
  enforcedMode?: ClaudeCodeMode,
): Tool<ClaudeCodeToolInput, ClaudeCodeResult> {
  const defaultMode = options.defaultMode ?? DEFAULT_MODE;
  const defaultMaxTurns = options.defaultMaxTurns ?? DEFAULT_MAX_TURNS;
  assertSupportedMode(defaultMode, "defaultMode");
  assertDefaultMaxTurns(defaultMaxTurns);
  if (enforcedMode !== undefined) assertSupportedMode(enforcedMode, "enforcedMode");

  const inputSchema = createClaudeCodeInputSchema(
    defaultMode,
    defaultMaxTurns,
    enforcedMode,
  );

  return tool<ClaudeCodeToolInput, ClaudeCodeResult>({
    id: options.id ?? DEFAULT_TOOL_ID,
    description: options.description ?? DEFAULT_TOOL_DESCRIPTION,
    inputSchema,
    execute: (
      input: ClaudeCodeToolInput,
      context?: ToolExecutionContext,
    ): Promise<ClaudeCodeResult> => {
      const mode = enforcedMode ?? input.mode ?? defaultMode;
      const maxTurns = input.maxTurns ?? defaultMaxTurns;
      return executor(buildPrompt(input), {
        mode,
        maxTurns,
        systemPrompt: input.system ?? options.system,
        tools: options.tools,
        allowedTools: options.allowedTools,
        abortSignal: context?.abortSignal,
        debug: options.debug,
      });
    },
  });
}

function createLazyTool<TInput, TOutput>(
  factory: () => Tool<TInput, TOutput>,
): Tool<TInput, TOutput> {
  const target = {} as Tool<TInput, TOutput>;
  let materialized = false;
  const materialize = () => {
    if (materialized) return;
    const created = factory();
    Object.defineProperties(target, Object.getOwnPropertyDescriptors(created));
    materialized = true;
  };

  return new Proxy(target, {
    get(target, property, receiver) {
      materialize();
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      materialize();
      return Reflect.set(target, property, value, receiver);
    },
    has(target, property) {
      materialize();
      return Reflect.has(target, property);
    },
    ownKeys(target) {
      materialize();
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, property) {
      materialize();
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    defineProperty(target, property, descriptor) {
      materialize();
      return Reflect.defineProperty(target, property, descriptor);
    },
    deleteProperty(target, property) {
      materialize();
      return Reflect.deleteProperty(target, property);
    },
    getPrototypeOf(target) {
      materialize();
      return Reflect.getPrototypeOf(target);
    },
    setPrototypeOf(target, prototype) {
      materialize();
      return Reflect.setPrototypeOf(target, prototype);
    },
    isExtensible(target) {
      materialize();
      return Reflect.isExtensible(target);
    },
    preventExtensions(target) {
      materialize();
      return Reflect.preventExtensions(target);
    },
  });
}

/** Claude Code tool for trusted local workflow steps. */
export const claudeCodeTool = createLazyTool(() => createTool({}, executeAgent));

/** Create a configured Claude Code workflow tool. */
export function createClaudeCodeTool(
  options: ClaudeCodeToolOptions = {},
): Tool<ClaudeCodeToolInput, ClaudeCodeResult> {
  return createTool(options, executeAgent);
}

/**
 * Create a tool with an injected executor without changing production-global
 * state. This seam is intentionally excluded from the package entrypoint.
 *
 * @internal
 */
export function __createClaudeCodeToolForTests(
  options: ClaudeCodeToolOptions,
  executor: ClaudeCodeExecutor,
): Tool<ClaudeCodeToolInput, ClaudeCodeResult> {
  return createTool(options, executor);
}

/** Code review tool with analysis-only permissions. */
export const codeReviewTool = createLazyTool(() =>
  createTool(
    {
      id: "claude-code-review",
      description: "Analyze code for defects, risks, and maintainability issues",
      defaultMode: "analysis",
      defaultMaxTurns: 10,
      system: `You are an expert code reviewer. Analyze the code for:
- Security vulnerabilities
- Performance issues
- Code style and best practices
- Potential bugs
- Improvement suggestions

Provide specific, actionable feedback with file paths and line numbers.`,
    },
    executeAgent,
    "analysis",
  )
);

/** Bug fix tool with code permissions. */
export const bugFixTool = createLazyTool(() =>
  createClaudeCodeTool({
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
  })
);

/** Refactoring tool with code permissions. */
export const refactorTool = createLazyTool(() =>
  createClaudeCodeTool({
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
  })
);

/** Documentation tool with code permissions. */
export const docsTool = createLazyTool(() =>
  createClaudeCodeTool({
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
  })
);
