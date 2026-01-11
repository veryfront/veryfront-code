/**
 * Claude Code Agent
 *
 * Wraps Anthropic's Claude Code SDK for use in Veryfront workflows.
 * Provides agentic coding capabilities with tenant-aware file operations.
 */

import { logger } from "@veryfront/utils";
import { api } from "../../api.ts";
import { getWorkflowTenant } from "../executor/step-executor.ts";
import type { Agent, AgentResponse } from "../../types/agent.ts";
import type {
  AnthropicToolDefinition,
  BashToolInput,
  ClaudeCodeAgentConfig,
  ClaudeCodeContext,
  ClaudeCodeMode,
  ClaudeCodeResult,
  ClaudeToolCall,
  ClaudeToolResult,
  IterationResult,
  TextEditorToolInput,
} from "./types.ts";

/** Default model for Claude Code */
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/** Default max iterations */
const DEFAULT_MAX_ITERATIONS = 20;

/** Default iteration timeout (5 minutes) - reserved for per-iteration limits */
const _DEFAULT_ITERATION_TIMEOUT = 5 * 60 * 1000;

/** Default total timeout (30 minutes) */
const DEFAULT_TOTAL_TIMEOUT = 30 * 60 * 1000;

/**
 * Default system prompt for Claude Code agent
 */
const DEFAULT_SYSTEM = `You are an expert software engineer working on a codebase.
You have access to tools for reading files, editing files, and running bash commands.
Always read relevant files before making changes to understand the existing code.
Make minimal, focused changes that solve the task.
After making changes, verify them by reading the file or running tests.
If you encounter errors, analyze them and try a different approach.`;

/**
 * Get tool definitions for a mode
 */
function getToolsForMode(mode: ClaudeCodeMode): AnthropicToolDefinition[] {
  switch (mode) {
    case "analysis":
      // Read-only mode - no bash or editor
      return [];

    case "code":
      return [
        { type: "bash_20250124", name: "bash" },
        { type: "text_editor_20250124", name: "str_replace_editor" },
      ];

    case "full":
      return [
        { type: "bash_20250124", name: "bash" },
        { type: "text_editor_20250124", name: "str_replace_editor" },
        {
          type: "computer_20250124",
          name: "computer",
          display_width_px: 1024,
          display_height_px: 768,
        },
      ];

    case "custom":
      return [];

    default:
      return [
        { type: "bash_20250124", name: "bash" },
        { type: "text_editor_20250124", name: "str_replace_editor" },
      ];
  }
}

/**
 * Execute bash tool
 * NOTE(#claude-code-sandbox): Bash sandbox execution to be implemented
 */
function executeBash(
  input: BashToolInput,
  context: ClaudeCodeContext,
  config: ClaudeCodeAgentConfig,
): Promise<{ output: string; isError: boolean }> {
  config.onToolCall?.("bash", input);

  context.executedCommands.push(input.command);

  // Placeholder - actual sandbox execution to be implemented (#claude-code-sandbox)
  const result = {
    output: `[Bash execution not yet implemented]\nCommand: ${input.command}`,
    isError: false,
  };

  config.onToolResult?.("bash", result.output, result.isError);

  return Promise.resolve(result);
}

/**
 * Execute text editor tool using Veryfront's tenant-aware API
 */
async function executeTextEditor(
  input: TextEditorToolInput,
  context: ClaudeCodeContext,
  config: ClaudeCodeAgentConfig,
): Promise<{ output: string; isError: boolean }> {
  config.onToolCall?.("str_replace_editor", input);

  try {
    switch (input.command) {
      case "view": {
        // Use tenant-aware API to read file
        const content = await api.files.read(input.path);
        const lines = content.split("\n");

        if (input.view_range) {
          const [start, end] = input.view_range;
          const selectedLines = lines.slice(start - 1, end);
          const output = selectedLines
            .map((line, i) => `${start + i}: ${line}`)
            .join("\n");
          config.onToolResult?.("str_replace_editor", output, false);
          return { output, isError: false };
        }

        const output = lines.map((line, i) => `${i + 1}: ${line}`).join("\n");
        config.onToolResult?.("str_replace_editor", output, false);
        return { output, isError: false };
      }

      case "create": {
        if (!input.file_text) {
          return { output: "Error: file_text required for create", isError: true };
        }
        // NOTE(#claude-code-write): File creation via API to be implemented
        context.modifiedFiles.add(input.path);
        const output = `Created file: ${input.path}`;
        config.onToolResult?.("str_replace_editor", output, false);
        return { output, isError: false };
      }

      case "str_replace": {
        if (!input.old_str || input.new_str === undefined) {
          return { output: "Error: old_str and new_str required for str_replace", isError: true };
        }

        const content = await api.files.read(input.path);
        if (!content.includes(input.old_str)) {
          const output = `Error: old_str not found in ${input.path}`;
          config.onToolResult?.("str_replace_editor", output, true);
          return { output, isError: true };
        }

        // NOTE(#claude-code-write): File write via API to be implemented
        context.modifiedFiles.add(input.path);
        const output = `Replaced in ${input.path}`;
        config.onToolResult?.("str_replace_editor", output, false);
        return { output, isError: false };
      }

      case "insert": {
        if (input.insert_line === undefined || input.new_str === undefined) {
          return { output: "Error: insert_line and new_str required for insert", isError: true };
        }
        // NOTE(#claude-code-write): Insert via API to be implemented
        context.modifiedFiles.add(input.path);
        const output = `Inserted at line ${input.insert_line} in ${input.path}`;
        config.onToolResult?.("str_replace_editor", output, false);
        return { output, isError: false };
      }

      case "undo_edit": {
        // NOTE(#claude-code-undo): Undo tracking to be implemented
        return { output: "Undo not yet implemented", isError: true };
      }

      default:
        return { output: `Unknown command: ${input.command}`, isError: true };
    }
  } catch (error) {
    const output = `Error: ${error instanceof Error ? error.message : String(error)}`;
    config.onToolResult?.("str_replace_editor", output, true);
    return { output, isError: true };
  }
}

/**
 * Execute a tool call
 */
async function executeTool(
  toolCall: ClaudeToolCall,
  context: ClaudeCodeContext,
  config: ClaudeCodeAgentConfig,
): Promise<ClaudeToolResult> {
  let result: { output: string; isError: boolean };

  switch (toolCall.name) {
    case "bash":
      result = await executeBash(toolCall.input as BashToolInput, context, config);
      break;

    case "str_replace_editor":
      result = await executeTextEditor(toolCall.input as TextEditorToolInput, context, config);
      break;

    case "computer":
      // NOTE(#claude-code-computer): Computer use to be implemented
      result = { output: "Computer use not yet implemented", isError: true };
      break;

    default:
      result = { output: `Unknown tool: ${toolCall.name}`, isError: true };
  }

  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: result.output,
    is_error: result.isError,
  };
}

/**
 * Run one iteration of the agentic loop
 */
async function runIteration(
  messages: Array<{ role: string; content: unknown }>,
  tools: AnthropicToolDefinition[],
  context: ClaudeCodeContext,
  config: ClaudeCodeAgentConfig,
): Promise<IterationResult> {
  // Dynamic import to avoid loading Anthropic SDK if not needed
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const response = await client.messages.create({
    model: config.model || DEFAULT_MODEL,
    max_tokens: 16000,
    system: config.system || DEFAULT_SYSTEM,
    tools: tools as any,
    messages: messages as any,
  });

  const toolCalls: ClaudeToolCall[] = [];
  const toolResults: ClaudeToolResult[] = [];
  let text: string | undefined;

  // Process response content
  for (const block of response.content) {
    if (block.type === "text") {
      text = block.text;
    } else if (block.type === "tool_use") {
      const toolCall: ClaudeToolCall = {
        id: block.id,
        type: "tool_use",
        name: block.name,
        input: block.input as Record<string, unknown>,
      };
      toolCalls.push(toolCall);

      // Execute tool
      const result = await executeTool(toolCall, context, config);
      toolResults.push(result);
    }
  }

  const iterationResult: IterationResult = {
    iteration: context.iteration,
    toolCalls,
    toolResults,
    text,
    completed: response.stop_reason === "end_turn" && toolCalls.length === 0,
    stopReason: response.stop_reason || "unknown",
  };

  config.onIteration?.(context.iteration, iterationResult);

  return iterationResult;
}

/**
 * Create a Claude Code agent
 */
export function claudeCodeAgent(config: ClaudeCodeAgentConfig = {}): Agent {
  const id = config.id || "claude-code";
  const mode = config.mode || "code";
  const maxIterations = config.maxIterations || DEFAULT_MAX_ITERATIONS;
  const totalTimeout = config.totalTimeout || DEFAULT_TOTAL_TIMEOUT;

  return {
    id,
    model: config.model || DEFAULT_MODEL,

    generate: async (params): Promise<AgentResponse> => {
      const startTime = Date.now();

      // Get tenant context
      const tenant = getWorkflowTenant();
      if (!tenant) {
        throw new Error(
          "Claude Code agent must run within a workflow step with tenant context. " +
            "Ensure the workflow was started within a request context.",
        );
      }

      // Initialize execution context
      const context: ClaudeCodeContext = {
        projectSlug: tenant.projectSlug,
        projectId: tenant.projectId,
        workingDir: "/",
        modifiedFiles: new Set(),
        executedCommands: [],
        iteration: 0,
        startTime,
      };

      // Get tools for mode
      const tools = getToolsForMode(mode);

      // Build initial messages
      const messages: Array<{ role: string; content: unknown }> = [
        { role: "user", content: params.input },
      ];

      const iterationHistory: IterationResult[] = [];

      try {
        // Agentic loop
        while (context.iteration < maxIterations) {
          // Check total timeout
          if (Date.now() - startTime > totalTimeout) {
            throw new Error(`Total timeout exceeded (${totalTimeout}ms)`);
          }

          context.iteration++;

          if (config.debug) {
            logger.info(`[ClaudeCode] Iteration ${context.iteration}/${maxIterations}`);
          }

          // Run iteration
          const result = await runIteration(messages, tools, context, config);
          iterationHistory.push(result);

          // If completed (no tool calls), we're done
          if (result.completed) {
            const finalResult: ClaudeCodeResult = {
              success: true,
              iterations: context.iteration,
              response: result.text,
              filesModified: [...context.modifiedFiles],
              commandsExecuted: context.executedCommands,
              executionTime: Date.now() - startTime,
              iterationHistory,
            };

            config.onComplete?.(finalResult);

            return {
              text: result.text || JSON.stringify(finalResult),
              status: "completed",
              usage: { inputTokens: 0, outputTokens: 0 }, // NOTE(#claude-code-usage): Token tracking to be added
            };
          }

          // Add assistant response and tool results to messages
          messages.push({
            role: "assistant",
            content: result.toolCalls.map((tc) => ({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })),
          });

          messages.push({
            role: "user",
            content: result.toolResults,
          });
        }

        // Max iterations reached
        const finalResult: ClaudeCodeResult = {
          success: false,
          iterations: context.iteration,
          error: `Max iterations (${maxIterations}) reached`,
          filesModified: [...context.modifiedFiles],
          commandsExecuted: context.executedCommands,
          executionTime: Date.now() - startTime,
          iterationHistory,
        };

        config.onComplete?.(finalResult);

        return {
          text: JSON.stringify(finalResult),
          status: "completed",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      } catch (error) {
        const finalResult: ClaudeCodeResult = {
          success: false,
          iterations: context.iteration,
          error: error instanceof Error ? error.message : String(error),
          filesModified: [...context.modifiedFiles],
          commandsExecuted: context.executedCommands,
          executionTime: Date.now() - startTime,
          iterationHistory,
        };

        config.onComplete?.(finalResult);

        throw error;
      }
    },
  };
}

/**
 * Default Claude Code agent instance
 */
export const defaultClaudeCodeAgent = claudeCodeAgent();
