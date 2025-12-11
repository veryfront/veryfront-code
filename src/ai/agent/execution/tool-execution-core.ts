
import type { Message, ToolCall } from "../../types/agent.ts";
import { executeTool } from "../../utils/tool.ts";
import type { Memory } from "../memory.ts";

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string | Record<string, unknown>;
}

export interface ToolExecutionResult {
  toolCall: ToolCall;
  message: Message;
  success: boolean;
}

export interface ToolExecutionContext {
  agentId: string;
  memory: Memory;
}

export interface StreamingCallbacks {
  onToolCallStart?: (toolCall: ToolCall) => void;
  onToolCallComplete?: (toolCall: ToolCall, result: unknown) => void;
  onToolCallError?: (toolCall: ToolCall, error: string) => void;
}

export class ToolExecutionCore {
  private context: ToolExecutionContext;

  constructor(context: ToolExecutionContext) {
    this.context = context;
  }

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

      callbacks?.onToolCallStart?.(toolCall);

      const result = await executeTool(tc.name, toolCall.args, {
        agentId: this.context.agentId,
      });

      toolCall.status = "completed";
      toolCall.result = result;
      toolCall.executionTime = Date.now() - startTime;

      callbacks?.onToolCallComplete?.(toolCall, result);

      const message = this.createSuccessMessage(tc.id, result, toolCall);

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

      return {
        toolCall,
        message,
        success: false,
      };
    }
  }

  private parseArguments(raw: ProviderToolCall["arguments"]): Record<string, unknown> {
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      throw new Error("Tool call arguments must be a JSON object");
    }

    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }

    throw new Error("Tool call arguments must be a JSON object");
  }

  async executeAll(
    toolCalls: ProviderToolCall[],
    callbacks?: StreamingCallbacks,
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const tc of toolCalls) {
      const result = await this.execute(tc, callbacks);
      results.push(result);
    }

    return results;
  }

  private createSuccessMessage(toolCallId: string, result: unknown, toolCall: ToolCall): Message {
    return {
      id: `tool_${toolCallId}`,
      role: "tool",
      content: JSON.stringify(result),
      toolCallId,
      toolCall,
      timestamp: Date.now(),
    };
  }

  private createErrorMessage(toolCallId: string, error: string, toolCall: ToolCall): Message {
    return {
      id: `tool_error_${toolCallId}`,
      role: "tool",
      content: `Error: ${error}`,
      toolCallId,
      toolCall,
      timestamp: Date.now(),
    };
  }
}

export function createToolExecutionCore(context: ToolExecutionContext): ToolExecutionCore {
  return new ToolExecutionCore(context);
}
