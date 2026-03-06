import type { Agent, AgentConfig, AgentResponse, Message } from "./types.ts";
import { AgentRuntime } from "./runtime/index.ts";
import {
  detectPlatform,
  validatePlatformCompatibility,
} from "#veryfront/platform/core-platform.ts";
import { registerTool } from "#veryfront/mcp";
import { toolRegistry } from "#veryfront/tool";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import { buildSkillManifestPrompt } from "#veryfront/skill/prompt-augmentation.ts";
import {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
  createLoadSkillTool,
} from "#veryfront/skill/tools.ts";
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

const SKILL_TOOL_REGISTRATIONS = [
  { id: "load-skill", create: createLoadSkillTool },
  { id: "load-skill-reference", create: createLoadSkillReferenceTool },
  { id: "execute-skill-script", create: createExecuteSkillScriptTool },
] as const;

export interface AgentStreamResult {
  toDataStreamResponse(options?: {
    headers?: Record<string, string>;
    status?: number;
    statusText?: string;
  }): Response;
}

function createAgentStreamResult(stream: ReadableStream<Uint8Array>): AgentStreamResult {
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

  // Skill tool registration (immutable config merge)
  let mergedToolsConfig = config.tools;

  if (config.skills) {
    // Register skill tools in the current project registry (not shared/global)
    for (const registration of SKILL_TOOL_REGISTRATIONS) {
      if (!toolRegistry.has(registration.id)) {
        registerTool(registration.id, registration.create());
      }
    }

    // Ensure skill tools are enabled for this agent even when config.tools is undefined
    if (config.tools !== true) {
      mergedToolsConfig = {
        ...(config.tools ?? {}),
        "load-skill": true,
        "load-skill-reference": true,
        "execute-skill-script": true,
      };
    }
  }

  // System prompt augmentation with skill manifest.
  // Re-resolve skills at invocation time so HMR changes are picked up.
  const originalSystem = config.system;
  const augmentedSystem = config.skills
    ? async () => {
      const currentSkills = skillRegistry.resolveForAgent(config.skills!);
      const basePrompt = typeof originalSystem === "function"
        ? await originalSystem()
        : originalSystem;
      if (!currentSkills.size) return basePrompt ?? "You are a helpful AI assistant.";
      return `${basePrompt}\n\n${buildSkillManifestPrompt(currentSkills)}`;
    }
    : originalSystem;

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

  const runtime = new AgentRuntime(id, {
    ...config,
    tools: mergedToolsConfig,
    system: augmentedSystem,
  });

  const agentInstance: Agent = {
    id,
    config,

    generate(input): Promise<AgentResponse> {
      return withSpan(
        "agent.factory.generate",
        () => runtime.generate(input.input, input.context, input.model),
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
          }, input.model);

          return createAgentStreamResult(stream);
        },
        { "agent.id": id, "agent.input_type": input.input ? "string" : "messages" },
      );
    },

    respond(request): Promise<Response> {
      return withSpan(
        "agent.factory.respond",
        async () => {
          const body: {
            messages?: Message[];
            context?: Record<string, unknown>;
            model?: string;
          } = await request.json();

          // Validate model override against allowlist when configured
          const modelOverride = body.model;
          if (modelOverride && config.allowedModels?.length) {
            if (!config.allowedModels.includes(modelOverride)) {
              return new Response(
                JSON.stringify({
                  error: `Model "${modelOverride}" is not allowed. Allowed models: ${
                    config.allowedModels.join(", ")
                  }`,
                }),
                { status: 403, headers: { "Content-Type": "application/json" } },
              );
            }
          }

          const messages = body.messages ?? [];
          const stream = await runtime.stream(messages, body.context, undefined, modelOverride);

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

// Register on globalThis so compiled-binary runtime shim can delegate to the
// real factory. External temp-file modules can't import from the embedded
// binary FS, so they use globalThis bridges instead.
(globalThis as Record<string, unknown>).__vfAgentFactory = agent;

let agentIdCounter = 0;

function generateAgentId(): string {
  return `agent_${Date.now()}_${agentIdCounter++}`;
}
