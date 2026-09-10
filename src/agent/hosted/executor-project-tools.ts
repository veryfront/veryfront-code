import { defineSchema } from "#veryfront/schemas/index.ts";
import { copyPrivateSet, createPrivateSet } from "#veryfront/security/private-set.ts";
import { copyPrivateMap, createPrivateMap } from "#veryfront/security/private-map.ts";
import {
  filterPrivateArray,
  mapPrivateArray,
  pushPrivateArray,
  somePrivateArray,
} from "#veryfront/security/private-array.ts";
import { chainPrivatePromise, resolvePrivatePromise } from "#veryfront/security/private-promise.ts";
import { captureExecutorProjectCallContext } from "#veryfront/agent/hosted/executor-project-context.ts";
import type { ExecutorChannel, ExecutorOperation } from "#veryfront/agent/executor/channel.ts";
import {
  type ExecutorBinding,
  getExecutorBindingSchema,
} from "#veryfront/agent/executor/protocol.ts";
import type { RemoteToolSource, Tool, ToolExecutionContext } from "#veryfront/tool/types.ts";
import { isToolVisibleTo } from "#veryfront/tool/executor.ts";
import { toolToProviderDefinition } from "#veryfront/tool/registry.ts";
import { isSkillInfrastructureToolId } from "#veryfront/skill/types.ts";
import {
  createExecutorToolBroker,
  type ExecutorToolCapability,
} from "#veryfront/agent/hosted/executor-tool-bridge.ts";
import { createExecutorRemoteToolSources } from "#veryfront/agent/hosted/executor-tool-remote-facade.ts";
import {
  EXECUTOR_TOOL_LIMITS,
  executorToolBytes,
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
const apply = Reflect.apply;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;

export interface ExecutorProjectToolSource extends RemoteToolSource {
  readonly aliases: readonly { readonly name: string; readonly shortName: string }[];
}

export interface ExecutorProjectToolContext {
  agentId: string;
  projectId: string;
  userId?: string;
  projectSlug?: string;
  execution: { kind: "canonical"; runId: string } | { kind: "ephemeral" };
}

const getContextSchema = defineSchema((v) =>
  v.object({
    agentId: getExecutorToolIdSchema(),
    projectId: getExecutorToolIdSchema(),
    userId: getExecutorToolIdSchema().optional(),
    projectSlug: getExecutorToolIdSchema().optional(),
    execution: v.discriminatedUnion("kind", [
      v.object({ kind: v.literal("canonical"), runId: getExecutorToolIdSchema() }).strict(),
      v.object({ kind: v.literal("ephemeral") }).strict(),
    ]),
  }).strict()
);

function captureContext(input: ExecutorProjectToolContext) {
  const context = parseExecutorToolData(getContextSchema(), input);
  return freeze({
    agentId: context.agentId,
    projectId: context.projectId,
    ...(context.userId === undefined ? {} : { userId: context.userId }),
    ...(context.projectSlug === undefined ? {} : { projectSlug: context.projectSlug }),
    runIdBindsToolAuthorization: context.execution.kind === "canonical",
    ...(context.execution.kind === "canonical" ? { runId: context.execution.runId } : {}),
  });
}

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
  /** Restore the exact project source policy while invoking project code. */
  runWithProjectRuntime?: <T>(fn: () => T) => T;
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
  const result = copyPrivateSet(names, limits.maxToolsPerSource);
  if (result.size > limits.maxToolsPerSource) {
    throw new TypeError("Project tool allowlist exceeds its limit");
  }
  for (const name of result) parseExecutorToolData(getExecutorToolIdSchema(), name);
  return result;
}

/** Own selected call fields only; unrelated host context is never enumerated. */
function callField<K extends keyof ToolExecutionContext>(
  context: ToolExecutionContext | undefined,
  key: K,
): ToolExecutionContext[K] {
  if (context === undefined) return undefined;
  const descriptor = getOwnPropertyDescriptor(context, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) throw new TypeError("Invalid project tool call context");
  return descriptor.value;
}

/** Install only project-tool operations. Construction receives no private host capabilities. */
export function createExecutorProjectToolOperations(
  options: ExecutorProjectToolOperationsOptions,
): ReadonlyMap<string, ExecutorOperation> {
  const fixed = captureContext(options.context);
  const limits = executorToolLimits(options.limits);
  const allowed = captureNames(options.allowedToolNames, limits);
  const tools = copyPrivateMap(options.tools, limits.maxTotalTools);
  if (tools.size > limits.maxTotalTools) {
    throw new TypeError("Project tool catalog exceeds its limit");
  }
  const catalog = createPrivateMap<string, {
    definition: ReturnType<typeof toolToProviderDefinition>;
    execute: Tool["execute"];
  }>();
  const aliases: { name: string; shortName: string }[] = [];
  for (const [name, registered] of tools) {
    if (
      !allowed.has(name) || isSkillInfrastructureToolId(name) ||
      !isToolVisibleTo(registered, { agentId: fixed.agentId })
    ) continue;
    if (typeof registered.execute !== "function") throw new TypeError("Invalid project tool");
    const callback = registered.execute;
    const execute: Tool["execute"] = (args, context) => {
      const invoke = () => apply(callback, registered, [args, context]);
      return options.runWithProjectRuntime === undefined
        ? invoke()
        : options.runWithProjectRuntime(invoke);
    };
    const definition = executorToolDefinition({
      ...toolToProviderDefinition(registered),
      name,
    }, limits);
    catalog.set(name, { definition, execute });
    if (registered.ownerAgentId === fixed.agentId && registered.shortName !== undefined) {
      pushPrivateArray(aliases, {
        name,
        shortName: parseExecutorToolData(getExecutorToolIdSchema(), registered.shortName),
      });
    }
  }
  const source: RemoteToolSource = {
    id: EXECUTOR_PROJECT_TOOL_SOURCE_ID,
    listTools: () =>
      chainPrivatePromise(
        resolvePrivatePromise(),
        () =>
          mapPrivateArray([...catalog.values()], ({ definition }) =>
            executorToolDefinition(definition, limits)),
      ),
    async executeTool(name, args, context) {
      const selected = catalog.get(name);
      if (!selected || !context?.toolCallId) {
        throw new TypeError("Project tool call is not allowed");
      }
      return await selected.execute(args, {
        ...fixed,
        ...captureExecutorProjectCallContext(context),
        toolCallId: context.toolCallId,
        ...(context.progressToken === undefined ? {} : { progressToken: context.progressToken }),
        abortSignal: context.abortSignal,
        publishDataEvent: context.publishDataEvent,
      });
    },
  };
  const sources = createPrivateMap<string, ExecutorToolCapability>();
  sources.set(source.id, {
    source,
    allowedToolNames: createPrivateSet(catalog.keys()),
    context: fixed,
    projectContext: "skill",
  });
  const operations = copyPrivateMap(createExecutorToolBroker({
    scope: options.scope,
    sources,
    maxCalls: options.maxCalls,
    maxConcurrent: options.maxConcurrent,
    limits,
  }));
  const binding = parseExecutorToolData(getExecutorBindingSchema(), options.scope.binding);
  const signal = options.scope.signal;
  const assertScope = options.scope.assertActive;
  const assertActive = () => apply(assertScope, options.scope, []);
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
  const fixed = captureContext(options.context);
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
    for (
      const key of [
        "agentId",
        "runId",
        "projectId",
        "runIdBindsToolAuthorization",
        "userId",
        "projectSlug",
      ] as const
    ) {
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
      ...captureExecutorProjectCallContext(context),
      toolCallId: correlation.toolCallId,
      progressToken: correlation.progressToken,
      abortSignal,
      ...(publish === undefined ? {} : {
        publishDataEvent: async (event) => {
          check();
          await apply(publish, context, [event]);
          check();
        },
      }),
    };
  };
  check();
  const metadata = parseExecutorToolData(
    getAliasesSchema(),
    await channel.request(TOOL_ALIASES_OPERATION, {}, { signal }),
  );
  check();
  const remainingMetadataBytes = limits.maxMetadataBytes - executorToolBytes(metadata);
  if (
    metadata.agentId !== fixed.agentId || metadata.aliases.length > limits.maxToolsPerSource ||
    remainingMetadataBytes < 1
  ) {
    throw new TypeError("Project tool metadata owner mismatch");
  }
  const sources = await createExecutorRemoteToolSources({
    channel,
    signal,
    limits: { ...limits, maxMetadataBytes: remainingMetadataBytes },
    projectContextSources: createPrivateSet([EXECUTOR_PROJECT_TOOL_SOURCE_ID]),
  });
  check();
  if (sources.length !== 1 || sources[0]?.id !== EXECUTOR_PROJECT_TOOL_SOURCE_ID) {
    throw new TypeError("Invalid project tool source");
  }
  const remote = sources[0];
  const definitions = await remote.listTools();
  check();
  const catalog = createPrivateMap<string, (typeof definitions)[number]>();
  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index]!;
    if (allowed.has(definition.name)) catalog.set(definition.name, definition);
  }
  const aliases = createPrivateMap<string, string>();
  for (let index = 0; index < metadata.aliases.length; index++) {
    const entry = metadata.aliases[index]!;
    if (
      !somePrivateArray(definitions, (definition) => definition.name === entry.name) ||
      aliases.has(entry.shortName)
    ) {
      throw new TypeError("Invalid project tool aliases");
    }
    aliases.set(entry.shortName, entry.name);
  }
  return freeze({
    id: EXECUTOR_PROJECT_TOOL_SOURCE_ID,
    aliases: freeze(
      mapPrivateArray(
        filterPrivateArray([...aliases], (entry) => catalog.has(entry[1])),
        (entry) => freeze({ name: entry[1], shortName: entry[0] }),
      ),
    ),
    async listTools(context?: ToolExecutionContext) {
      projectContext(context);
      return mapPrivateArray(
        [...catalog.values()],
        (definition) => executorToolDefinition(definition, limits),
      );
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
