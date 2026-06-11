import type {
  Agent,
  AgentConfig,
  AgentMiddleware,
  AgentResponse,
  AgentStreamResult,
  Message,
  ResolvedAgentConfig,
} from "./types.ts";
import { AgentRuntime } from "./runtime/index.ts";
import { isRuntimeLocalTool } from "./runtime/local-tool.ts";
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
import { COMMON_BLOCKED_PATTERNS, securityMiddleware } from "./middleware/security/validator.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { resolveConfiguredAgentModel } from "./runtime/model-resolution.ts";

const STREAMING_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "x-vercel-ai-ui-message-stream": "v1",
};

const SKILL_TOOL_REGISTRATIONS = [
  { id: "load_skill", create: createLoadSkillTool },
  { id: "load_skill_reference", create: createLoadSkillReferenceTool },
  { id: "execute_skill_script", create: createExecuteSkillScriptTool },
] as const;

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

/** Agent helper. */
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

  const publicConfig: ResolvedAgentConfig = {
    ...config,
    model: resolveConfiguredAgentModel(config.model),
  };

  if (config.tools && config.tools !== true) {
    for (const [name, entry] of Object.entries(config.tools)) {
      if (!entry || typeof entry !== "object") continue;
      if (isRuntimeLocalTool(entry)) continue;

      const normalizedTool = entry.id === name ? entry : { ...entry, id: name };
      registerTool(normalizedTool.id, normalizedTool);
      config.tools[name] = normalizedTool;
    }
  }

  // Skill tool registration (immutable config merge)
  let mergedToolsConfig = config.tools;

  if (config.skills) {
    // Skill tools (load_skill, load_skill_reference, execute_skill_script) are
    // framework infrastructure — shared across all projects. Project tools and
    // skills themselves remain project-scoped. Using registerShared avoids
    // scope mismatch between module-load time and request-handling time.
    for (const registration of SKILL_TOOL_REGISTRATIONS) {
      if (!toolRegistry.has(registration.id)) {
        toolRegistry.registerShared(registration.id, registration.create());
      }
    }

    // Ensure skill tools are enabled for this agent even when config.tools is undefined
    if (config.tools !== true) {
      mergedToolsConfig = {
        ...(config.tools ?? {}),
        "load_skill": true,
        "load_skill_reference": true,
        "execute_skill_script": true,
      };
    }
  }

  // System prompt augmentation with skill manifest.
  // Re-resolve skills at invocation time so HMR changes are picked up.
  const originalSystem = config.system;
  const augmentedSystem = config.skills
    ? async () => {
      // Owner-aware: the manifest only ever advertises skills visible to this
      // agent (unowned project skills plus its own), matching skill-tool
      // enforcement at execution time.
      const currentSkills = skillRegistry.resolveForAgent(config.skills!, { agentId: id });
      const basePrompt = typeof originalSystem === "function"
        ? await originalSystem()
        : originalSystem;
      if (!currentSkills.size) return basePrompt ?? "You are a helpful assistant.";
      return `${basePrompt}\n\n${buildSkillManifestPrompt(currentSkills)}`;
    }
    : originalSystem;

  const resolvedMiddleware = resolveSecurityMiddleware(config);

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
    ...publicConfig,
    tools: mergedToolsConfig,
    system: augmentedSystem,
    middleware: resolvedMiddleware,
  });

  const agentInstance: Agent = {
    id,
    config: {
      ...publicConfig,
      tools: mergedToolsConfig,
    },

    generate(input): Promise<AgentResponse> {
      return withSpan(
        "agent.factory.generate",
        () => runtime.generate(input.input, input.context, input.model, input.maxOutputTokens),
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

          const stream = await runtime.stream(
            inputMessages,
            input.context,
            {
              onToolCall: input.onToolCall,
              onChunk: input.onChunk,
              onFinish: input.onFinish,
            },
            input.model,
            input.maxOutputTokens,
            input.abortSignal,
          );

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
            maxOutputTokens?: number;
          } = await request.json();

          // Validate model override against allowlist when configured
          const modelOverride = body.model;
          if (modelOverride && publicConfig.allowedModels?.length) {
            if (!publicConfig.allowedModels.includes(modelOverride)) {
              return new Response(
                JSON.stringify({
                  error: `Model "${modelOverride}" is not allowed. Allowed models: ${
                    publicConfig.allowedModels.join(", ")
                  }`,
                }),
                { status: 403, headers: { "Content-Type": "application/json" } },
              );
            }
          }

          const messages = body.messages ?? [];
          const stream = await runtime.stream(
            messages,
            body.context,
            undefined,
            modelOverride,
            body.maxOutputTokens,
          );

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
if (!("__vfAgentFactory" in globalThis)) {
  Object.defineProperty(globalThis, "__vfAgentFactory", {
    value: agent,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

/**
 * Resolve the middleware array for an agent, prepending security middleware
 * unless explicitly opted out with `security: false`.
 *
 * The security middleware does not impose any input character limit: agent
 * input (latest user message plus conversation history and structured tool
 * results) can be arbitrarily large. Prompt-injection pattern blocking and
 * output PII filtering still apply.
 */
export function resolveSecurityMiddleware(
  config: Pick<AgentConfig, "security" | "middleware">,
): AgentMiddleware[] {
  if (config.security === false) return config.middleware ?? [];
  return [
    securityMiddleware({
      input: {
        blockedPatterns: COMMON_BLOCKED_PATTERNS.promptInjection,
      },
      output: {
        filterPII: true,
      },
    }),
    ...(config.middleware ?? []),
  ];
}

let agentIdCounter = 0;

function generateAgentId(): string {
  return `agent_${Date.now()}_${agentIdCounter++}`;
}
