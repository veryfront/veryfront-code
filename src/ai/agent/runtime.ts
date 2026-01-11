/**
 * Agent Runtime - Core execution engine
 *
 * Handles agent execution with:
 * - Multi-step reasoning (agent loop)
 * - Tool calling and execution
 * - Streaming responses
 * - Memory management
 * - Middleware execution
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
} from "../types/agent.ts";
import type { ToolDefinition } from "../types/tool.ts";
import type { Provider } from "../types/provider.ts";
import { getProviderFromModel } from "../providers/factory.ts";
import { executeTool, generateId, toolRegistry, toolToProviderDefinition } from "../utils/index.ts";
import { detectPlatform, getPlatformCapabilities } from "../runtime/platform.ts";
import { createMemory, type Memory } from "./memory.ts";
import { serverLogger as logger } from "@veryfront/utils";
import {
  addSpanEvent,
  setSpanAttributes,
  withSpan,
} from "@veryfront/observability/tracing/index.ts";
import { AGENT_DEFAULTS, STREAMING_DEFAULTS } from "../config/defaults.ts";
import { type AgentStreamEvent, AgentStreamEventSchema } from "./streaming/index.ts";
import { convertMessageToProvider } from "./message-converter.ts";
import { MiddlewareChain } from "./execution/middleware-chain.ts";

// Use centralized defaults from config
const DEFAULT_MAX_TOKENS = AGENT_DEFAULTS.maxTokens;
const DEFAULT_TEMPERATURE = AGENT_DEFAULTS.temperature;
const MAX_STREAM_BUFFER_SIZE = STREAMING_DEFAULTS.maxBufferSize;

/**
 * Encode and enqueue a Server-Sent Event (SSE) to the stream controller.
 * Formats event as: data: {json}\n\n
 */
function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: Record<string, unknown>,
): void {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

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

      const inputMessages = this.normalizeInput(input);

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
          const messageId = `msg-${Date.now().toString(36)}-${
            Math.random().toString(36).slice(2, 8)
          }`;
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
      const maxSteps = this.getMaxSteps(capabilities.maxAgentSteps);

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

        const tools = this.getAvailableTools();

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

        this.accumulateUsage(totalUsage, response.usage);

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
    const maxSteps = this.getMaxSteps(capabilities.maxAgentSteps);

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

      const tools = this.getAvailableTools();

      const stream = await provider.stream({
        model,
        system: systemPrompt,
        messages: currentMessages.map((m) => convertMessageToProvider(m)),
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: this.config.memory?.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
      });

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = "";
      let finishReason: string | null = null;

      const streamToolCalls = new Map<string, {
        id: string;
        name: string;
        arguments: string;
      }>();

      const parseStreamToolArgs = (
        rawArgs: string | Record<string, unknown>,
      ): { args: Record<string, unknown>; error?: string } => {
        try {
          const parsed = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return { args: parsed as Record<string, unknown> };
          }
          return { args: {}, error: "Tool call arguments must be a JSON object" };
        } catch (error) {
          return {
            args: {},
            error: error instanceof Error ? error.message : String(error),
          };
        }
      };

      /** Check if a tool is dynamic (for SSE event formatting) */
      const isDynamicTool = (name: string): boolean => toolRegistry.get(name)?.type === "dynamic";

      const recordToolError = async (toolCall: ToolCall, errorStr: string) => {
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
      };

      // Vercel AI SDK Data Stream Protocol event handler
      const handleEvent = (event: AgentStreamEvent) => {
        switch (event.type) {
          case "content": {
            accumulatedText += event.content;

            // Use Vercel AI SDK UI Message Stream Protocol v5 format
            sendSSE(controller, encoder, {
              type: "text-delta",
              id: textPartId,
              delta: event.content,
            });

            if (callbacks?.onChunk) {
              callbacks.onChunk(event.content);
            }
            break;
          }

          case "tool_call_start":
            if (event.toolCall?.id) {
              streamToolCalls.set(event.toolCall.id, {
                id: event.toolCall.id,
                name: event.toolCall.name,
                arguments: "",
              });

              // Send tool-input-start event (AI SDK v5 UI Message Stream Protocol)
              const dynamic = isDynamicTool(event.toolCall.name);
              sendSSE(controller, encoder, {
                type: "tool-input-start",
                toolCallId: event.toolCall.id,
                toolName: event.toolCall.name,
                ...(dynamic && { dynamic: true }),
              });
            }
            break;

          case "tool_call_delta":
            if (event.id && streamToolCalls.has(event.id)) {
              const tc = streamToolCalls.get(event.id)!;
              tc.arguments += event.arguments;

              // Send tool-input-delta event (AI SDK v5 UI Message Stream Protocol)
              sendSSE(controller, encoder, {
                type: "tool-input-delta",
                toolCallId: event.id,
                inputTextDelta: event.arguments,
              });
            }
            break;

          case "tool_call_complete":
            if (event.toolCall?.id) {
              streamToolCalls.set(event.toolCall.id, {
                id: event.toolCall.id,
                name: event.toolCall.name,
                arguments: event.toolCall.arguments,
              });

              // Send tool-input-available event (AI SDK v5 UI Message Stream Protocol)
              const dynamic = isDynamicTool(event.toolCall.name);
              const { args } = parseStreamToolArgs(event.toolCall.arguments);
              sendSSE(controller, encoder, {
                type: "tool-input-available",
                toolCallId: event.toolCall.id,
                toolName: event.toolCall.name,
                input: args,
                ...(dynamic && { dynamic: true }),
              });
            }
            break;

          case "finish":
            finishReason = event.finishReason;
            break;

          case "usage":
            if (event.usage) {
              this.accumulateUsage(totalUsage, event.usage);
            }
            break;
        }
      };

      let partial = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        partial += decoder.decode(value, { stream: true });

        // Prevent unbounded buffer growth
        if (partial.length > MAX_STREAM_BUFFER_SIZE) {
          logger.warn("[AGENT] Stream buffer exceeded max size, truncating");
          partial = partial.slice(-MAX_STREAM_BUFFER_SIZE / 2);
        }

        const segments = partial.split("\n");
        partial = segments.pop() ?? "";
        const lines = segments.filter((line) => line.trim());

        for (const line of lines) {
          try {
            const rawEvent = JSON.parse(line);
            const parseResult = AgentStreamEventSchema.safeParse(rawEvent);

            if (parseResult.success) {
              handleEvent(parseResult.data);
            } else {
              logger.warn("[AGENT] Invalid stream event received:", parseResult.error);
            }
          } catch (e) {
            logger.warn("[AGENT] Failed to parse stream line:", e);
            continue;
          }
        }
      }

      if (partial.trim()) {
        try {
          const rawEvent = JSON.parse(partial);
          const parseResult = AgentStreamEventSchema.safeParse(rawEvent);
          if (parseResult.success) {
            handleEvent(parseResult.data);
          }
        } catch {
          // Ignore trailing partial
        }
      }

      // Build v5 parts array
      const streamParts: MessagePart[] = [];
      if (accumulatedText) {
        streamParts.push({ type: "text", text: accumulatedText });
      }
      if (streamToolCalls.size > 0) {
        for (const tc of streamToolCalls.values()) {
          const { args, error } = parseStreamToolArgs(tc.arguments);
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

      if (finishReason === "tool_calls" && streamToolCalls.size > 0) {
        this.status = "tool_execution";

        for (const tc of streamToolCalls.values()) {
          const { args, error: argError } = parseStreamToolArgs(tc.arguments);
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
            await recordToolError(toolCall, `Invalid tool arguments: ${argError}`);
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
            await recordToolError(toolCall, errorStr);
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

  private getAvailableTools(): ToolDefinition[] {
    if (!this.config.tools) return [];

    // When tools === true, load ALL tools from the registry
    if (this.config.tools === true) {
      const allTools = toolRegistry.getAll();
      logger.debug(`[AGENT] Loading all ${allTools.size} tools from registry`);
      return Array.from(allTools, ([name, tool]) => {
        const def = toolToProviderDefinition(tool);
        logger.debug(`[AGENT] Tool definition for "${name}":`, JSON.stringify(def, null, 2));
        return def;
      });
    }

    // Load specific tools from config
    const tools: ToolDefinition[] = [];
    for (const [name, entry] of Object.entries(this.config.tools)) {
      if (entry === true) {
        const tool = toolRegistry.get(name);
        if (!tool) continue;
        const def = toolToProviderDefinition(tool);
        logger.debug(`[AGENT] Tool definition for "${name}":`, JSON.stringify(def, null, 2));
        tools.push(def);
      } else if (entry && typeof entry === "object") {
        const inlineTool = entry.id === name ? entry : { ...entry, id: name };
        const def = toolToProviderDefinition(inlineTool);
        logger.debug(`[AGENT] Tool definition for "${name}":`, JSON.stringify(def, null, 2));
        tools.push(def);
      }
    }
    return tools;
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
   * Normalize input to messages array (v5 format with parts)
   */
  private normalizeInput(input: string | Message[]): Message[] {
    if (typeof input === "string") {
      return [
        {
          id: `msg_${Date.now()}`,
          role: "user",
          parts: [{ type: "text", text: input }],
          timestamp: Date.now(),
        },
      ];
    }

    return input.map((msg) => ({
      ...msg,
      id: msg.id || `msg_${Date.now()}`,
      timestamp: msg.timestamp || Date.now(),
    }));
  }

  /**
   * Accumulate usage statistics from a response into the total.
   */
  private accumulateUsage(
    total: { promptTokens: number; completionTokens: number; totalTokens: number },
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
  ): void {
    total.promptTokens += usage.promptTokens ?? 0;
    total.completionTokens += usage.completionTokens ?? 0;
    total.totalTokens += usage.totalTokens ?? 0;
  }

  /**
   * Get max steps considering edge config and platform limits.
   * Priority: edge config > agent config > default (20).
   */
  private getMaxSteps(platformLimit: number): number {
    const edgeMaxSteps = this.config.edge?.enabled ? this.config.edge.maxSteps : undefined;
    const configuredMaxSteps = edgeMaxSteps ?? this.config.maxSteps ?? 20;
    return Math.min(configuredMaxSteps, platformLimit);
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
