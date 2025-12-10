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

import type {
  AgentConfig,
  AgentContext,
  AgentResponse,
  AgentStatus,
  Message,
  StreamToolCall,
  ToolCall,
} from "../types/agent.ts";
import type { ToolDefinition } from "../types/tool.ts";
import type { Provider } from "../types/provider.ts";
import { getProviderFromModel } from "../providers/factory.ts";
import { executeTool, toolRegistry, toolToProviderDefinition } from "../utils/tool.ts";
import { detectPlatform, getPlatformCapabilities } from "../runtime/platform.ts";
import { createMemory, type Memory } from "./memory.ts";
import { serverLogger as logger } from "@veryfront/utils";
import { addSpanEvent, setSpanAttributes, withSpan } from "../../observability/tracing/index.ts";
import { z } from "zod";

const AgentStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("content"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_start"),
    toolCall: z.object({
      id: z.string(),
      name: z.string(),
    }),
  }),
  z.object({
    type: z.literal("tool_call_delta"),
    id: z.string(),
    arguments: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_complete"),
    toolCall: z.object({
      id: z.string(),
      name: z.string(),
      arguments: z.string(),
    }),
  }),
  z.object({
    type: z.literal("finish"),
    finishReason: z.string().nullable(),
  }),
  z.object({
    type: z.literal("usage"),
    usage: z.object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    }),
  }),
]);

type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

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

      if (this.config.middleware && this.config.middleware.length > 0) {
        return await this.executeMiddleware(agentContext, async () => {
          return await this.executeAgentLoop(
            provider,
            model,
            systemPrompt,
            messages,
          );
        });
      }

      return await this.executeAgentLoop(
        provider,
        model,
        systemPrompt,
        messages,
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
    // Use prefix + 12 chars from UUID (matches AI SDK generateId pattern)
    const messageId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

    // Build tool execution context - merge user context with agent context
    const toolContext = {
      agentId: this.id,
      ...context,
    };

    // Generate a unique text part ID for UI message stream
    const textPartId = `text_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

    return new ReadableStream({
      start: async (controller) => {
        try {
          this.status = "streaming";

          // Send start event (UI Message Stream Protocol v5)
          const startEvent = JSON.stringify({ type: "start" });
          controller.enqueue(encoder.encode(`data: ${startEvent}\n\n`));

          // Send text-start event with ID
          const textStartEvent = JSON.stringify({
            type: "text-start",
            id: textPartId,
          });
          controller.enqueue(encoder.encode(`data: ${textStartEvent}\n\n`));

          const response = await this.executeAgentLoopStreaming(
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
          const textEndEvent = JSON.stringify({
            type: "text-end",
            id: textPartId,
          });
          controller.enqueue(encoder.encode(`data: ${textEndEvent}\n\n`));

          // Send finish event (UI Message Stream Protocol v5)
          const finishEvent = JSON.stringify({ type: "finish" });
          controller.enqueue(encoder.encode(`data: ${finishEvent}\n\n`));

          controller.close();
        } catch (error) {
          this.status = "error";

          const errorEvent = JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
          controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));

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
            messages: currentMessages.map((m) => {
              const msg: {
                role: string;
                content: string;
                tool_calls?: Array<{
                  id: string;
                  type?: string;
                  function: {
                    name: string;
                    arguments: string;
                  };
                }>;
                tool_call_id?: string;
              } = {
                role: m.role,
                content: m.content,
              };

              // Include tool_calls for assistant messages
              if (m.role === "assistant" && m.toolCalls) {
                msg.tool_calls = m.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.arguments),
                  },
                }));
              }

              // Include tool_call_id for tool result messages
              if (m.role === "tool" && m.toolCallId) {
                msg.tool_call_id = m.toolCallId;
              }

              return msg;
            }),
            tools: tools.length > 0 ? tools : undefined,
            maxTokens: this.config.memory?.maxTokens || DEFAULT_MAX_TOKENS,
            temperature: DEFAULT_TEMPERATURE,
          });
        });

        totalUsage.promptTokens += response.usage.promptTokens;
        totalUsage.completionTokens += response.usage.completionTokens;
        totalUsage.totalTokens += response.usage.totalTokens;

        const assistantMessage: Message = {
          id: `msg_${Date.now()}_${step}`,
          role: "assistant",
          content: response.text,
          toolCalls: response.toolCalls,
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
                  content: JSON.stringify(result),
                  toolCallId: tc.id,
                  toolCall,
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
                  content: `Error: ${toolCall.error}`,
                  toolCallId: tc.id,
                  toolCall,
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

      return {
        text: currentMessages[currentMessages.length - 1]?.content || "",
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
      const tools = this.getAvailableTools();

      const stream = await provider.stream({
        model,
        system: systemPrompt,
        messages: currentMessages.map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.toolCalls?.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
          tool_call_id: m.toolCallId,
        })),
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

      const recordToolError = async (toolCall: ToolCall, errorStr: string) => {
        toolCall.status = "error";
        toolCall.error = errorStr;
        toolCalls.push(toolCall);

        const errorData = JSON.stringify({
          type: "error",
          error: errorStr,
        });
        controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));

        const errorMessage: Message = {
          id: `tool_error_${toolCall.id}`,
          role: "tool",
          content: `Error: ${errorStr}`,
          toolCallId: toolCall.id,
          toolCall,
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
            const textDeltaEvent = JSON.stringify({
              type: "text-delta",
              id: textPartId,
              delta: event.content,
            });
            controller.enqueue(encoder.encode(`data: ${textDeltaEvent}\n\n`));

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

              // Send tool-call-streaming-start event (Vercel AI SDK format)
              const toolStartEvent = JSON.stringify({
                type: "tool-call-streaming-start",
                toolCallId: event.toolCall.id,
                toolName: event.toolCall.name,
              });
              controller.enqueue(encoder.encode(`data: ${toolStartEvent}\n\n`));
            }
            break;

          case "tool_call_delta":
            if (event.id && streamToolCalls.has(event.id)) {
              const tc = streamToolCalls.get(event.id)!;
              tc.arguments += event.arguments;

              // Send tool-call-delta event (Vercel AI SDK format)
              const toolDeltaEvent = JSON.stringify({
                type: "tool-call-delta",
                toolCallId: event.id,
                argsTextDelta: event.arguments,
              });
              controller.enqueue(encoder.encode(`data: ${toolDeltaEvent}\n\n`));
            }
            break;

          case "tool_call_complete":
            if (event.toolCall?.id) {
              streamToolCalls.set(event.toolCall.id, {
                id: event.toolCall.id,
                name: event.toolCall.name,
                arguments: event.toolCall.arguments,
              });

              // Send tool-call event (Vercel AI SDK format)
              const { args } = parseStreamToolArgs(event.toolCall.arguments);
              const toolCallEvent = JSON.stringify({
                type: "tool-call",
                toolCallId: event.toolCall.id,
                toolName: event.toolCall.name,
                args,
              });
              controller.enqueue(encoder.encode(`data: ${toolCallEvent}\n\n`));
            }
            break;

          case "finish":
            finishReason = event.finishReason;
            break;

          case "usage":
            if (event.usage) {
              totalUsage.promptTokens += event.usage.promptTokens || 0;
              totalUsage.completionTokens += event.usage.completionTokens || 0;
              totalUsage.totalTokens += event.usage.totalTokens || 0;
            }
            break;
        }
      };

      let partial = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        partial += decoder.decode(value, { stream: true });
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

      const assistantMessage: Message = {
        id: `msg_${Date.now()}_${step}`,
        role: "assistant",
        content: accumulatedText,
        timestamp: Date.now(),
      };

      if (streamToolCalls.size > 0) {
        assistantMessage.toolCalls = Array.from(streamToolCalls.values()).map(
          (tc): StreamToolCall => {
            const { args, error } = parseStreamToolArgs(tc.arguments);
            if (error) {
              logger.warn("[AGENT] Failed to parse streamed tool arguments", {
                toolCallId: tc.id,
                error,
              });
            }
            return {
              id: tc.id,
              name: tc.name,
              arguments: args,
            };
          },
        );
      }

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
            await recordToolError(toolCall, `Invalid tool arguments: ${argError}`);
            continue;
          }

          try {
            toolCall.status = "executing";
            const startTime = Date.now();

            if (callbacks?.onToolCall) {
              callbacks.onToolCall(toolCall);
            }

            // Send tool-call event (Vercel AI SDK format)
            const toolCallEvent = JSON.stringify({
              type: "tool-call",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              args: toolCall.args,
            });
            controller.enqueue(encoder.encode(`data: ${toolCallEvent}\n\n`));

            const result = await executeTool(tc.name, toolCall.args, {
              agentId: this.id,
              ...toolContext,
            });

            toolCall.status = "completed";
            toolCall.result = result;
            toolCall.executionTime = Date.now() - startTime;
            toolCalls.push(toolCall);

            // Send tool-result event (Vercel AI SDK format)
            const toolResultEvent = JSON.stringify({
              type: "tool-result",
              toolCallId: toolCall.id,
              result,
            });
            controller.enqueue(encoder.encode(`data: ${toolResultEvent}\n\n`));

            const toolResultMessage: Message = {
              id: `tool_${tc.id}`,
              role: "tool",
              content: JSON.stringify(result),
              toolCallId: tc.id,
              toolCall,
              timestamp: Date.now(),
            };
            currentMessages.push(toolResultMessage);
            await this.memory.add(toolResultMessage);
          } catch (error) {
            const errorStr = error instanceof Error ? error.message : String(error);
            await recordToolError(toolCall, errorStr);
          }
        }

        this.status = "thinking";
        continue;
      }

      break;
    }

    return {
      text: currentMessages[currentMessages.length - 1]?.content || "",
      messages: currentMessages,
      toolCalls,
      status: "completed",
      usage: totalUsage,
    };
  }

  /**
   * Execute middleware chain
   */
  private executeMiddleware(
    context: AgentContext,
    next: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> {
    const middleware = this.config.middleware || [];

    if (middleware.length === 0) {
      return next();
    }

    let index = 0;
    const dispatch = (): Promise<AgentResponse> => {
      if (index >= middleware.length) {
        return next();
      }

      const currentMiddleware = middleware[index++];
      if (!currentMiddleware) {
        return next();
      }
      return currentMiddleware(context, dispatch);
    };

    return dispatch();
  }

  private getAvailableTools(): ToolDefinition[] {
    if (!this.config.tools) {
      return [];
    }

    const tools: ToolDefinition[] = [];

    // When tools === true, load ALL tools from the registry
    if (this.config.tools === true) {
      const allTools = toolRegistry.getAll();
      logger.debug(`[AGENT] Loading all ${allTools.size} tools from registry`);
      for (const [name, tool] of allTools) {
        const def = toolToProviderDefinition(tool);
        logger.debug(`[AGENT] Tool definition for "${name}":`, JSON.stringify(def, null, 2));
        tools.push(def);
      }
      return tools;
    }

    // Otherwise, load specific tools from the config
    for (const [name, entry] of Object.entries(this.config.tools)) {
      if (entry === true) {
        const tool = toolRegistry.get(name);
        if (tool) {
          const def = toolToProviderDefinition(tool);
          logger.debug(`[AGENT] Tool definition for "${name}":`, JSON.stringify(def, null, 2));
          tools.push(def);
        }
        continue;
      }

      if (entry && typeof entry === "object") {
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
    const system = this.config.system;

    if (typeof system === "string") {
      return system;
    }

    if (typeof system === "function") {
      return await system();
    }

    return "You are a helpful AI assistant.";
  }

  /**
   * Normalize input to messages array
   */
  private normalizeInput(input: string | Message[]): Message[] {
    if (typeof input === "string") {
      return [
        {
          id: `msg_${Date.now()}`,
          role: "user",
          content: input,
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
   * Get max steps considering edge config and platform limits
   */
  private getMaxSteps(platformLimit: number): number {
    // Edge config takes precedence
    if (this.config.edge?.enabled && this.config.edge.maxSteps) {
      return Math.min(this.config.edge.maxSteps, platformLimit);
    }

    // Use agent config
    if (this.config.maxSteps) {
      return Math.min(this.config.maxSteps, platformLimit);
    }

    // Default
    return Math.min(20, platformLimit);
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
