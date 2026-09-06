import type {
  Agent,
  AgentConfig,
  AgentGenerateInput,
  AgentMiddleware,
  AgentOutputSchema,
  AgentResponse,
  AgentStreamResult,
  AgentSystem,
  InferAgentOutputSchema,
  Message,
  ResolvedAgentConfig,
} from "./types.ts";
import {
  AgentRuntime,
  type AgentRuntimeInternalOptions,
  generateWithAgentRuntimeDispatch,
  streamWithAgentRuntimeDispatch,
} from "./runtime/index.ts";
import { normalizeInput } from "#veryfront/agent/runtime/input-utils.ts";
import { isRuntimeLocalTool } from "./runtime/local-tool.ts";
import {
  detectPlatform,
  validatePlatformCompatibility,
} from "#veryfront/platform/core-platform.ts";
import { registerTool } from "#veryfront/mcp";
import { assertLocalToolId, toolRegistry, toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import {
  resolveSkillToolDisposition,
  type SkillToolDisposition,
} from "./skill-tool-disposition.ts";
import type { Skill } from "#veryfront/skill/types.ts";
import type { ResolvedSkillSelectorSnapshot } from "#veryfront/skill/selector.ts";
import {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
  createLoadSkillTool,
} from "#veryfront/skill/tools.ts";
import { agentRegistry } from "./composition/index.ts";
import { agentLogger } from "#veryfront/utils";
import { createError, INVALID_ARGUMENT, toError } from "#veryfront/errors";
import { COMMON_BLOCKED_PATTERNS, securityMiddleware } from "./middleware/security/validator.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  resolveConfiguredAgentModel,
  resolveModelProviderOptionKey,
  resolveRuntimeModel,
} from "./runtime/model-resolution.ts";
import {
  createProviderAwareAgentSystemResolver,
  type ResolveAgentSystemFromResolvedBaseOptions,
  setEffectiveAgentSystem,
} from "./runtime/effective-agent-system.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { getMessageSchema } from "./schemas/agent.schema.ts";
import {
  isRequestBodyTooLargeError,
  readBodyWithLimit,
} from "#veryfront/security/input-validation/limits.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-schema-validator.ts";
import {
  buildAgentDelegateTools,
  createInvokeAgentTool,
  INVOKE_AGENT_TOOL_ID,
} from "./runtime/agent-delegation.ts";
import { normalizeAgentDelegateIds } from "./runtime/agent-delegation-names.ts";
import {
  buildAgentCallContext,
  buildAgentCallContextPreservingRuntimeMarker,
} from "./runtime/call-context.ts";
import type { RuntimeSkillDefinition } from "./runtime/skill-metadata.ts";

const IntrinsicReflectApply = Reflect.apply;
const IntrinsicArrayFilter = Array.prototype.filter;
const IntrinsicObjectEntries = Object.entries;
const IntrinsicObjectKeys = Object.keys;

const STREAMING_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "x-vercel-ai-ui-message-stream": "v1",
};

const getAgentRespondRequestSchema = defineSchema((v) =>
  v.object({
    messages: v.array(getMessageSchema()).optional().default([]),
    context: v.record(v.string(), v.unknown()).optional(),
    model: v.string().optional(),
    maxOutputTokens: v.number().int().positive().optional(),
  })
);

async function parseAgentRespondRequest(request: Request) {
  let data: unknown;
  try {
    data = JSON.parse(await readBodyWithLimit(request, DEFAULT_MAX_BODY_SIZE_BYTES));
  } catch (error) {
    const tooLarge = isRequestBodyTooLargeError(error);
    return Response.json(
      { error: tooLarge ? "Request body too large" : "Malformed JSON request body" },
      { status: tooLarge ? 413 : 400 },
    );
  }

  const parsed = getAgentRespondRequestSchema().safeParse(data);
  if (parsed.success) return parsed.data;

  return Response.json(
    { error: "Invalid agent request" },
    { status: 400 },
  );
}

const SKILL_TOOL_REGISTRATIONS = [
  { id: "load_skill", create: createLoadSkillTool },
  { id: "load_skill_reference", create: createLoadSkillReferenceTool },
  { id: "execute_skill_script", create: createExecuteSkillScriptTool },
] as const;

/**
 * Projects a registered skill onto the runtime skill shape the shared skills
 * renderer consumes. Instructions stay empty: the call context advertises
 * skills, and `load_skill` delivers their bodies.
 */
function toRuntimeSkillDefinition(skill: Skill): RuntimeSkillDefinition {
  return {
    id: skill.id,
    name: skill.metadata.name,
    ...(skill.metadata.displayName ? { displayName: skill.metadata.displayName } : {}),
    description: skill.metadata.description,
    instructions: "",
    allowedTools: skill.metadata.allowedTools ?? [],
  };
}

function withAllowedSkillIdsContext(
  context: Record<string, unknown> | undefined,
  allowedSkillIds: readonly string[],
  shouldAttachAllowedSkillIds: boolean,
): Record<string, unknown> | undefined {
  if (!shouldAttachAllowedSkillIds) {
    return context;
  }
  return { ...context, allowedSkillIds: [...allowedSkillIds] };
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

/** Keep explicit project-tool denials authoritative over provider-native bindings. */
function resolveProviderToolsConfiguration(
  config: Pick<AgentConfig, "providerTools" | "tools">,
): string[] | undefined {
  const providerTools = config.providerTools;
  const toolSelection = config.tools;
  if (providerTools === undefined || toolSelection === undefined || toolSelection === true) {
    return providerTools;
  }

  return IntrinsicReflectApply(IntrinsicArrayFilter, providerTools, [
    (toolName: string) => toolSelection[toolName] !== false,
  ]) as string[];
}

/** Everything the public surface closes over, named so the closure is visible. */
interface AgentInstanceDeps {
  id: string;
  publicConfig: ResolvedAgentConfig;
  toolsConfig: AgentConfig["tools"];
  runtime: AgentRuntime;
  resolveSkillSnapshot: () => Pick<ResolvedSkillSelectorSnapshot<Skill>, "allowedSkillIds">;
  shouldAttachAllowedSkillIds: boolean;
}

/**
 * Build the public agent surface over a constructed runtime.
 *
 * Separated from `agent()` so the three request paths can be read without the
 * construction that precedes them. Each resolves the skill snapshot per call
 * rather than capturing it, so registry changes during a long-lived process are
 * picked up on the next invocation instead of being frozen at creation.
 */
function createAgentInstance(deps: AgentInstanceDeps): Agent {
  const { id, publicConfig, toolsConfig, runtime, shouldAttachAllowedSkillIds } = deps;
  const resolveSkillSnapshot = deps.resolveSkillSnapshot;
  const generate = ((input: AgentGenerateInput): Promise<AgentResponse> =>
    withSpan(
      "agent.factory.generate",
      () => {
        const skillSnapshot = resolveSkillSnapshot();
        return generateWithAgentRuntimeDispatch(
          runtime,
          input.input,
          withAllowedSkillIdsContext(
            input.context,
            skillSnapshot.allowedSkillIds,
            shouldAttachAllowedSkillIds,
          ),
          input.model,
          input.maxOutputTokens,
          input.abortSignal,
          {
            toolReplacements: input.tools,
            retainSkillLoaderTools: input.retainSkillLoaderTools,
            outputSchema: input.outputSchema,
          },
        );
      },
      { "agent.id": id },
    )) as Agent["generate"];

  return {
    id,
    config: {
      ...publicConfig,
      tools: toolsConfig,
    },

    generate,

    stream(input): Promise<AgentStreamResult> {
      return withSpan(
        "agent.factory.stream",
        async () => {
          const inputMessages: Message[] = input.input
            ? normalizeInput(input.input)
            : (input.messages ?? []);

          const skillSnapshot = resolveSkillSnapshot();
          const stream = await streamWithAgentRuntimeDispatch(
            runtime,
            inputMessages,
            withAllowedSkillIdsContext(
              input.context,
              skillSnapshot.allowedSkillIds,
              shouldAttachAllowedSkillIds,
            ),
            {
              onToolCall: input.onToolCall,
              onChunk: input.onChunk,
              onFinish: input.onFinish,
            },
            input.model,
            input.maxOutputTokens,
            input.abortSignal,
            { outputSchema: input.outputSchema },
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
          const body = await parseAgentRespondRequest(request);
          if (body instanceof Response) return body;

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

          const messages = body.messages;
          const skillSnapshot = resolveSkillSnapshot();
          const stream = await streamWithAgentRuntimeDispatch(
            runtime,
            messages,
            withAllowedSkillIdsContext(
              body.context,
              skillSnapshot.allowedSkillIds,
              shouldAttachAllowedSkillIds,
            ),
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
}

/**
 * Merge skill tooling and delegate tooling into the authored tool selection.
 *
 * Skill tools are framework infrastructure shared by every skill-enabled agent,
 * so they are registered once in the shared registry and then added to this
 * agent's selection. Project skills stay project-scoped and owner-aware, which
 * is why the allowed ids are resolved per call rather than captured here.
 *
 * `tools: true` is left as-is: it authorizes the whole catalog, so there is
 * nothing to merge into. That is also why it cannot be combined with delegates,
 * whose capabilities have to stay individually declared.
 */
function resolveToolsConfiguration(input: {
  config: AgentConfig;
  id: string;
  delegates: string[] | undefined;
  skillTools: SkillToolDisposition;
  resolveSkillSnapshot: () => Pick<
    ResolvedSkillSelectorSnapshot<Skill>,
    "allowedSkillIds" | "definitions"
  >;
}): AgentConfig["tools"] {
  const { config, id, delegates, skillTools, resolveSkillSnapshot } = input;
  let merged = config.tools;

  ensureBuiltinSchemaValidator();
  for (let index = 0; index < SKILL_TOOL_REGISTRATIONS.length; index++) {
    const registration = SKILL_TOOL_REGISTRATIONS[index]!;
    if (!toolRegistry.has(registration.id)) {
      toolRegistryInternal.registerShared(registration.id, registration.create());
    }
  }

  if (config.tools !== true) {
    const configuredTools = { ...(config.tools ?? {}) };
    if (delegates !== undefined) {
      delete configuredTools[INVOKE_AGENT_TOOL_ID];
    } else if (configuredTools[INVOKE_AGENT_TOOL_ID] === true) {
      configuredTools[INVOKE_AGENT_TOOL_ID] = createInvokeAgentTool({ selfId: id });
    }
    for (let index = 0; index < SKILL_TOOL_REGISTRATIONS.length; index++) {
      const registration = SKILL_TOOL_REGISTRATIONS[index]!;
      if (skillTools === "disable" || skillTools === "omit") {
        if (configuredTools[registration.id] !== false) {
          delete configuredTools[registration.id];
        }
        continue;
      }

      const configuredTool = configuredTools[registration.id];
      if (
        configuredTool === false ||
        (typeof configuredTool === "object" && configuredTool !== null)
      ) {
        continue;
      }

      configuredTools[registration.id] = registration.create({
        resolveAllowedSkillIds: () => resolveSkillSnapshot().allowedSkillIds,
      });
    }
    const hasConfiguredTools = IntrinsicObjectKeys(configuredTools).length > 0;
    merged = hasConfiguredTools || config.tools !== undefined ? configuredTools : undefined;
  }

  if (delegates !== undefined) {
    if (merged === true) {
      throw INVALID_ARGUMENT.create({
        detail: `Agent "${id}" cannot combine delegates with tools: true. ` +
          "Declare the required tools by name so delegate capabilities remain explicit.",
      });
    }
    if (delegates.length > 0) {
      const delegateTools = buildAgentDelegateTools({ delegates, selfId: id });
      for (const toolName of IntrinsicObjectKeys(delegateTools)) {
        if (merged?.[toolName] === false) {
          delete delegateTools[toolName];
        }
      }
      merged = {
        ...(merged ?? {}),
        ...delegateTools,
      };
    }
  }

  return merged;
}

/**
 * Whether the resolved tool selection actually exposes the skill loader.
 *
 * The skill catalog block instructs the model to call `load_skill`, so it must
 * only be rendered when the effective tool configuration can honour that call.
 * An explicit `load_skill: false` denial, or a selection the loader was never
 * merged into, means the catalog would advertise an unusable tool.
 */
function isSkillLoaderExposed(tools: AgentConfig["tools"]): boolean {
  if (tools === true) return true;
  if (!tools) return false;
  const loader = tools["load_skill"];
  return loader !== undefined && loader !== false;
}

/**
 * Build the system prompt lazily, per invocation.
 *
 * Assembled at call time rather than construction time so registry-backed
 * skills pick up HMR changes and host-supplied project and environment facts
 * stay current across a long-lived process.
 */
function createAugmentedSystem(input: {
  config: AgentConfig;
  skillLoaderExposed: boolean;
  resolveSkillSnapshot: () => Pick<ResolvedSkillSelectorSnapshot<Skill>, "definitions">;
}): () => Promise<AgentSystem> {
  const { config, skillLoaderExposed, resolveSkillSnapshot } = input;
  const originalSystem = config.system;

  const augmentSystem = (
    resolvedBase: AgentSystem,
    providerOptionKey: string | undefined,
    options?: ResolveAgentSystemFromResolvedBaseOptions,
  ): AgentSystem => {
    // Owner-aware: omitted selectors advertise every skill visible to this
    // agent (unowned project skills plus its own). Explicit lists, including
    // an empty list, retain their authored catalog selection.
    const snapshot = resolveSkillSnapshot();
    const basePrompt = resolvedBase ?? "You are a helpful assistant.";
    const preassembledSkillContext = (config as AgentConfig & {
      __vfPreassembledSkillContext?: boolean;
    }).__vfPreassembledSkillContext === true;
    const anthropicProviderAlias = providerOptionKey ??
      resolveModelProviderOptionKey(resolveRuntimeModel(config.model));

    const contextInput = {
      // A denied or absent loader suppresses the catalog: advertising skills
      // the agent cannot load would only steer the model into blocked calls.
      ...(preassembledSkillContext || !skillLoaderExposed
        ? {}
        : { skills: snapshot.definitions.map(toRuntimeSkillDefinition) }),
      ...(config.projectContext ? { projectContext: config.projectContext } : {}),
      ...(config.environmentContext ? { environmentContext: config.environmentContext } : {}),
    };

    const buildCallContext = options?.preserveRuntimeContextMarker
      ? buildAgentCallContextPreservingRuntimeMarker
      : buildAgentCallContext;
    return buildCallContext({
      instructions: basePrompt,
      ...(anthropicProviderAlias ? { anthropicProviderAlias } : {}),
      ...contextInput,
    });
  };

  return createProviderAwareAgentSystemResolver(
    async (providerOptionKey) =>
      augmentSystem(
        typeof originalSystem === "function" ? await originalSystem() : originalSystem,
        providerOptionKey,
      ),
    (resolvedBase, providerOptionKey, options) =>
      Promise.resolve(augmentSystem(resolvedBase, providerOptionKey, options)),
  );
}

/**
 * Agent helper.
 *
 * `TOutput` is inferred from `config.outputSchema`, so `response.object` is
 * typed without an annotation. Agents without one keep no `object`.
 */
export function agent<TOutputSchema extends AgentOutputSchema>(
  config: AgentConfig<InferAgentOutputSchema<TOutputSchema>> & { outputSchema: TOutputSchema },
): Agent<InferAgentOutputSchema<TOutputSchema>>;
export function agent<TOutput = never>(config: AgentConfig<TOutput>): Agent<TOutput>;
export function agent<TOutput = never>(config: AgentConfig<TOutput>): Agent<TOutput> {
  return createAgent(config, { register: true });
}

/**
 * Build an agent runtime without adding it to the project registry.
 *
 * Framework facades use this when they need the agent runtime pipeline for a
 * single call, but must not expose a reusable agent in registry-backed
 * listings.
 */
export function createEphemeralAgent<TOutputSchema extends AgentOutputSchema>(
  config: AgentConfig<InferAgentOutputSchema<TOutputSchema>> & { outputSchema: TOutputSchema },
): Agent<InferAgentOutputSchema<TOutputSchema>>;
export function createEphemeralAgent<TOutput = never>(
  config: AgentConfig<TOutput>,
): Agent<TOutput>;
export function createEphemeralAgent<TOutput = never>(
  config: AgentConfig<TOutput>,
): Agent<TOutput> {
  return createAgent(config, { register: false });
}

/** @internal Creates an unregistered agent with framework-private runtime options. */
export function createEphemeralAgentWithRuntimeOptions<TOutput = never>(
  config: AgentConfig<TOutput>,
  runtimeOptions: AgentRuntimeInternalOptions,
): Agent<TOutput> {
  return createAgent(config, { register: false, runtimeOptions });
}

function createAgent<TOutput = never>(
  config: AgentConfig<TOutput>,
  options: { register: boolean; runtimeOptions?: AgentRuntimeInternalOptions },
): Agent<TOutput> {
  if (typeof config.id === "string" && config.id.trim().length === 0) {
    throw toError(
      createError({
        type: "agent",
        message: "Agent id cannot be empty.",
      }),
    );
  }

  const id = config.id ?? generateAgentId();
  const delegates = normalizeAgentDelegateIds(id, config.delegates);
  const skillsConfig = config.skills === false ? [] : config.skills;
  const shouldAttachAllowedSkillIds = skillsConfig !== undefined;

  const resolveSkillSnapshot = () =>
    skillRegistryInternal.resolveSelectorForAgent(skillsConfig, { agentId: id });

  if (Array.isArray(skillsConfig) && skillsConfig.length > 0) {
    resolveSkillSnapshot();
  }

  const publicConfig: ResolvedAgentConfig = {
    ...config,
    ...(delegates === undefined ? {} : { delegates }),
    ...(config.providerTools === undefined
      ? {}
      : { providerTools: resolveProviderToolsConfiguration(config) }),
    model: resolveConfiguredAgentModel(config.model),
  };

  registerConfiguredLocalTools(config);

  const mergedToolsConfig = resolveToolsConfiguration({
    config,
    id,
    delegates,
    skillTools: resolveSkillToolDisposition(config, id),
    resolveSkillSnapshot,
  });

  const augmentedSystem = createAugmentedSystem({
    config,
    skillLoaderExposed: isSkillLoaderExposed(mergedToolsConfig),
    resolveSkillSnapshot,
  });

  const resolvedMiddleware = resolveSecurityMiddleware(config);

  assertPlatformCompatible(config, id);

  const runtime = new AgentRuntime(id, {
    ...publicConfig,
    tools: mergedToolsConfig,
    system: augmentedSystem,
    middleware: resolvedMiddleware,
  }, options.runtimeOptions);

  const agentInstance = createAgentInstance({
    id,
    publicConfig,
    toolsConfig: mergedToolsConfig,
    runtime,
    resolveSkillSnapshot,
    shouldAttachAllowedSkillIds,
  });

  setEffectiveAgentSystem(agentInstance, augmentedSystem);
  if (options.register) {
    agentRegistry.register(id, agentInstance);
  }

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

/**
 * Names advertised to the model in the system-prompt tool inventory.
 *
 * `tools: true` authorizes the whole catalog but sends only the tools that make
 * the deferred catalog reachable: `tool_search` finds schemas, `load_skill`
 * loads instructions, and `form_input` asks the user. Project tools are
 * deferred and are named by the runtime inventory instead.
 *
 * An explicit map advertises exactly what it authorizes, minus entries switched
 * off with `false`. `undefined` advertises nothing, which is distinct from an
 * empty list: the caller renders no inventory at all.
 */

/** Reject a platform that cannot run this configuration, and warn about the rest. */
function assertPlatformCompatible(config: AgentConfig, id: string): void {
  const compatibility = validatePlatformCompatibility(
    {
      maxSteps: config.maxSteps,
      streaming: config.streaming,
      requiresFileSystem: false,
      requiresMCP: false,
    },
    detectPlatform(),
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
}

/**
 * Register inline tool objects so the runtime can resolve them by id later.
 *
 * Authored entries are normalized in place: an entry whose `id` disagrees with
 * its key is rewritten to match the key, because the key is what the model
 * calls.
 */
function registerConfiguredLocalTools(config: AgentConfig): void {
  if (!config.tools || config.tools === true) return;

  const entries = IntrinsicReflectApply(IntrinsicObjectEntries, Object, [config.tools]) as Array<
    [string, (typeof config.tools)[string]]
  >;
  // Project code may have patched Array.prototype[Symbol.iterator]. Consume
  // the captured Object.entries result by own numeric positions so an iterator
  // cannot inject an additional tool while a restricted agent is rebuilt.
  for (let index = 0; index < entries.length; index++) {
    const pair = entries[index];
    if (pair === undefined) continue;
    const name = pair[0];
    const entry = pair[1];
    if (!entry || typeof entry !== "object") continue;
    assertLocalToolId(name);
    assertLocalToolId(entry.id);
    if (isRuntimeLocalTool(entry)) continue;

    const normalizedTool = entry.id === name ? entry : { ...entry, id: name };
    registerTool(normalizedTool.id, normalizedTool);
    config.tools[name] = normalizedTool;
  }
}

function generateAgentId(): string {
  return `agent_${Date.now()}_${agentIdCounter++}`;
}
