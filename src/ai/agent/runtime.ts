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
  ToolCall,
} from "../types/agent.ts";
import type { ToolDefinition } from "../types/tool.ts";
import type { Provider } from "../types/provider.ts";
import { getProviderFromModel } from "../providers/factory.ts";
import { executeTool, toolRegistry, toolToProviderDefinition } from "../utils/tool.ts";
import { detectPlatform, getPlatformCapabilities } from "../runtime/platform.ts";
import { createMemory, type Memory } from "./memory.ts";
import { serverLogger as logger } from "@veryfront/utils";

export class AgentRuntime {
  private id: string;
  private config: AgentConfig;
  private memory: Memory;
  private status: AgentStatus = "idle";

  constructor(id: string, config: AgentConfig) {
    this.id = id;
    this.config = config;

    // Initialize memory
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
    // Convert input to messages
    const inputMessages = this.normalizeInput(input);

    // Add to memory
    for (const msg of inputMessages) {
      await this.memory.add(msg);
    }

    // Get messages from memory
    const messages = await this.memory.getMessages();

    // Get system prompt
    const systemPrompt = await this.resolveSystemPrompt();

    // Get provider and model
    const { provider, model } = getProviderFromModel(this.config.model);

    // Prepare context for middleware
    const agentContext: AgentContext = {
      agentId: this.id,
      model: this.config.model,
      input: inputMessages,
      data: context,
      platform: detectPlatform(),
    };

    // Execute middleware chain
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

    // Execute agent loop
    return await this.executeAgentLoop(
      provider,
      model,
      systemPrompt,
      messages,
    );
  }

  /**
   * Stream a response
   */
  async stream(
    messages: Message[],
    _context?: Record<string, unknown>,
    callbacks?: {
      onToolCall?: (toolCall: ToolCall) => void;
      onChunk?: (chunk: string) => void;
    },
  ): Promise<ReadableStream> {
    // Add to memory
    for (const msg of messages) {
      await this.memory.add(msg);
    }

    // Get messages from memory
    const memoryMessages = await this.memory.getMessages();

    // Get system prompt
    const systemPrompt = await this.resolveSystemPrompt();

    // Get provider and model
    const { provider, model } = getProviderFromModel(this.config.model);

    // Create streaming response
    const encoder = new TextEncoder();

    return new ReadableStream({
      start: async (controller) => {
        try {
          this.status = "streaming";

          // Execute agent loop with streaming
          const response = await this.executeAgentLoopStreaming(
            provider,
            model,
            systemPrompt,
            memoryMessages,
            controller,
            encoder,
            callbacks,
          );

          // Send final status
          const statusData = JSON.stringify({
            type: "status",
            status: "completed",
            usage: response.usage,
          });
          controller.enqueue(encoder.encode(`data: ${statusData}\n\n`));

          controller.close();
        } catch (error) {
          this.status = "error";

          const errorData = JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));

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
    const capabilities = getPlatformCapabilities();
    const maxSteps = this.getMaxSteps(capabilities.maxAgentSteps);

    const toolCalls: ToolCall[] = [];
    const currentMessages = [...messages];
    const totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    // Agent loop
    for (let step = 0; step < maxSteps; step++) {
      this.status = "thinking";

      // Get available tools
      const tools = this.getAvailableTools();

      // Call provider
      const response = await provider.complete({
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
        maxTokens: this.config.memory?.maxTokens || 4096,
        temperature: 0.7,
      });

      // Update usage
      totalUsage.promptTokens += response.usage.promptTokens;
      totalUsage.completionTokens += response.usage.completionTokens;
      totalUsage.totalTokens += response.usage.totalTokens;

      // Add assistant message
      const assistantMessage: Message = {
        id: `msg_${Date.now()}_${step}`,
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls, // Include tool calls from response
        timestamp: Date.now(),
      };
      currentMessages.push(assistantMessage);

      // Add to memory
      await this.memory.add(assistantMessage);

      // Check if there are tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        this.status = "tool_execution";

        // Execute each tool call
        for (const tc of response.toolCalls) {
          const toolCall: ToolCall = {
            id: tc.id,
            name: tc.name,
            args: tc.arguments,
            status: "pending",
          };

          try {
            toolCall.status = "executing";
            const startTime = Date.now();

            // Execute tool
            const result = await executeTool(tc.name, tc.arguments, {
              agentId: this.id,
            });

            toolCall.status = "completed";
            toolCall.result = result;
            toolCall.executionTime = Date.now() - startTime;

            // Add tool result message
            const toolResultMessage: Message = {
              id: `tool_${tc.id}`,
              role: "tool",
              content: JSON.stringify(result),
              toolCallId: tc.id, // Required by OpenAI API
              toolCall,
              timestamp: Date.now(),
            };
            currentMessages.push(toolResultMessage);

            // Add to memory
            await this.memory.add(toolResultMessage);
          } catch (error) {
            toolCall.status = "error";
            toolCall.error = error instanceof Error ? error.message : String(error);

            // Add error message
            const errorMessage: Message = {
              id: `tool_error_${tc.id}`,
              role: "tool",
              content: `Error: ${toolCall.error}`,
              toolCallId: tc.id, // Required by OpenAI API
              toolCall,
              timestamp: Date.now(),
            };
            currentMessages.push(errorMessage);

            // Add to memory
            await this.memory.add(errorMessage);
          }

          toolCalls.push(toolCall);
        }

        // Continue loop to process tool results
        continue;
      }

      // No tool calls, we're done
      this.status = "completed";

      return {
        text: response.text,
        messages: currentMessages,
        toolCalls,
        status: this.status,
        usage: totalUsage,
      };
    }

    // Max steps reached
    this.status = "completed";

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
  }

  /**
   * Execute agent loop with streaming
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

    // Agent loop
    for (let step = 0; step < maxSteps; step++) {
      // Get available tools
      const tools = this.getAvailableTools();

      // Stream from provider
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
        maxTokens: this.config.memory?.maxTokens || 4096,
        temperature: 0.7,
      });

      // Read stream - now it returns structured JSON chunks
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = "";
      let finishReason: string | null = null;

      // Track tool calls being built
      const streamToolCalls = new Map<string, {
        id: string;
        name: string;
        arguments: string;
      }>();

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const event = JSON.parse(line);

            switch (event.type) {
              case "content": {
                // Accumulate text content
                accumulatedText += event.content;

                // Send chunk to client
                const chunkData = JSON.stringify({
                  type: "chunk",
                  content: event.content,
                });
                controller.enqueue(encoder.encode(`data: ${chunkData}\n\n`));

                // Call callback
                if (callbacks?.onChunk) {
                  callbacks.onChunk(event.content);
                }
                break;
              }

              case "tool_call_start":
                // Initialize tool call tracking
                if (event.toolCall?.id) {
                  streamToolCalls.set(event.toolCall.id, {
                    id: event.toolCall.id,
                    name: event.toolCall.name,
                    arguments: "",
                  });
                }
                break;

              case "tool_call_delta":
                // Accumulate tool call arguments
                if (event.id && streamToolCalls.has(event.id)) {
                  const tc = streamToolCalls.get(event.id)!;
                  tc.arguments += event.arguments;
                }
                break;

              case "tool_call_complete":
                // Tool call is complete
                if (event.toolCall?.id) {
                  streamToolCalls.set(event.toolCall.id, {
                    id: event.toolCall.id,
                    name: event.toolCall.name,
                    arguments: event.toolCall.arguments,
                  });
                }
                break;

              case "finish":
                finishReason = event.finishReason;
                break;

              case "usage":
                // Accumulate usage data
                if (event.usage) {
                  totalUsage.promptTokens += event.usage.promptTokens || 0;
                  totalUsage.completionTokens += event.usage.completionTokens || 0;
                  totalUsage.totalTokens += event.usage.totalTokens || 0;
                }
                break;
            }
          } catch (_e) {
            // Skip invalid JSON
            continue;
          }
        }
      }

      // Add assistant message
      const assistantMessage: Message = {
        id: `msg_${Date.now()}_${step}`,
        role: "assistant",
        content: accumulatedText,
        timestamp: Date.now(),
      };

      // If there are tool calls, add them to the message
      if (streamToolCalls.size > 0) {
        assistantMessage.toolCalls = Array.from(streamToolCalls.values()).map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: JSON.parse(tc.arguments),
        }));
      }

      currentMessages.push(assistantMessage);

      // Add to memory
      await this.memory.add(assistantMessage);

      // Handle tool calls if finish reason is tool_calls
      if (finishReason === "tool_calls" && streamToolCalls.size > 0) {
        this.status = "tool_execution";

        // Execute each tool call
        for (const tc of streamToolCalls.values()) {
          const toolCall: ToolCall = {
            id: tc.id,
            name: tc.name,
            args: JSON.parse(tc.arguments),
            status: "pending",
          };

          try {
            toolCall.status = "executing";
            const startTime = Date.now();

            // Notify via callback
            if (callbacks?.onToolCall) {
              callbacks.onToolCall(toolCall);
            }

            // Send tool call event to client
            const toolCallData = JSON.stringify({
              type: "tool_call",
              toolCall: {
                id: toolCall.id,
                name: toolCall.name,
                args: toolCall.args,
              },
            });
            controller.enqueue(encoder.encode(`data: ${toolCallData}\n\n`));

            // Execute tool
            const result = await executeTool(tc.name, toolCall.args, {
              agentId: this.id,
            });

            toolCall.status = "completed";
            toolCall.result = result;
            toolCall.executionTime = Date.now() - startTime;
            toolCalls.push(toolCall);

            // Send tool result event to client
            const toolResultData = JSON.stringify({
              type: "tool_result",
              toolCall: {
                id: toolCall.id,
                name: toolCall.name,
                result,
              },
            });
            controller.enqueue(encoder.encode(`data: ${toolResultData}\n\n`));

            // Add tool result message
            const toolResultMessage: Message = {
              id: `tool_${tc.id}`,
              role: "tool",
              content: JSON.stringify(result),
              toolCallId: tc.id,
              toolCall,
              timestamp: Date.now(),
            };
            currentMessages.push(toolResultMessage);

            // Add to memory
            await this.memory.add(toolResultMessage);
          } catch (error) {
            toolCall.status = "error";
            toolCall.error = error instanceof Error ? error.message : String(error);
            toolCalls.push(toolCall);

            // Send error event to client
            const errorData = JSON.stringify({
              type: "error",
              error: toolCall.error,
            });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));

            // Add error message
            const errorMessage: Message = {
              id: `tool_error_${tc.id}`,
              role: "tool",
              content: `Error: ${toolCall.error}`,
              toolCallId: tc.id,
              toolCall,
              timestamp: Date.now(),
            };
            currentMessages.push(errorMessage);

            // Add to memory
            await this.memory.add(errorMessage);
          }
        }

        // Continue the loop to get the next response
        this.status = "thinking";
        continue;
      }

      // If we got here with a stop finish reason, we're done
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

    // Create middleware chain
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
