import type { Agent, AgentConfig, AgentResponse, Message, ToolCall as _ToolCall } from "./types.ts";
import { AgentRuntime } from "./runtime/index.ts";
import { detectPlatform, validatePlatformCompatibility } from "../platform/core-platform.ts";
import { registerTool } from "#veryfront/mcp";
import { agentRegistry } from "./composition/index.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const STREAMING_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "x-vercel-ai-ui-message-stream": "v1",
};

export interface AgentStreamResult {
  toDataStreamResponse(options?: {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
  }): Response;
}

function createAgentStreamResult(stream: ReadableStream): AgentStreamResult {
  return {
    toDataStreamResponse(options): Response {
      return new Response(stream, {
        status: options?.status ?? 200,
        statusText: options?.statusText,
        headers: { ...STREAMING_HEADERS, ...options?.headers },
      });
    },
  };
}

export function agent(config: AgentConfig): Agent {
  if (typeof config.id === "string" && config.id.trim().length === 0) {
    throw toError(
      createError({
        type: "agent",
        message: "Agent id cannot be empty.",
      }),
    );
  }

  const id = config.id ?? generateAgentId();

  if (config.tools && config.tools !== true) {
    for (const [name, entry] of Object.entries(config.tools)) {
      if (!entry || typeof entry !== "object") continue;

      const normalizedTool = entry.id === name ? entry : { ...entry, id: name };
      registerTool(normalizedTool.id, normalizedTool);
      config.tools[name] = normalizedTool;
    }
  }

  const platform = detectPlatform();
  const compatibility = validatePlatformCompatibility(
    {
      maxSteps: config.maxSteps,
      streaming: config.streaming,
      requiresFileSystem: false,
      requiresMCP: false,
    },
    platform,
  );

  if (!compatibility.compatible) {
    throw toError(
      createError({
        type: "agent",
        message: `Agent "${id}" is not compatible with current platform:\n${
          compatibility.errors.join("\n")
        }`,
      }),
    );
  }

  if (compatibility.warnings.length) {
    agentLogger.warn(`Agent "${id}" warnings:\n${compatibility.warnings.join("\n")}`);
  }

  const runtime = new AgentRuntime(id, config);

  const agentInstance: Agent = {
    id,
    config,

    generate(input): Promise<AgentResponse> {
      return withSpan(
        "agent.factory.generate",
        () => runtime.generate(input.input, input.context),
        { "agent.id": id },
      );
    },

    stream(input): Promise<AgentStreamResult> {
      return withSpan(
        "agent.factory.stream",
        async () => {
          const inputMessages: Message[] = input.input
            ? [
              {
                id: `msg_${Date.now()}`,
                role: "user",
                parts: [{ type: "text", text: input.input }],
              },
            ]
            : (input.messages ?? []);

          const stream = await runtime.stream(inputMessages, input.context, {
            onToolCall: input.onToolCall,
            onChunk: input.onChunk,
          });

          return createAgentStreamResult(stream);
        },
        { "agent.id": id, "agent.input_type": input.input ? "string" : "messages" },
      );
    },

    respond(request): Promise<Response> {
      return withSpan(
        "agent.factory.respond",
        async () => {
          const body = await request.json();
          const messages = body.messages ?? [];
          const stream = await runtime.stream(messages, body.context);

          return new Response(stream, { headers: STREAMING_HEADERS });
        },
        { "agent.id": id },
      );
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

let agentIdCounter = 0;

function generateAgentId(): string {
  return `agent_${Date.now()}_${agentIdCounter++}`;
}
