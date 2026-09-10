import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ExecutorChannel, ExecutorOperation } from "#veryfront/agent/executor/channel.ts";
import {
  type ExecutorBinding,
  getExecutorBindingSchema,
} from "#veryfront/agent/executor/protocol.ts";
import type { RemoteToolSource, Tool, ToolExecutionContext } from "#veryfront/tool/types.ts";
import { isToolVisibleTo } from "#veryfront/tool/executor.ts";
import { toolToProviderDefinition } from "#veryfront/tool/registry.ts";
import { isSkillInfrastructureToolId } from "#veryfront/skill/types.ts";
import { createExecutorToolBroker } from "#veryfront/agent/hosted/executor-tool-bridge.ts";
import { createExecutorRemoteToolSources } from "#veryfront/agent/hosted/executor-tool-remote-facade.ts";
import {
  EXECUTOR_TOOL_LIMITS,
  executorToolDefinition,
  type ExecutorToolLimits,
  executorToolLimits,
  getExecutorToolCallSchema,
  getExecutorToolEmptySchema,
  getExecutorToolIdSchema,
  getExecutorToolListSchema,
  parseExecutorToolData,
} from "#veryfront/agent/hosted/executor-tool-schema.ts";

export const EXECUTOR_PROJECT_TOOL_SOURCE_ID = "project";
const TOOL_ALIASES_OPERATION = "project.tool-aliases";

export interface ExecutorProjectToolSource extends RemoteToolSource {
  readonly aliases: readonly { readonly name: string; readonly shortName: string }[];
}

export interface ExecutorProjectToolContext {
  agentId: string;
  runId: string;
  projectId: string;
}

const getContextSchema = defineSchema((v) =>
  v.object({
    agentId: getExecutorToolIdSchema(),
    runId: getExecutorToolIdSchema(),
    projectId: getExecutorToolIdSchema(),
  }).strict()
);

const getAliasesSchema = defineSchema((v) =>
  v.object({
    agentId: getExecutorToolIdSchema(),
    aliases: v.array(
      v.object({ name: getExecutorToolIdSchema(), shortName: getExecutorToolIdSchema() }).strict(),
    ).max(EXECUTOR_TOOL_LIMITS.maxToolsPerSource),
  }).strict()
);

export interface ExecutorProjectToolOperationsOptions {
  scope: { binding: ExecutorBinding; signal: AbortSignal; assertActive(): void };
  context: ExecutorProjectToolContext;
  tools: ReadonlyMap<string, Tool>;
  allowedToolNames: ReadonlySet<string>;
  maxCalls: number;
  maxConcurrent: number;
  limits?: Partial<ExecutorToolLimits>;
}

export interface ExecutorProjectToolSourceOptions {
  channel: ExecutorChannel;
  signal: AbortSignal;
  context: ExecutorProjectToolContext;
  allowedToolNames: ReadonlySet<string>;
  assertActive(): void;
  limits?: Partial<ExecutorToolLimits>;
}

function captureNames(names: ReadonlySet<string>, limits: ExecutorToolLimits): Set<string> {
  const result = new Set<string>();
  for (const name of names) {
    if (result.size >= limits.maxToolsPerSource) {
      throw new TypeError("Project tool allowlist exceeds its limit");
    }
    result.add(parseExecutorToolData(getExecutorToolIdSchema(), name));
  }
  return result;
}

/** Own selected call fields only; unrelated host context is never enumerated. */
function callField<K extends keyof ToolExecutionContext>(
  context: ToolExecutionContext | undefined,
  key: K,
): ToolExecutionContext[K] {
  if (context === undefined) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(context, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, "value")) throw new TypeError("Invalid project tool call context");
  return descriptor.value;
}

/** Install only project-tool operations. Construction receives no private host capabilities. */
export function createExecutorProjectToolOperations(
  options: ExecutorProjectToolOperationsOptions,
): ReadonlyMap<string, ExecutorOperation> {
  const fixed = Object.freeze(parseExecutorToolData(getContextSchema(), options.context));
  const limits = executorToolLimits(options.limits);
  const allowed = captureNames(options.allowedToolNames, limits);
  if (options.tools.size > limits.maxTotalTools) {
    throw new TypeError("Project tool catalog exceeds its limit");
  }
  const catalog = new Map<string, {
    definition: ReturnType<typeof toolToProviderDefinition>;
    execute: Tool["execute"];
  }>();
  const aliases: { name: string; shortName: string }[] = [];
  for (const [name, registered] of options.tools) {
    if (
      !allowed.has(name) || isSkillInfrastructureToolId(name) ||
      !isToolVisibleTo(registered, { agentId: fixed.agentId })
    ) continue;
    if (typeof registered.execute !== "function") throw new TypeError("Invalid project tool");
    const execute = registered.execute.bind(registered);
    const definition = executorToolDefinition({
      ...toolToProviderDefinition(registered),
      name,
    }, limits);
    catalog.set(name, { definition, execute });
    if (registered.ownerAgentId === fixed.agentId && registered.shortName !== undefined) {
      aliases.push({
        name,
        shortName: parseExecutorToolData(getExecutorToolIdSchema(), registered.shortName),
      });
    }
  }
  const source: RemoteToolSource = {
    id: EXECUTOR_PROJECT_TOOL_SOURCE_ID,
    listTools: () =>
      Promise.resolve(
        [...catalog.values()].map(({ definition }) => executorToolDefinition(definition, limits)),
      ),
    async executeTool(name, args, context) {
      const selected = catalog.get(name);
      if (!selected || !context?.toolCallId) {
        throw new TypeError("Project tool call is not allowed");
      }
      return await selected.execute(args, {
        ...fixed,
        toolCallId: context.toolCallId,
        ...(context.progressToken === undefined ? {} : { progressToken: context.progressToken }),
        abortSignal: context.abortSignal,
        publishDataEvent: context.publishDataEvent,
      });
    },
  };
  const operations = new Map(createExecutorToolBroker({
    scope: options.scope,
    sources: new Map([[source.id, {
      source,
      allowedToolNames: new Set(catalog.keys()),
      context: fixed,
    }]]),
    maxCalls: options.maxCalls,
    maxConcurrent: options.maxConcurrent,
    limits,
  }));
  const binding = parseExecutorToolData(getExecutorBindingSchema(), options.scope.binding);
  const signal = options.scope.signal;
  const assertActive = options.scope.assertActive.bind(options.scope);
  let described = false;
  operations.set(TOOL_ALIASES_OPERATION, {
    mode: "unary",
    handle(value, context) {
      parseExecutorToolData(getExecutorToolEmptySchema(), value);
      assertActive();
      signal.throwIfAborted();
      context.signal.throwIfAborted();
      if (
        described || context.deadline <= Date.now() ||
        binding.allocationId !== context.binding.allocationId ||
        binding.invocationId !== context.binding.invocationId ||
        binding.generation !== context.binding.generation
      ) {
        throw new TypeError("Project tool metadata is unavailable");
      }
      described = true;
      return parseExecutorToolData(getAliasesSchema(), { agentId: fixed.agentId, aliases });
    },
  });
  return operations;
}

/** Trusted peer adapter. Peer metadata never enlarges the invocation's tool grant. */
export async function createExecutorProjectToolSource(
  options: ExecutorProjectToolSourceOptions,
): Promise<ExecutorProjectToolSource> {
  const fixed = Object.freeze(parseExecutorToolData(getContextSchema(), options.context));
  const limits = executorToolLimits(options.limits);
  const allowed = captureNames(options.allowedToolNames, limits);
  const { channel, signal, assertActive } = options;
  const check = () => {
    assertActive();
    signal.throwIfAborted();
    channel.signal.throwIfAborted();
  };
  const projectContext = (context?: ToolExecutionContext): ToolExecutionContext => {
    check();
    for (const key of ["agentId", "runId", "projectId"] as const) {
      const requested = callField(context, key);
      if (requested !== undefined && requested !== fixed[key]) {
        throw new TypeError("Project tool call identity mismatch");
      }
    }
    const toolCallId = callField(context, "toolCallId");
    const progressToken = callField(context, "progressToken");
    const correlation = parseExecutorToolData(getExecutorToolListSchema(), {
      sourceId: EXECUTOR_PROJECT_TOOL_SOURCE_ID,
      ...(toolCallId === undefined ? {} : { toolCallId }),
      ...(progressToken === undefined ? {} : { progressToken }),
    });
    const abortSignal = callField(context, "abortSignal");
    abortSignal?.throwIfAborted();
    const publish = callField(context, "publishDataEvent");
    return {
      toolCallId: correlation.toolCallId,
      progressToken: correlation.progressToken,
      abortSignal,
      ...(publish === undefined ? {} : {
        publishDataEvent: async (event) => {
          check();
          await publish.call(context, event);
          check();
        },
      }),
    };
  };
  check();
  const sources = await createExecutorRemoteToolSources({ channel, signal, limits });
  check();
  if (sources.length !== 1 || sources[0]?.id !== EXECUTOR_PROJECT_TOOL_SOURCE_ID) {
    throw new TypeError("Invalid project tool source");
  }
  const remote = sources[0];
  const definitions = await remote.listTools();
  check();
  const metadata = parseExecutorToolData(
    getAliasesSchema(),
    await channel.request(TOOL_ALIASES_OPERATION, {}, { signal }),
  );
  check();
  if (metadata.agentId !== fixed.agentId) {
    throw new TypeError("Project tool metadata owner mismatch");
  }
  const catalog = new Map(
    definitions.filter((definition) => allowed.has(definition.name)).map(
      (definition) => [definition.name, definition] as const,
    ),
  );
  const aliases = new Map<string, string>();
  for (const entry of metadata.aliases) {
    if (
      !definitions.some((definition) => definition.name === entry.name) ||
      aliases.has(entry.shortName)
    ) {
      throw new TypeError("Invalid project tool aliases");
    }
    aliases.set(entry.shortName, entry.name);
  }
  return Object.freeze({
    id: EXECUTOR_PROJECT_TOOL_SOURCE_ID,
    aliases: Object.freeze(
      [...aliases].filter(([, name]) => catalog.has(name)).map(([shortName, name]) =>
        Object.freeze({ name, shortName })
      ),
    ),
    async listTools(context?: ToolExecutionContext) {
      projectContext(context);
      return [...catalog.values()].map((definition) => executorToolDefinition(definition, limits));
    },
    async executeTool(name: string, args: Record<string, unknown>, context?: ToolExecutionContext) {
      const call = projectContext(context);
      if (!call.toolCallId || !catalog.has(name)) {
        throw new TypeError("Project tool call is not allowed");
      }
      // Validate locally before writing even one frame to the project connection.
      parseExecutorToolData(getExecutorToolCallSchema(), {
        sourceId: EXECUTOR_PROJECT_TOOL_SOURCE_ID,
        toolName: name,
        args,
        toolCallId: call.toolCallId,
        ...(call.progressToken === undefined ? {} : { progressToken: call.progressToken }),
      });
      const result = await remote.executeTool(name, args, call);
      check();
      return result;
    },
  });
}
