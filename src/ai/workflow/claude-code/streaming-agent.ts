/**
 * Claude Code Streaming Agent
 *
 * Version of the Claude Code agent that uses Anthropic's streaming API
 * and publishes events in real-time.
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
  ClaudeCodeEvent,
  ClaudeCodeEventPublisher,
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
 * Helper to create and publish events
 */
function createEventPublisher(
  publisher: ClaudeCodeEventPublisher | undefined,
  runId: string | undefined,
) {
  return {
    publish: (event: Omit<ClaudeCodeEvent, "timestamp" | "runId">) => {
      if (!publisher) return;
      publisher.publish({
        ...event,
        timestamp: Date.now(),
        runId,
      } as ClaudeCodeEvent);
    },
  };
}

/**
 * Execute bash tool
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
        const content = await api.files.read(input.path);
        const lines = content.split("\n");

        if (input.view_range) {
          const [start, end] = input.view_range;
          const selectedLines = lines.slice(start - 1, end);
          const output = selectedLines.map((line, i) => `${start + i}: ${line}`).join("\n");
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
        context.modifiedFiles.add(input.path);
        const output = `Created file: ${input.path}`;
        config.onToolResult?.("str_replace_editor", output, false);
        return { output, isError: false };
      }

      case "str_replace": {
        if (!input.old_str || input.new_str === undefined) {
          return { output: "Error: old_str and new_str required", isError: true };
        }

        const content = await api.files.read(input.path);
        if (!content.includes(input.old_str)) {
          const output = `Error: old_str not found in ${input.path}`;
          config.onToolResult?.("str_replace_editor", output, true);
          return { output, isError: true };
        }

        context.modifiedFiles.add(input.path);
        const output = `Replaced in ${input.path}`;
        config.onToolResult?.("str_replace_editor", output, false);
        return { output, isError: false };
      }

      case "insert": {
        if (input.insert_line === undefined || input.new_str === undefined) {
          return { output: "Error: insert_line and new_str required", isError: true };
        }
        context.modifiedFiles.add(input.path);
        const output = `Inserted at line ${input.insert_line} in ${input.path}`;
        config.onToolResult?.("str_replace_editor", output, false);
        return { output, isError: false };
      }

      case "undo_edit": {
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
 * Run one iteration with streaming
 */
async function runStreamingIteration(
  messages: Array<{ role: string; content: unknown }>,
  tools: AnthropicToolDefinition[],
  context: ClaudeCodeContext,
  config: ClaudeCodeAgentConfig,
  events: ReturnType<typeof createEventPublisher>,
): Promise<IterationResult> {
  // Dynamic import to avoid loading Anthropic SDK if not needed
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const toolCalls: ClaudeToolCall[] = [];
  const toolResults: ClaudeToolResult[] = [];
  let fullText = "";
  let currentToolCallId = "";
  let currentToolName = "";
  let currentToolInput = "";

  // Use streaming API
  const stream = client.messages.stream({
    model: config.model || DEFAULT_MODEL,
    max_tokens: 16000,
    system: config.system || DEFAULT_SYSTEM,
    tools: tools as any,
    messages: messages as any,
  });

  // Process stream events
  for await (const event of stream) {
    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type === "text") {
          // Text block starting
        } else if (event.content_block.type === "tool_use") {
          currentToolCallId = event.content_block.id;
          currentToolName = event.content_block.name;
          currentToolInput = "";

          events.publish({
            type: "tool_call_start",
            toolCallId: currentToolCallId,
            toolName: currentToolName,
            iteration: context.iteration,
          });
        }
        break;
      }

      case "content_block_delta": {
        if (event.delta.type === "text_delta") {
          fullText += event.delta.text;

          events.publish({
            type: "text_delta",
            content: event.delta.text,
            iteration: context.iteration,
          });
        } else if (event.delta.type === "input_json_delta") {
          currentToolInput += event.delta.partial_json;

          events.publish({
            type: "tool_call_input",
            toolCallId: currentToolCallId,
            inputDelta: event.delta.partial_json,
            iteration: context.iteration,
          });
        }
        break;
      }

      case "content_block_stop": {
        if (currentToolCallId) {
          // Tool call complete - parse input and execute
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(currentToolInput || "{}");
          } catch {
            // Keep empty object if parse fails
          }

          const toolCall: ClaudeToolCall = {
            id: currentToolCallId,
            type: "tool_use",
            name: currentToolName,
            input,
          };
          toolCalls.push(toolCall);

          events.publish({
            type: "tool_call_complete",
            toolCallId: currentToolCallId,
            toolName: currentToolName,
            input,
            iteration: context.iteration,
          });

          // Execute tool
          const result = await executeTool(toolCall, context, config);
          toolResults.push(result);

          events.publish({
            type: "tool_result",
            toolCallId: currentToolCallId,
            toolName: currentToolName,
            output: typeof result.content === "string"
              ? result.content
              : JSON.stringify(result.content),
            isError: result.is_error || false,
            iteration: context.iteration,
          });

          // Reset for next tool
          currentToolCallId = "";
          currentToolName = "";
          currentToolInput = "";
        }
        break;
      }
    }
  }

  // Get final message for stop reason
  const finalMessage = await stream.finalMessage();

  // Publish text complete if we had text
  if (fullText) {
    events.publish({
      type: "text_complete",
      content: fullText,
      iteration: context.iteration,
    });
  }

  const iterationResult: IterationResult = {
    iteration: context.iteration,
    toolCalls,
    toolResults,
    text: fullText || undefined,
    completed: finalMessage.stop_reason === "end_turn" && toolCalls.length === 0,
    stopReason: finalMessage.stop_reason || "unknown",
  };

  config.onIteration?.(context.iteration, iterationResult);

  events.publish({
    type: "iteration_complete",
    iteration: context.iteration,
    toolCallCount: toolCalls.length,
    hasMoreWork: !iterationResult.completed,
  });

  return iterationResult;
}

/**
 * Create a streaming Claude Code agent
 */
export function streamingClaudeCodeAgent(config: ClaudeCodeAgentConfig = {}): Agent {
  const id = config.id || "claude-code-streaming";
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
          "Claude Code agent must run within a workflow step with tenant context.",
        );
      }

      // Create event publisher helper
      const events = createEventPublisher(
        config.streaming?.publisher,
        config.runId,
      );

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
          if (Date.now() - startTime > totalTimeout) {
            throw new Error(`Total timeout exceeded (${totalTimeout}ms)`);
          }

          context.iteration++;

          events.publish({
            type: "iteration_start",
            iteration: context.iteration,
            maxIterations,
          });

          if (config.debug) {
            logger.info(`[ClaudeCode] Iteration ${context.iteration}/${maxIterations}`);
          }

          // Run streaming iteration
          const result = await runStreamingIteration(messages, tools, context, config, events);
          iterationHistory.push(result);

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

            events.publish({
              type: "complete",
              result: finalResult,
            });

            return {
              text: result.text || JSON.stringify(finalResult),
              status: "completed",
              usage: { inputTokens: 0, outputTokens: 0 },
            };
          }

          // Continue agentic loop - add assistant response and tool results
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

        events.publish({
          type: "complete",
          result: finalResult,
        });

        return {
          text: JSON.stringify(finalResult),
          status: "completed",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        events.publish({
          type: "error",
          message: errorMessage,
          recoverable: false,
        });

        const finalResult: ClaudeCodeResult = {
          success: false,
          iterations: context.iteration,
          error: errorMessage,
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
