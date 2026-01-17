/**
 * Agent factory
 */

import type { Agent, AgentConfig, AgentResponse, Message, ToolCall } from "./types.ts";
import { AgentRuntime } from "./runtime/index.ts";
import { detectPlatform, validatePlatformCompatibility } from "../platform/core-platform.ts";
import { registerTool } from "@veryfront/mcp";
import { agentRegistry } from "./composition/index.ts";
import { agentLogger } from "@veryfront/utils/logger/logger.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";

/**
 * Standard headers for Vercel AI SDK compatible streaming responses
 */
const STREAMING_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  // Required header for Vercel AI SDK Data Stream Protocol v1
  "x-vercel-ai-ui-message-stream": "v1",
};

/**
 * Result object returned by agent.stream()
 * Provides toDataStreamResponse() for Vercel AI SDK compatible streaming
 */
export interface AgentStreamResult {
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
 * Create an AgentStreamResult from a ReadableStream
 * Returns Vercel AI SDK compatible streaming response
 */
function createAgentStreamResult(stream: ReadableStream): AgentStreamResult {
  return {
    toDataStreamResponse(options?: {
      headers?: Record<string, string>;
      status?: number;
      statusText?: string;
    }): Response {
      return new Response(stream, {
        status: options?.status ?? 200,
        statusText: options?.statusText,
        headers: { ...STREAMING_HEADERS, ...options?.headers },
      });
    },
  };
}

/**
 * Create an agent
 *
 * @example
 * ```typescript
 * import { agent } from 'veryfront/agent';

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

  // Register tools if config.tools is a Record (not `true` for all tools)
  if (config.tools && config.tools !== true) {
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
      const inputMessages: Message[] = input.input
        ? [{
          id: `msg_${Date.now()}`,
          role: "user" as const,
          parts: [{ type: "text", text: input.input }],
        }]
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

      return new Response(stream, { headers: STREAMING_HEADERS });
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
