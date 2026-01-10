/**
 * Tool Execution Core
 *
 * Unified tool execution logic for both streaming and non-streaming agent loops.
 * Extracts common patterns to reduce duplication.
 */

import type { Message, ToolCall } from "../../types/agent.ts";
import { executeTool } from "../../utils/tool.ts";
import type { Memory } from "../memory.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

/**
 * Provider tool call format
 */
export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string | Record<string, unknown>;
}

/**
 * Result of tool execution
 */
export interface ToolExecutionResult {
  toolCall: ToolCall;
  message: Message;
  success: boolean;
}

/**
 * Context for tool execution
 */
export interface ToolExecutionContext {
  agentId: string;
  memory: Memory;
}

/**
 * Optional streaming callbacks
 */
export interface StreamingCallbacks {
  /** Called when tool execution starts */
  onToolCallStart?: (toolCall: ToolCall) => void;
  /** Called when tool execution completes */
  onToolCallComplete?: (toolCall: ToolCall, result: unknown) => void;
  /** Called when tool execution fails */
  onToolCallError?: (toolCall: ToolCall, error: string) => void;
}

/**
 * Unified tool execution core.
 *
 * Handles the common logic of:
 * - Parsing tool call arguments
 * - Executing tools
 * - Creating result/error messages
 * - Tracking execution time
 * - Managing tool call status
 */
export class ToolExecutionCore {
  private context: ToolExecutionContext;

  constructor(context: ToolExecutionContext) {
    this.context = context;
  }

  /**
   * Execute a single tool call and return the result.
   *
   * @param tc - The provider tool call to execute
   * @param callbacks - Optional streaming callbacks
   * @returns Tool execution result with message
   */
  async execute(
    tc: ProviderToolCall,
    callbacks?: StreamingCallbacks,
  ): Promise<ToolExecutionResult> {
    const toolCall: ToolCall = {
      id: tc.id,
      name: tc.name,
      args: {},
      status: "pending",
    };

    try {
      toolCall.args = this.parseArguments(tc.arguments);

      toolCall.status = "executing";
      const startTime = Date.now();

      // Notify start callback
      callbacks?.onToolCallStart?.(toolCall);

      // Execute the tool
      const result = await executeTool(tc.name, toolCall.args, {
        agentId: this.context.agentId,
      });

      // Update status
      toolCall.status = "completed";
      toolCall.result = result;
      toolCall.executionTime = Date.now() - startTime;

      // Notify complete callback
      callbacks?.onToolCallComplete?.(toolCall, result);

      // Create success message
      const message = this.createSuccessMessage(tc.id, result, toolCall);

      // Add to memory
      await this.context.memory.add(message);

      return {
        toolCall,
        message,
        success: true,
      };
    } catch (error) {
      const errorStr = error instanceof Error ? error.message : String(error);
      toolCall.status = "error";
      toolCall.error = errorStr;
      callbacks?.onToolCallError?.(toolCall, errorStr);

      const message = this.createErrorMessage(tc.id, errorStr, toolCall);
      await this.context.memory.add(message);

      return { toolCall, message, success: false };
    }
  }

  /**
   * Parse provider tool arguments and ensure we always return an object.
   * Throws an error if the payload is missing or malformed to be handled upstream.
   */
  private parseArguments(raw: ProviderToolCall["arguments"]): Record<string, unknown> {
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      throw toError(createError({
        type: "agent",
        message: "Tool call arguments must be a JSON object",
      }));
    }

    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }

    throw toError(createError({
      type: "agent",
      message: "Tool call arguments must be a JSON object",
    }));
  }

  /**
   * Execute multiple tool calls in sequence.
   *
   * @param toolCalls - Array of provider tool calls
   * @param callbacks - Optional streaming callbacks
   * @returns Array of execution results
   */
  async executeAll(
    toolCalls: ProviderToolCall[],
    callbacks?: StreamingCallbacks,
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    for (const tc of toolCalls) {
      results.push(await this.execute(tc, callbacks));
    }
    return results;
  }

  /**
   * Create a success message for a tool result.
   */
  private createSuccessMessage(toolCallId: string, result: unknown, toolCall: ToolCall): Message {
    return {
      id: `tool_${toolCallId}`,
      role: "tool",
      parts: [{ type: "tool-result", toolCallId, toolName: toolCall.name, result }],
      timestamp: Date.now(),
    };
  }

  /**
   * Create an error message for a failed tool call.
   */
  private createErrorMessage(toolCallId: string, error: string, toolCall: ToolCall): Message {
    return {
      id: `tool_error_${toolCallId}`,
      role: "tool",
      parts: [{ type: "tool-result", toolCallId, toolName: toolCall.name, result: { error } }],
      timestamp: Date.now(),
    };
  }
}

/**
 * Create a tool execution core instance.
 */
export function createToolExecutionCore(context: ToolExecutionContext): ToolExecutionCore {
  return new ToolExecutionCore(context);
}
