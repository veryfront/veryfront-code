/**
 * Agent factory
 */

import type { Agent, AgentConfig, AgentResponse, Message, ToolCall } from "../types/agent.ts";
import { AgentRuntime } from "./runtime.ts";
import { detectPlatform, validatePlatformCompatibility } from "../runtime/platform.ts";
import { registerTool } from "../mcp/registry.ts";
import { agentRegistry } from "./registry.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

/**
 * Result object returned by agent.stream() with Vercel AI SDK compatible API
 */
export interface AgentStreamResult extends ReadableStream {
  /**
   * Convert the stream to a Response object for streaming responses
   * Compatible with Vercel AI SDK's toDataStreamResponse()
   */
  toDataStreamResponse(options?: {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
  }): Response;
}

/**
 * Create an AgentStreamResult that wraps a ReadableStream with toDataStreamResponse()
 */
function createAgentStreamResult(stream: ReadableStream): AgentStreamResult {
  // Create a new object that extends the stream's prototype
  const result = Object.create(stream) as AgentStreamResult;

  // Copy all properties from the original stream
  Object.defineProperties(result, Object.getOwnPropertyDescriptors(stream));

  // Add toDataStreamResponse method
  result.toDataStreamResponse = function(options?: {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
  }): Response {
    const defaultHeaders = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    };

    return new Response(stream, {
      status: options?.status ?? 200,
      statusText: options?.statusText,
      headers: {
        ...defaultHeaders,
        ...options?.headers,
      },
    });
  };

  return result;
}

/**
 * Create an agent
 *
 * @example
 * ```typescript
 * import { agent } from 'veryfront/ai';

 *
 * export default agent({
 *   model: 'openai/gpt-4',
 *   system: 'You are a helpful assistant',
 *   tools: {
 *     searchWeb: true,
 *   },
 * });
 * ```
 */
export function agent(config: AgentConfig): Agent {
  const id = config.id || generateAgentId();

  if (config.tools) {
    for (const [name, entry] of Object.entries(config.tools)) {
      if (entry && typeof entry === "object") {
        const normalizedTool = entry.id === name ? entry : { ...entry, id: name };
        registerTool(normalizedTool.id, normalizedTool);
        config.tools[name] = normalizedTool;
      }
    }
  }

  const platform = detectPlatform();
  const compatibility = validatePlatformCompatibility({
    maxSteps: config.maxSteps,
    streaming: config.streaming,
    requiresFileSystem: false,
    requiresMCP: false,
  }, platform);

  if (!compatibility.compatible) {
    throw toError(createError({
      type: "agent",
      message: `Agent "${id}" is not compatible with current platform:\n${
        compatibility.errors.join("\n")
      }`,
    }));
  }

  if (compatibility.warnings.length > 0) {
    agentLogger.warn(
      `Agent "${id}" warnings:\n${compatibility.warnings.join("\n")}`,
    );
  }

  const runtime = new AgentRuntime(id, config);

  const agentInstance: Agent = {
    id,
    config,

    generate(input: {
      input: string | Message[];
      context?: Record<string, unknown>;
    }): Promise<AgentResponse> {
      return runtime.generate(input.input, input.context);
    },

    async stream(input: {
      input?: string;
      messages?: Message[];
      context?: Record<string, unknown>;
      onToolCall?: (toolCall: ToolCall) => void;
      onChunk?: (chunk: string) => void;
    }): Promise<AgentStreamResult> {
      const inputMessages = input.input
        ? [{ role: "user" as const, content: input.input }]
        : input.messages || [];

      const stream = await runtime.stream(inputMessages, input.context, {
        onToolCall: input.onToolCall,
        onChunk: input.onChunk,
      });

      return createAgentStreamResult(stream);
    },

    async respond(request: Request): Promise<Response> {
      const body = await request.json();
      const messages = body.messages || [];
      const stream = await runtime.stream(messages, body.context);

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    },

    getMemory() {
      return runtime.getMemory();
    },

    getMemoryStats() {
      return runtime.getMemoryStats();
    },

    clearMemory() {
      return runtime.clearMemory();
    },
  };

  agentRegistry.register(id, agentInstance);

  return agentInstance;
}

/**
 * Generate a unique agent ID
 */
let agentIdCounter = 0;
function generateAgentId(): string {
  return `agent_${Date.now()}_${agentIdCounter++}`;
}
