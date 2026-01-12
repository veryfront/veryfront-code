/**
 * Agent Runtime - Core execution engine
 *
 * Handles agent execution with:
 * - Multi-step reasoning (agent loop)
 * - Tool calling and execution
 * - Streaming responses
 * - Memory management
 * - Middleware execution
 *
 * @module ai/agent/runtime
 */

import {
  type AgentConfig,
  type AgentContext,
  type AgentResponse,
  type AgentStatus,
  getTextFromParts,
  type Message,
  type MessagePart,
  type ToolCall,
} from "../../types/agent.ts";
import type { Provider } from "../../types/provider.ts";
import { getProviderFromModel } from "../../providers/factory.ts";
import { executeTool, generateId } from "../../utils/index.ts";
import { detectPlatform, getPlatformCapabilities } from "../../runtime/platform.ts";
import { createMemory, type Memory } from "../memory.ts";
import { serverLogger as logger } from "@veryfront/utils";
import {
  addSpanEvent,
  setSpanAttributes,
  withSpan,
} from "@veryfront/observability/tracing/index.ts";
import { convertMessageToProvider } from "../message-converter.ts";
import { MiddlewareChain } from "../execution/middleware-chain.ts";

// Re-export from submodules
export { generateMessageId, sendSSE } from "./sse-utils.ts";
export { getAvailableTools, isDynamicTool, parseToolArgs } from "./tool-helpers.ts";
export type { ParsedToolArgs, ToolConfigEntry } from "./tool-helpers.ts";
export { accumulateUsage, getMaxSteps, normalizeInput } from "./input-utils.ts";
export { createStreamState, handleStreamEvent, processStreamData } from "./stream-handler.ts";
export type { StreamCallbacks, StreamingToolCall, StreamState } from "./stream-handler.ts";
export {
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  MAX_STREAM_BUFFER_SIZE,
} from "./constants.ts";

// Import helpers
import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from "./constants.ts";
import { generateMessageId, sendSSE } from "./sse-utils.ts";
import { getAvailableTools, isDynamicTool, parseToolArgs } from "./tool-helpers.ts";
import { accumulateUsage, getMaxSteps, normalizeInput } from "./input-utils.ts";
import { createStreamState, processStreamData } from "./stream-handler.ts";

export class AgentRuntime {
  private id: string;
  private config: AgentConfig;
  private memory: Memory;
  private status: AgentStatus = "idle";

  constructor(id: string, config: AgentConfig) {
    this.id = id;
    this.config = config;

    const memoryConfig = config.memory || { type: "conversation", maxTokens: 4000 };
    this.memory = createMemory(memoryConfig);
  }

  /**
   * Generate a response (non-streaming)
   */
  async generate(
    input: string | Message[],
    context?: Record<string, unknown>,
  ): Promise<AgentResponse> {
    return await withSpan("agent.generate", async (span) => {
      setSpanAttributes(span, {
        "agent.id": this.id,
        "agent.model": this.config.model,
      });

      const inputMessages = normalizeInput(input);

      for (const msg of inputMessages) {
        await this.memory.add(msg);
      }

      const messages = await this.memory.getMessages();
      const systemPrompt = await this.resolveSystemPrompt();
      const { provider, model } = getProviderFromModel(this.config.model);

      const agentContext: AgentContext = {
        agentId: this.id,
        model: this.config.model,
        input: inputMessages,
        data: context,
        platform: detectPlatform(),
      };

      const chain = new MiddlewareChain(this.config.middleware);
      return await chain.execute(
        agentContext,
        () => this.executeAgentLoop(provider, model, systemPrompt, messages),
      );
    });
  }

  /**
   * Stream a response
   * Returns a ReadableStream compatible with Vercel AI SDK Data Stream Protocol
   */
  async stream(
    messages: Message[],
    context?: Record<string, unknown>,
    callbacks?: {
      onToolCall?: (toolCall: ToolCall) => void;
      onChunk?: (chunk: string) => void;
    },
  ): Promise<ReadableStream> {
    for (const msg of messages) {
      await this.memory.add(msg);
    }

    const memoryMessages = await this.memory.getMessages();
    const systemPrompt = await this.resolveSystemPrompt();
    const { provider, model } = getProviderFromModel(this.config.model);

    const encoder = new TextEncoder();

    // Build tool execution context - merge user context with agent context
    const toolContext = {
      agentId: this.id,
      ...context,
    };

    // Generate a unique text part ID for UI message stream
    const textPartId = generateId("text");

    return new ReadableStream({
      start: async (controller) => {
        try {
          this.status = "streaming";

          // Send start event (UI Message Stream Protocol v5)
          const messageId = generateMessageId();
          sendSSE(controller, encoder, { type: "start", messageId });

          // Send text-start event with ID
          sendSSE(controller, encoder, { type: "text-start", id: textPartId });

          await this.executeAgentLoopStreaming(
            provider,
            model,
            systemPrompt,
            memoryMessages,
            controller,
            encoder,
            callbacks,
            textPartId,
            toolContext,
          );

          // Send text-end event (UI Message Stream Protocol v5)
          sendSSE(controller, encoder, { type: "text-end", id: textPartId });

          // Send finish event (UI Message Stream Protocol v5)
          sendSSE(controller, encoder, { type: "finish" });

          controller.close();
        } catch (error) {
          this.status = "error";

          sendSSE(controller, encoder, {
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });

          controller.close();
        }
      },
    });
  }

  /**
   * Execute agent loop (with tool calling)
   */
  private async executeAgentLoop(
    provider: Provider,
    model: string,
    systemPrompt: string,
    messages: Message[],
  ): Promise<AgentResponse> {
    return await withSpan("agent.execution_loop", async (loopSpan) => {
      const capabilities = getPlatformCapabilities();
      const maxSteps = this.computeMaxSteps(capabilities.maxAgentSteps);

      const toolCalls: ToolCall[] = [];
      const currentMessages = [...messages];
      const totalUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      for (let step = 0; step < maxSteps; step++) {
        this.status = "thinking";
        addSpanEvent(loopSpan, "step_start", { step });

        const tools = getAvailableTools(this.config.tools);

        const response = await withSpan("agent.provider_complete", async (span) => {
          setSpanAttributes(span, {
            model,
            "messages.count": currentMessages.length,
          });
          return await provider.complete({
            model,
            system: systemPrompt,
            messages: currentMessages.map((m) => convertMessageToProvider(m)),
            tools: tools.length > 0 ? tools : undefined,
            maxTokens: this.config.memory?.maxTokens || DEFAULT_MAX_TOKENS,
            temperature: DEFAULT_TEMPERATURE,
          });
        });

        accumulateUsage(totalUsage, response.usage);

        // Build parts array for v5 Message
        const assistantParts: MessagePart[] = [];
        if (response.text) {
          assistantParts.push({ type: "text", text: response.text });
        }
        if (response.toolCalls) {
          for (const tc of response.toolCalls) {
            // Use AI SDK v5 tool-${toolName} pattern
            assistantParts.push({
              type: `tool-${tc.name}`,
              toolCallId: tc.id,
              toolName: tc.name,
              args: tc.arguments,
            });
          }
        }

        const assistantMessage: Message = {
          id: `msg_${Date.now()}_${step}`,
          role: "assistant",
          parts: assistantParts,
          timestamp: Date.now(),
        };
        currentMessages.push(assistantMessage);
        await this.memory.add(assistantMessage);

        if (response.toolCalls && response.toolCalls.length > 0) {
          this.status = "tool_execution";
          addSpanEvent(loopSpan, "tool_execution_start", {
            count: response.toolCalls.length,
          });

          for (const tc of response.toolCalls) {
            const toolCall: ToolCall = {
              id: tc.id,
              name: tc.name,
              args: tc.arguments,
              status: "pending",
            };

            await withSpan("agent.tool_execute", async (toolSpan) => {
              setSpanAttributes(toolSpan, {
                "tool.name": tc.name,
                "tool.id": tc.id,
              });

              try {
                toolCall.status = "executing";
                const startTime = Date.now();

                const result = await executeTool(tc.name, tc.arguments, {
                  agentId: this.id,
                });

                toolCall.status = "completed";
                toolCall.result = result;
                toolCall.executionTime = Date.now() - startTime;

                const toolResultMessage: Message = {
                  id: `tool_${tc.id}`,
                  role: "tool",
                  parts: [{
                    type: "tool-result",
                    toolCallId: tc.id,
                    toolName: tc.name,
                    result,
                  }],
                  timestamp: Date.now(),
                };
                currentMessages.push(toolResultMessage);
                await this.memory.add(toolResultMessage);
              } catch (error) {
                toolCall.status = "error";
                toolCall.error = error instanceof Error ? error.message : String(error);
                setSpanAttributes(toolSpan, { "error": true, "error.message": toolCall.error });

                const errorMessage: Message = {
                  id: `tool_error_${tc.id}`,
                  role: "tool",
                  parts: [{
                    type: "tool-result",
                    toolCallId: tc.id,
                    toolName: tc.name,
                    result: { error: toolCall.error },
                  }],
                  timestamp: Date.now(),
                };
                currentMessages.push(errorMessage);
                await this.memory.add(errorMessage);
              }

              toolCalls.push(toolCall);
            });
          }

          continue;
        }

        this.status = "completed";
        addSpanEvent(loopSpan, "loop_complete");

        return {
          text: response.text,
          messages: currentMessages,
          toolCalls,
          status: this.status,
          usage: totalUsage,
        };
      }

      this.status = "completed";
      addSpanEvent(loopSpan, "max_steps_reached", { maxSteps });

      const lastMsg = currentMessages[currentMessages.length - 1];
      return {
        text: lastMsg ? getTextFromParts(lastMsg.parts) : "",
        messages: currentMessages,
        toolCalls,
        status: this.status,
        usage: totalUsage,
        metadata: {
          warning: `Max steps (${maxSteps}) reached`,
        },
      };
    });
  }

  /**
   * Execute agent loop with streaming
   * Uses Vercel AI SDK UI Message Stream Protocol v5 format
   */
  private async executeAgentLoopStreaming(
    provider: Provider,
    model: string,
    systemPrompt: string,
    messages: Message[],
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    callbacks?: {
      onToolCall?: (toolCall: ToolCall) => void;
      onChunk?: (chunk: string) => void;
    },
    textPartId?: string,
    toolContext?: Record<string, unknown>,
  ): Promise<AgentResponse> {
    const capabilities = getPlatformCapabilities();
    const maxSteps = this.computeMaxSteps(capabilities.maxAgentSteps);

    const toolCalls: ToolCall[] = [];
    const currentMessages = [...messages];
    const totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    for (let step = 0; step < maxSteps; step++) {
      // Send start-step event (Veryfront extension, not part of standard AI SDK v5 protocol)
      sendSSE(controller, encoder, { type: "start-step" });

      const tools = getAvailableTools(this.config.tools);

      const stream = await provider.stream({
        model,
        system: systemPrompt,
        messages: currentMessages.map((m) => convertMessageToProvider(m)),
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: this.config.memory?.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
      });

      // Create stream state and process the stream
      const state = createStreamState();
      await processStreamData(
        stream,
        state,
        controller,
        encoder,
        textPartId,
        {
          onChunk: callbacks?.onChunk,
          onUsage: (usage) => accumulateUsage(totalUsage, usage),
        },
      );

      // Build v5 parts array from accumulated state
      const streamParts: MessagePart[] = [];
      if (state.accumulatedText) {
        streamParts.push({ type: "text", text: state.accumulatedText });
      }
      if (state.toolCalls.size > 0) {
        for (const tc of state.toolCalls.values()) {
          const { args, error } = parseToolArgs(tc.arguments);
          if (error) {
            logger.warn("[AGENT] Failed to parse streamed tool arguments", {
              toolCallId: tc.id,
              error,
            });
          }
          // Use AI SDK v5 tool-${toolName} pattern
          streamParts.push({
            type: `tool-${tc.name}`,
            toolCallId: tc.id,
            toolName: tc.name,
            args,
          });
        }
      }

      const assistantMessage: Message = {
        id: `msg_${Date.now()}_${step}`,
        role: "assistant",
        parts: streamParts,
        timestamp: Date.now(),
      };

      currentMessages.push(assistantMessage);
      await this.memory.add(assistantMessage);

      if (state.finishReason === "tool_calls" && state.toolCalls.size > 0) {
        this.status = "tool_execution";

        for (const tc of state.toolCalls.values()) {
          const { args, error: argError } = parseToolArgs(tc.arguments);
          const toolCall: ToolCall = {
            id: tc.id,
            name: tc.name,
            args,
            status: "pending",
          };

          if (argError) {
            logger.warn("[AGENT] Invalid streamed tool arguments", {
              toolCallId: tc.id,
              error: argError,
            });
            // Send tool-input-error event (AI SDK v5 UI Message Stream Protocol)
            const dynamic = isDynamicTool(tc.name);
            sendSSE(controller, encoder, {
              type: "tool-input-error",
              toolCallId: tc.id,
              errorText: `Invalid tool arguments: ${argError}`,
              ...(dynamic && { dynamic: true }),
            });
            await this.recordToolError(
              toolCall,
              `Invalid tool arguments: ${argError}`,
              controller,
              encoder,
              currentMessages,
              toolCalls,
            );
            continue;
          }

          try {
            toolCall.status = "executing";
            const startTime = Date.now();

            if (callbacks?.onToolCall) {
              callbacks.onToolCall(toolCall);
            }

            // Note: tool-input-available was already sent during streaming
            // Proceed directly to tool execution

            const result = await executeTool(tc.name, toolCall.args, {
              agentId: this.id,
              ...toolContext,
            });

            toolCall.status = "completed";
            toolCall.result = result;
            toolCall.executionTime = Date.now() - startTime;
            toolCalls.push(toolCall);

            // Send tool-output-available event (AI SDK v5 UI Message Stream Protocol)
            const dynamic = isDynamicTool(tc.name);
            sendSSE(controller, encoder, {
              type: "tool-output-available",
              toolCallId: toolCall.id,
              output: result,
              ...(dynamic && { dynamic: true }),
            });

            const toolResultMessage: Message = {
              id: `tool_${tc.id}`,
              role: "tool",
              parts: [{
                type: "tool-result",
                toolCallId: tc.id,
                toolName: tc.name,
                result,
              }],
              timestamp: Date.now(),
            };
            currentMessages.push(toolResultMessage);
            await this.memory.add(toolResultMessage);
          } catch (error) {
            const errorStr = error instanceof Error ? error.message : String(error);
            await this.recordToolError(
              toolCall,
              errorStr,
              controller,
              encoder,
              currentMessages,
              toolCalls,
            );
          }
        }

        // Send finish-step event (Veryfront extension, not part of standard AI SDK v5 protocol)
        sendSSE(controller, encoder, { type: "finish-step" });

        this.status = "thinking";
        continue;
      }

      // Send finish-step event (Veryfront extension, not part of standard AI SDK v5 protocol)
      sendSSE(controller, encoder, { type: "finish-step" });

      break;
    }

    const lastMessage = currentMessages[currentMessages.length - 1];
    return {
      text: lastMessage ? getTextFromParts(lastMessage.parts) : "",
      messages: currentMessages,
      toolCalls,
      status: "completed",
      usage: totalUsage,
    };
  }

  /**
   * Record a tool error and send SSE event.
   */
  private async recordToolError(
    toolCall: ToolCall,
    errorStr: string,
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    currentMessages: Message[],
    toolCalls: ToolCall[],
  ): Promise<void> {
    toolCall.status = "error";
    toolCall.error = errorStr;
    toolCalls.push(toolCall);

    // Send tool-output-error event (AI SDK v5 UI Message Stream Protocol)
    const dynamic = isDynamicTool(toolCall.name);
    sendSSE(controller, encoder, {
      type: "tool-output-error",
      toolCallId: toolCall.id,
      errorText: errorStr,
      ...(dynamic && { dynamic: true }),
    });

    const errorMessage: Message = {
      id: `tool_error_${toolCall.id}`,
      role: "tool",
      parts: [{
        type: "tool-result",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: { error: errorStr },
      }],
      timestamp: Date.now(),
    };
    currentMessages.push(errorMessage);
    await this.memory.add(errorMessage);
  }

  /**
   * Resolve system prompt (handle string or function)
   */
  private async resolveSystemPrompt(): Promise<string> {
    const { system } = this.config;
    if (typeof system === "string") return system;
    if (typeof system === "function") return await system();
    return "You are a helpful AI assistant.";
  }

  /**
   * Compute max steps considering edge config and platform limits.
   */
  private computeMaxSteps(platformLimit: number): number {
    const edgeMaxSteps = this.config.edge?.enabled ? this.config.edge.maxSteps : undefined;
    return getMaxSteps(this.config.maxSteps, edgeMaxSteps, platformLimit);
  }

  /**
   * Get memory instance (for advanced use cases)
   */
  getMemory(): Memory {
    return this.memory;
  }

  /**
   * Get memory stats
   */
  async getMemoryStats() {
    return await this.memory.getStats();
  }

  /**
   * Clear agent memory
   */
  async clearMemory(): Promise<void> {
    await this.memory.clear();
  }
}
