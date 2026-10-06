import { hasTrustedPlatformSource } from "#veryfront/tool/platform-source-provenance.ts";
import { hasTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { withPlatformMcpPolicyAliases } from "../platform-mcp-tool-source.ts";
import { applySourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { isToolAllowedBySourcePolicy } from "#veryfront/tool/platform-tool-policy.ts";
import { observePrivatePromise } from "#veryfront/security/private-promise.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import {
  createRemoteMCPToolSource,
  createToolsFromHostDefinitions,
  type HostToolSet,
  type HostToolTraceAttributes,
  listProjectScopedRemoteToolNames,
  type ProjectScopedRemoteToolOptions,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  type ToolExecutionContext,
  type ToolSet,
  traceHostTools,
  type TraceHostToolsOptions,
} from "#veryfront/tool";
import {
  type DefaultResearchArtifactContext,
  fetchLatestConversationUserText,
  updateDefaultResearchArtifacts,
} from "../artifacts/default-research-artifact-support.ts";
import { type AgentServiceMcpServerConfig } from "../service/mcp-server-config.ts";
import {
  createHostedProjectRemoteToolSource,
  createHostedProjectRemoteToolSources,
  type HostedProjectRemoteToolSourceMutationHandler,
  type HostedProjectRemoteToolSourcePrepareToolInput,
  type HostedProjectRemoteToolSourceProjectSwitchHandler,
  type HostedProjectRemoteToolSourceRetryPolicy,
} from "#veryfront/agent/hosted/project-remote-tool-source.ts";
import { wrapRemoteToolSourceWithMcpPolicy } from "#veryfront/agent/mcp-tool-policy.ts";
import { type RuntimeClientProfile } from "../runtime/client-profile.ts";
import { selectProviderCompatibleToolNames } from "../runtime/provider-tool-compat.ts";
import { getProviderNativeToolNames } from "../runtime/provider-native-tool-inventory.ts";
import { flattenSystemInstructions, withRuntimeToolInventory } from "../runtime/tool-inventory.ts";
import { createAgentKnowledgeSource } from "../runtime/knowledge-tools.ts";
import {
  type HostedRuntimeAllowedToolNames,
  normalizeHostedRuntimeAllowedToolNames,
  resolveHostedRuntimeAllowedToolNames,
} from "./runtime-essential-tools.ts";
import type { HostedSubmittedFormInputResult } from "./chat-runtime-contract.ts";
import {
  isIntegrationToolAllowedBySourcePolicy,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import type { RuntimeToolDiscoveryContext } from "../runtime/tool-discovery-context.ts";
import type { RuntimeToolLoadingMode } from "../runtime/runtime-tool-config.ts";
import { TOOL_SEARCH_TOOL_NAME } from "../runtime/tool-exposure.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { CONFIG_INVALID } from "#veryfront/errors";
import type { AgentConfig } from "../types.ts";

const apply = Reflect.apply;
const arrayIncludes = Array.prototype.includes;
const arraySort = Array.prototype.sort;
const objectEntries = Object.entries;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectSetPrototypeOf = Object.setPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectKeys = Object.keys;
const FRAMEWORK_KNOWLEDGE_TOOL_NAME = "search_knowledge";

function ownEntries<T>(value: Record<string, T>): Array<[string, T]> {
  return apply(objectEntries, Object, [value]) as Array<[string, T]>;
}

function ownKeys<T>(value: Record<string, T>): string[] {
  return apply(objectKeys, Object, [value]) as string[];
}

function hasOwn<T>(value: Record<string, T>, key: PropertyKey): boolean {
  return apply(objectHasOwn, Object, [value, key]) as boolean;
}

function filterValues<T>(
  values: readonly T[],
  predicate: (value: T, index: number, array: readonly T[]) => unknown,
): T[] {
  const filtered: T[] = [];
  for (let index = 0; index < values.length; index++) {
    if (!objectHasOwn(values, index)) continue;
    const value = values[index]!;
    if (!predicate(value, index, values)) continue;
    defineOwnDataProperty(filtered, filtered.length, value, {
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return filtered;
}

function mapValues<T, U>(
  values: readonly T[],
  callback: (value: T, index: number, array: readonly T[]) => U,
): U[] {
  const mapped: U[] = [];
  for (let index = 0; index < values.length; index++) {
    defineOwnDataProperty(
      mapped,
      index,
      callback(values[index]!, index, values),
      { enumerable: true, configurable: true, writable: true },
    );
  }
  return mapped;
}

function sortValues<T>(values: T[], compare: (left: T, right: T) => number): T[] {
  return apply(arraySort, values, [compare]) as T[];
}

function includesValue<T>(values: readonly T[], value: T): boolean {
  return apply(arrayIncludes, values, [value]) as boolean;
}

function recordFromEntries<T>(entries: readonly (readonly [string, T])[]): Record<string, T> {
  const result: Record<string, T> = {};
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry === undefined) continue;
    defineOwnDataProperty(
      result,
      entry[0],
      entry[1],
      { enumerable: true, configurable: true, writable: true },
    );
  }
  return result;
}

function ownDataValue(value: HostToolSet[string], key: PropertyKey): unknown {
  try {
    const descriptor = apply(objectGetOwnPropertyDescriptor, Object, [value, key]);
    return descriptor && objectHasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Context for hosted chat runtime tool assembly. */
export type HostedChatRuntimeToolAssemblyContext = DefaultResearchArtifactContext & {
  authToken: string;
  agentId?: string;
  projectId?: string | null;
  branchId?: string | null;
  model?: string;
  clientProfile?: RuntimeClientProfile | null;
  availableToolNames?: string[];
  availableSkillIds?: readonly string[];
  userId?: string | null;
  submittedFormInputResult?: HostedSubmittedFormInputResult;
};

/** Public API contract for hosted chat runtime allowed tool names. */
export type HostedChatRuntimeAllowedToolNames = HostedRuntimeAllowedToolNames;

/** Service-operator authorization ceiling for Framework-owned host tools. */
export type HostedHostToolPolicy = {
  readonly allow: readonly string[];
};

/** Result returned from hosted chat runtime tool assembly. */
export type HostedChatRuntimeToolAssemblyResult = {
  /** Exact project-source restriction captured for this runtime assembly. */
  readonly sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  runtimeTools: ToolSet;
  remoteToolSources: RemoteToolSource[];
  /** API-backed source used for framework research artifact mirroring. */
  researchArtifactRemoteToolSource?: RemoteToolSource;
  localToolNames: string[];
  remoteToolNames: string[];
  providerToolNames: string[];
  availableToolNames: string[];
  modelVisibleToolNames?: string[];
  toolLoadingMode: RuntimeToolLoadingMode;
  compatibleRemoteToolNames: string[];
  systemInstructions: string;
  /** Structured system messages preserved for provider dispatch. */
  systemMessages?: ChatSystemMessage[];
};

/** Input payload for prepare hosted chat runtime tool assembly. */
export type PrepareHostedChatRuntimeToolAssemblyInput<
  TTraceAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = {
  taskContext: HostedChatRuntimeToolAssemblyContext;
  instructions: string | readonly ChatSystemMessage[];
  /** Re-render instructions after final source/provider tool visibility is known. */
  renderInstructions?: (
    modelVisibleToolNames: readonly string[],
  ) => string | readonly ChatSystemMessage[];
  localTools: HostToolSet;
  hostToolPolicy?: HostedHostToolPolicy;
  apiUrl: string;
  apiMcpUrl: string;
  studioMcpUrl?: string | null;
  mcpServers?: readonly AgentServiceMcpServerConfig[];
  /**
   * Integration tools the control plane resolved for this run, already verified
   * upstream. They widen the Veryfront API MCP allowlist for this run only.
   */
  serverResolvedIntegrationToolNames?: readonly string[];
  conversationId?: string;
  allowedToolNames?: HostedChatRuntimeAllowedToolNames;
  /**
   * Tool names the agent configuration denied explicitly (`false` entries).
   * Removed from the host tool set before runtime-essential preservation, so
   * a denied skill loader cannot be re-added on the hosted path.
   */
  deniedToolNames?: readonly string[];
  allowedProviderToolNames?: HostedChatRuntimeAllowedToolNames;
  /**
   * Provider-native tools the run's model supports, resolved where the run's
   * routing and served catalog are known. Defaults to the inventory for
   * `taskContext.model` as written.
   */
  providerNativeToolNames?: readonly string[];
  /**
   * Include runtime-essential tools when `allowedToolNames` is an empty set.
   * Non-empty selectors remain restrictive.
   */
  includeRuntimeEssentialToolsWhenEmpty?: boolean;
  sourceProviderToolNames?: readonly string[];
  /** Authored tool schema loading mode, resolved before legacy selector defaults. */
  toolLoading?: RuntimeToolLoadingMode;
  /** Authored framework knowledge selector supplied by trusted agent config. */
  knowledge?: AgentConfig["knowledge"];
  projectScopedRemoteToolOptions?: ProjectScopedRemoteToolOptions;
  createRemoteToolSource?: (
    config: RemoteMCPToolSourceConfig,
    server?: AgentServiceMcpServerConfig,
  ) => RemoteToolSource;
  traceLocalTools?: TraceHostToolsOptions<TTraceAttributes>;
  getProjectId?: () => string | null | undefined;
  getActiveBranchId?: () => string | null | undefined;
  prepareRemoteToolInput?: HostedProjectRemoteToolSourcePrepareToolInput;
  shouldRetryWithRemoteTool?: HostedProjectRemoteToolSourceRetryPolicy;
  onSteeringMutation?: HostedProjectRemoteToolSourceMutationHandler;
  onStudioProjectSwitch?: HostedProjectRemoteToolSourceProjectSwitchHandler;
  preloadLatestConversationUserText?: boolean;
  /**
   * Per-run tool activation context. When its `activatedRemoteToolNames` Set is
   * present, it is passed by reference to every remote tool source as the live
   * execution gate, so growing the Set exposes tools without re-creating the
   * sources. Deprecated: no framework path populates this. It is retained
   * because `PrepareHostedChatRuntimeToolAssemblyInput` is public API.
   *
   * @deprecated Use `tool_search` deferred loading. See
   * `docs/architecture/28-model-driven-tool-discovery.md`.
   */
  toolDiscoveryContext?: RuntimeToolDiscoveryContext;
  /** Exact project-source restriction applied before tool inventory is exposed. */
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
};

/** @internal Tool assembly with executor-local facades, without private transport configuration. */
export type PrepareFacadedHostedChatRuntimeToolAssemblyInput<
  TTraceAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> =
  & Omit<
    PrepareHostedChatRuntimeToolAssemblyInput<TTraceAttributes>,
    | "taskContext"
    | "apiUrl"
    | "apiMcpUrl"
    | "studioMcpUrl"
    | "mcpServers"
    | "createRemoteToolSource"
    | "preloadLatestConversationUserText"
  >
  & {
    taskContext: Omit<HostedChatRuntimeToolAssemblyContext, "authToken">;
    remoteToolSources: readonly RemoteToolSource[];
    signal: AbortSignal;
    loadLatestConversationUserText?: (signal: AbortSignal) => Promise<string | null>;
    hostedKnowledgeContext?: HostedKnowledgeExecutionContext;
  };

type FacadedHostedChatRuntimeToolAssemblyResult = HostedChatRuntimeToolAssemblyResult & {
  normalizedAllowedToolNames: ReadonlySet<string> | null;
  authorizedToolNames: string[];
};

/**
 * Widen the Veryfront API MCP server's allowlist with a run's server-resolved
 * integration tools.
 *
 * The product policy that hosts ship is a static allowlist, so a project's
 * connected integration tools are absent from it by construction. This adds
 * exactly the names the control plane resolved for this run, and only to the
 * `veryfront-api` server. A server that denies a name keeps denying it, and an
 * unrestricted server (no `allow`) is left alone because it already permits
 * everything.
 */
export function augmentVeryfrontApiMcpServerPolicy(
  mcpServers: readonly AgentServiceMcpServerConfig[] | undefined,
  integrationToolNames: readonly string[] | undefined,
): readonly AgentServiceMcpServerConfig[] | undefined {
  if (!mcpServers || !integrationToolNames || integrationToolNames.length === 0) {
    return mcpServers;
  }

  return mapValues(mcpServers, (server) => {
    if (server.kind !== "veryfront-api" || !server.toolPolicy?.allow) {
      return server;
    }
    const denied = createPrivateSet(server.toolPolicy.deny ?? []);
    const allow = createPrivateSet(server.toolPolicy.allow);
    for (const toolName of integrationToolNames) {
      if (!denied.has(toolName)) allow.add(toolName);
    }
    return {
      ...server,
      toolPolicy: { ...server.toolPolicy, allow: [...allow] },
    };
  });
}

function withoutDeniedHostTools(
  tools: HostToolSet,
  deniedToolNames: readonly string[] | undefined,
  projectToolNames: ReadonlySet<string>,
): HostToolSet {
  if (!deniedToolNames?.length) {
    return tools;
  }
  const denied = createPrivateSet(deniedToolNames);
  const platformDenied = createPrivateSet(
    withPlatformMcpPolicyAliases({
      deny: filterValues(deniedToolNames, (name) => !projectToolNames.has(name)),
    })?.deny ?? [],
  );
  return recordFromEntries(
    filterValues(ownEntries(tools), (entry) => {
      const shortName = ownDataValue(entry[1], "shortName");
      return !denied.has(entry[0]) &&
        (!hasTrustedHostToolProvenance(entry[1]) || !platformDenied.has(entry[0])) &&
        (typeof shortName !== "string" || !denied.has(shortName));
    }),
  );
}

/**
 * Explicit denials must also hold on the remote path: `allowedToolNames` can
 * be null (no filtering), so a denied MCP-backed tool would stay discoverable
 * and executable. The deny wrapper filters listings and rejects execution.
 */
function withoutDeniedRemoteTool(
  source: RemoteToolSource,
  deniedToolNames: readonly string[] | undefined,
  projectToolNames?: ReadonlySet<string>,
  platformSource = hasTrustedPlatformSource(source),
  innerBoundary = false,
): RemoteToolSource {
  if (!deniedToolNames?.length) {
    return source;
  }
  const exactDeny = mapValues(deniedToolNames, (name) => name);
  const platformDeny = withPlatformMcpPolicyAliases({
    deny: filterValues(exactDeny, (name) => !projectToolNames?.has(name)),
  })?.deny ?? [];
  const deny = platformSource
    ? (innerBoundary ? platformDeny : [...exactDeny, ...platformDeny])
    : exactDeny;
  return wrapRemoteToolSourceWithMcpPolicy(source, { deny }, {
    deniedDetail: (toolName) => `Tool "${toolName}" is denied by the agent configuration`,
  });
}

function withoutDeniedRemoteTools(
  sources: RemoteToolSource[],
  deniedToolNames: readonly string[] | undefined,
  projectToolNames: ReadonlySet<string>,
): RemoteToolSource[] {
  return mapValues(
    sources,
    (source) => withoutDeniedRemoteTool(source, deniedToolNames, projectToolNames),
  );
}

function applyHostedHostToolPolicy(
  tools: HostToolSet,
  policy: HostedHostToolPolicy | undefined,
): HostToolSet {
  if (policy === undefined) {
    return tools;
  }
  const allowed = createPrivateSet(policy.allow);
  return recordFromEntries(
    filterValues(ownEntries(tools), (entry) => {
      const shortName = ownDataValue(entry[1], "shortName");
      return allowed.has(entry[0]) ||
        (typeof shortName === "string" && allowed.has(shortName));
    }),
  );
}

function activeProjectId(
  taskContext: Omit<HostedChatRuntimeToolAssemblyContext, "authToken">,
): string | null {
  return taskContext.projectId || null;
}

function activeBranchId(
  taskContext: Omit<HostedChatRuntimeToolAssemblyContext, "authToken">,
): string | null {
  return taskContext.branchId ?? null;
}

function hasSubmittedFormInputResult(
  taskContext: Omit<HostedChatRuntimeToolAssemblyContext, "authToken">,
): boolean {
  return taskContext.submittedFormInputResult !== undefined;
}

function filterPostFormInputLocalTools(
  tools: HostToolSet,
  taskContext: Omit<HostedChatRuntimeToolAssemblyContext, "authToken">,
): HostToolSet {
  if (!hasSubmittedFormInputResult(taskContext)) {
    return tools;
  }

  const blockedToolNames = createPrivateSet(["form_input", "load_skill"]);
  return recordFromEntries(
    filterValues(ownEntries(tools), (entry) => !blockedToolNames.has(entry[0])),
  );
}

function resolveOwnerScopedToolName(input: {
  toolName: string;
  agentId?: string;
  localTools: HostToolSet;
}): string {
  if (input.agentId === undefined) {
    return input.toolName;
  }

  const entries = ownEntries(input.localTools);
  for (let index = 0; index < entries.length; index++) {
    const pair = entries[index];
    if (pair === undefined) continue;
    const registeredName = pair[0];
    const tool = pair[1];
    if (
      ownDataValue(tool, "ownerAgentId") === input.agentId &&
      ownDataValue(tool, "shortName") === input.toolName
    ) {
      return registeredName;
    }
  }

  return input.toolName;
}

/** @internal Normalize selectors against the owning agent's local tool catalog. */
export function resolveOwnerScopedToolNames(input: {
  toolNames: HostedChatRuntimeAllowedToolNames | undefined;
  agentId?: string;
  localTools: HostToolSet;
}): HostedChatRuntimeAllowedToolNames | undefined {
  const toolNames = normalizeHostedRuntimeAllowedToolNames(input.toolNames);
  if (toolNames === null) {
    return input.toolNames;
  }

  const resolvedToolNames = createPrivateSet<string>();
  for (const toolName of toolNames) {
    resolvedToolNames.add(
      resolveOwnerScopedToolName({
        toolName,
        agentId: input.agentId,
        localTools: input.localTools,
      }),
    );
  }

  return resolvedToolNames;
}

/** Filter hosted chat runtime local tools. */
export function filterHostedChatRuntimeLocalTools(input: {
  tools: HostToolSet;
  allowedToolNames?: HostedChatRuntimeAllowedToolNames;
  sourceProviderToolNames?: readonly string[];
}): HostToolSet {
  const allowedToolNames = normalizeHostedRuntimeAllowedToolNames(input.allowedToolNames);
  const entries = filterValues(
    ownEntries(input.tools),
    (entry) => allowedToolNames ? allowedToolNames.has(entry[0]) : true,
  );

  return recordFromEntries(sortValues(entries, (left, right) => compareStrings(left[0], right[0])));
}

function shouldIncludeHostedWebFetchFallback(input: {
  localTools: HostToolSet;
  sourceProviderToolNames: Set<string>;
  allowedToolNames: ReadonlySet<string> | null;
  allowedProviderToolNames: ReadonlySet<string> | null;
}): boolean {
  if (!hasOwn(input.localTools, "web_fetch")) {
    return false;
  }
  if (input.allowedProviderToolNames !== null) {
    return input.allowedProviderToolNames.has("web_fetch");
  }
  if (input.allowedToolNames !== null) {
    return input.allowedToolNames.has("web_fetch");
  }
  return input.sourceProviderToolNames.has("web_fetch");
}

export type HostedKnowledgeExecutionContext = Pick<
  ToolExecutionContext,
  | "authToken"
  | "projectId"
  | "projectSlug"
  | "productionMode"
  | "releaseId"
  | "branch"
  | "environmentName"
>;

type HostedKnowledgeSourceTaskContext = Omit<HostedChatRuntimeToolAssemblyContext, "authToken"> & {
  authToken?: string;
};

type HostedKnowledgeSourceContext =
  | HostedKnowledgeSourceTaskContext
  | HostedKnowledgeExecutionContext;

function knowledgeContextValue<K extends keyof ToolExecutionContext>(
  context: HostedKnowledgeSourceContext,
  key: K,
): ToolExecutionContext[K] | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(context, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function withHostedKnowledgeExecutionContext(
  context: ToolExecutionContext | undefined,
  taskContext: HostedKnowledgeSourceContext,
): ToolExecutionContext {
  const branch = "branchId" in taskContext
    ? taskContext.branchId
    : knowledgeContextValue(taskContext, "branch");
  const authToken = knowledgeContextValue(taskContext, "authToken");
  const projectId = knowledgeContextValue(taskContext, "projectId");
  const projectSlug = knowledgeContextValue(taskContext, "projectSlug");
  const productionMode = knowledgeContextValue(taskContext, "productionMode");
  const releaseId = knowledgeContextValue(taskContext, "releaseId");
  const environmentName = knowledgeContextValue(taskContext, "environmentName");
  return {
    ...(context ?? {}),
    authToken: typeof authToken === "string" && authToken ? authToken : undefined,
    projectId: projectId ?? undefined,
    projectSlug: typeof projectSlug === "string" && projectSlug ? projectSlug : undefined,
    productionMode: typeof productionMode === "boolean" ? productionMode : undefined,
    releaseId: typeof releaseId === "string" || releaseId === null ? releaseId : undefined,
    environmentName: typeof environmentName === "string" || environmentName === null
      ? environmentName
      : undefined,
    branch: branch ?? null,
  };
}

function createHostedKnowledgeSource(
  knowledge: AgentConfig["knowledge"] | undefined,
  taskContext: HostedKnowledgeSourceContext,
): RemoteToolSource | undefined {
  const source = createAgentKnowledgeSource({
    system: "",
    tools: true,
    knowledge,
  });
  if (source === undefined) return undefined;
  return {
    ...source,
    listTools: (context) =>
      source.listTools(withHostedKnowledgeExecutionContext(context, taskContext)),
    executeTool: (name, input, context) =>
      source.executeTool(name, input, withHostedKnowledgeExecutionContext(context, taskContext)),
  };
}

function assertNoLocalFrameworkKnowledgeToolShadow(input: {
  knowledgeSource: RemoteToolSource | undefined;
  localTools: HostToolSet;
}): void {
  if (input.knowledgeSource === undefined) {
    return;
  }
  if (!hasOwn(input.localTools, FRAMEWORK_KNOWLEDGE_TOOL_NAME)) {
    return;
  }
  throw CONFIG_INVALID.create({
    detail:
      `Local tool "${FRAMEWORK_KNOWLEDGE_TOOL_NAME}" conflicts with the agent knowledge scope. ` +
      "Rename the local tool or remove the knowledge selector.",
  });
}

async function prepareHostedChatRuntimeToolAssemblyInternal<
  TTraceAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input:
    | PrepareHostedChatRuntimeToolAssemblyInput<TTraceAttributes>
    | PrepareFacadedHostedChatRuntimeToolAssemblyInput<TTraceAttributes>,
  configDerivedSelector: boolean,
): Promise<FacadedHostedChatRuntimeToolAssemblyResult> {
  const projectToolNames = createPrivateSet<string>();
  for (const name of ownKeys(input.localTools)) {
    const definition = ownDataValue(input.localTools, name);
    if (typeof definition !== "object" || definition === null) continue;
    const owner = ownDataValue(definition, "ownerAgentId");
    if (
      !name.includes("__") && !hasTrustedHostToolProvenance(definition) &&
      (owner === undefined || owner === input.taskContext.agentId)
    ) {
      projectToolNames.add(name);
      const shortName = ownDataValue(definition, "shortName");
      if (
        owner === input.taskContext.agentId && typeof shortName === "string" &&
        !shortName.includes("__")
      ) projectToolNames.add(shortName);
    }
  }
  const knowledgeContext = "hostedKnowledgeContext" in input
    ? input.hostedKnowledgeContext
    : input.taskContext;
  const knowledgeSource = knowledgeContext === undefined
    ? undefined
    : createHostedKnowledgeSource(input.knowledge, knowledgeContext);
  const authorizedLocalTools = withoutDeniedHostTools(
    applyHostedHostToolPolicy(input.localTools, input.hostToolPolicy),
    input.deniedToolNames,
    projectToolNames,
  );
  assertNoLocalFrameworkKnowledgeToolShadow({
    knowledgeSource,
    localTools: authorizedLocalTools,
  });
  const ownerScopedAllowedToolNames = resolveOwnerScopedToolNames({
    toolNames: input.allowedToolNames,
    agentId: input.taskContext.agentId,
    localTools: authorizedLocalTools,
  });
  const normalizedAllowedToolNames = normalizeHostedRuntimeAllowedToolNames(
    ownerScopedAllowedToolNames,
  );
  const allowedToolNames = resolveHostedRuntimeAllowedToolNames({
    allowedToolNames: normalizedAllowedToolNames,
    localToolNames: ownKeys(authorizedLocalTools),
    availableSkillIds: input.taskContext.availableSkillIds,
    configDerivedSelector: configDerivedSelector ||
      (input.includeRuntimeEssentialToolsWhenEmpty === true &&
        normalizedAllowedToolNames?.size === 0),
  });
  const postFormInputLocalTools = filterPostFormInputLocalTools(
    authorizedLocalTools,
    input.taskContext,
  );
  const selectedLocalTools = filterHostedChatRuntimeLocalTools({
    tools: postFormInputLocalTools,
    allowedToolNames,
    sourceProviderToolNames: input.sourceProviderToolNames,
  });
  const sourceProviderToolNames = createPrivateSet(input.sourceProviderToolNames ?? []);
  const allowedProviderToolNames = normalizeHostedRuntimeAllowedToolNames(
    input.allowedProviderToolNames,
  );
  const providerNativeToolNames = input.providerNativeToolNames ??
    getProviderNativeToolNames({ model: input.taskContext.model });
  const sortedLocalToolEntries = filterValues(
    ownEntries(selectedLocalTools),
    (entry) => isToolAllowedBySourcePolicy(entry[0], input.sourceIntegrationPolicy, entry[1]),
  );
  if (
    !hasOwn(selectedLocalTools, "web_fetch") &&
    shouldIncludeHostedWebFetchFallback({
      localTools: postFormInputLocalTools,
      sourceProviderToolNames,
      allowedToolNames,
      allowedProviderToolNames,
    }) && isIntegrationToolAllowedBySourcePolicy("web_fetch", input.sourceIntegrationPolicy)
  ) {
    const hostedWebFetchTool = postFormInputLocalTools.web_fetch;
    if (hostedWebFetchTool !== undefined) {
      defineOwnDataProperty(
        sortedLocalToolEntries,
        sortedLocalToolEntries.length,
        ["web_fetch", hostedWebFetchTool],
        { enumerable: true, configurable: true, writable: true },
      );
    }
  }
  const sortedLocalTools = recordFromEntries(
    sortValues(sortedLocalToolEntries, (left, right) => compareStrings(left[0], right[0])),
  );
  const localHostTools = input.traceLocalTools
    ? traceHostTools(sortedLocalTools, input.traceLocalTools)
    : sortedLocalTools;
  const createRemoteToolSource = "remoteToolSources" in input
    ? undefined
    : input.createRemoteToolSource ?? createRemoteMCPToolSource;

  const configuredRemoteToolSources = "remoteToolSources" in input
    ? mapValues(input.remoteToolSources, (source) => {
      const sourceOptions: Parameters<typeof createHostedProjectRemoteToolSource>[0] = {
        source: withoutDeniedRemoteTool(
          wrapRemoteToolSourceWithMcpPolicy(
            source,
            allowedToolNames === null ? undefined : { allow: [...allowedToolNames] },
          ),
          input.deniedToolNames,
          projectToolNames,
        ),
        defaultProjectId: () => activeProjectId(input.taskContext),
        getActiveBranchId: () => activeBranchId(input.taskContext),
        allowedToolNames,
        projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
        prepareToolInput: input.prepareRemoteToolInput,
        shouldRetryWithTool: input.shouldRetryWithRemoteTool,
        onProjectSwitch: input.onStudioProjectSwitch,
        onSteeringMutation: input.onSteeringMutation,
      };
      objectSetPrototypeOf(sourceOptions, null);
      return createHostedProjectRemoteToolSource(sourceOptions);
    })
    : createHostedProjectRemoteToolSources({
      authToken: input.taskContext.authToken,
      apiMcpUrl: input.apiMcpUrl,
      studioMcpUrl: input.studioMcpUrl,
      mcpServers: augmentVeryfrontApiMcpServerPolicy(
        input.mcpServers,
        input.serverResolvedIntegrationToolNames,
      ),
      clientProfile: input.taskContext.clientProfile,
      // Project-scoped sources perform retry calls against their input source.
      // Apply the denial at this inner boundary as well as the returned source
      // so a retry cannot invoke a denied companion tool.
      createRemoteToolSource: (config, server) =>
        withoutDeniedRemoteTool(
          createRemoteToolSource!(config, server),
          input.deniedToolNames,
          projectToolNames,
          server?.kind === "veryfront-api",
          true,
        ),
      defaultProjectId: () => activeProjectId(input.taskContext),
      getProjectId: input.getProjectId ?? (() => activeProjectId(input.taskContext)),
      getActiveBranchId: input.getActiveBranchId ?? (() => activeBranchId(input.taskContext)),
      conversationId: input.conversationId,
      allowedToolNames,
      ...(input.toolDiscoveryContext?.activatedRemoteToolNames !== undefined
        ? { activatedRemoteToolNames: input.toolDiscoveryContext.activatedRemoteToolNames }
        : {}),
      projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
      prepareToolInput: input.prepareRemoteToolInput,
      shouldRetryWithTool: input.shouldRetryWithRemoteTool,
      onSteeringMutation: input.onSteeringMutation,
      onStudioProjectSwitch: input.onStudioProjectSwitch,
    });
  const filteredConfiguredRemoteToolSources = withoutDeniedRemoteTools(
    configuredRemoteToolSources,
    input.deniedToolNames,
    projectToolNames,
  );
  const knowledgeRemoteToolSources = knowledgeSource === undefined ? [] : withoutDeniedRemoteTools(
    [
      createHostedProjectRemoteToolSource({
        source: wrapRemoteToolSourceWithMcpPolicy(
          knowledgeSource,
          allowedToolNames === null ? undefined : { allow: [...allowedToolNames] },
        ),
        defaultProjectId: () => activeProjectId(input.taskContext),
        getActiveBranchId: () => activeBranchId(input.taskContext),
        allowedToolNames,
        projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
        prepareToolInput: input.prepareRemoteToolInput,
        shouldRetryWithTool: input.shouldRetryWithRemoteTool,
        onProjectSwitch: input.onStudioProjectSwitch,
        onSteeringMutation: input.onSteeringMutation,
      }),
    ],
    input.deniedToolNames,
    projectToolNames,
  );
  const researchArtifactRemoteToolSource =
    filteredConfiguredRemoteToolSources.find(hasTrustedPlatformSource) ??
      filteredConfiguredRemoteToolSources[0];
  const remoteToolListOptions = {
    sourceIntegrationPolicy: input.sourceIntegrationPolicy,
    projectId: activeProjectId(input.taskContext),
    projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
    ...("remoteToolSources" in input ? { context: { abortSignal: input.signal } } : {}),
  };
  const knowledgeRemoteToolNames = await listProjectScopedRemoteToolNames(
    knowledgeRemoteToolSources,
    remoteToolListOptions,
  );
  const configuredRemoteToolNames = await listProjectScopedRemoteToolNames(
    filteredConfiguredRemoteToolSources,
    remoteToolListOptions,
  );
  if (
    includesValue(knowledgeRemoteToolNames, FRAMEWORK_KNOWLEDGE_TOOL_NAME) &&
    includesValue(configuredRemoteToolNames, FRAMEWORK_KNOWLEDGE_TOOL_NAME)
  ) {
    throw CONFIG_INVALID.create({
      detail:
        `Remote tool "${FRAMEWORK_KNOWLEDGE_TOOL_NAME}" conflicts with the agent knowledge scope. ` +
        "Rename the remote tool or remove the knowledge selector.",
    });
  }
  const remoteToolSources = [
    ...knowledgeRemoteToolSources,
    ...filteredConfiguredRemoteToolSources,
  ];
  const remoteToolNames = sortValues(
    [...createPrivateSet([...knowledgeRemoteToolNames, ...configuredRemoteToolNames])],
    compareStrings,
  );
  const localProviderToolNames = createPrivateSet(
    filterValues(
      ownKeys(sortedLocalTools),
      (toolName) => includesValue(providerNativeToolNames, toolName),
    ),
  );
  // Explicit denials also bind provider-native tools: a denied name must not
  // reach the model through the provider channel after the host and remote
  // paths filtered it out.
  const deniedProviderToolNames = createPrivateSet(input.deniedToolNames ?? []);
  const selectedProviderToolNames = filterValues(
    providerNativeToolNames,
    (toolName) =>
      !deniedProviderToolNames.has(toolName) &&
      !localProviderToolNames.has(toolName) &&
      (allowedProviderToolNames
        ? allowedProviderToolNames.has(toolName)
        : allowedToolNames
        ? allowedToolNames.has(toolName)
        : sourceProviderToolNames.has(toolName)),
  );
  const providerToolNames = applySourceIntegrationPolicy(
    selectedProviderToolNames,
    input.sourceIntegrationPolicy,
  );
  // Materialize before validation and provider capping so skipped descriptors
  // cannot advertise capabilities that the runtime cannot execute.
  const localRuntimeTools = createToolsFromHostDefinitions(localHostTools);
  const localToolNames = ownKeys(localRuntimeTools);
  const toolSearchDenied = deniedProviderToolNames.has(TOOL_SEARCH_TOOL_NAME);
  const requestedToolLoadingMode: RuntimeToolLoadingMode = input.toolLoading ??
    (normalizedAllowedToolNames === null && !toolSearchDenied ? "deferred" : "eager");
  const toolLoadingMode: RuntimeToolLoadingMode = requestedToolLoadingMode === "deferred" &&
      toolSearchDenied
    ? "eager"
    : requestedToolLoadingMode;
  const authorizedToolNames = [
    ...createPrivateSet([...localToolNames, ...providerToolNames, ...remoteToolNames]),
  ];
  sortValues(authorizedToolNames, compareStrings);
  // Deferred mode sends only bootstrap/search plus explicitly loaded schemas to
  // the model, so the provider schema limit must not truncate its searchable or
  // executable authorization catalog. Eager mode still needs an up-front cap.
  const availableToolNames = toolLoadingMode === "deferred"
    ? authorizedToolNames
    : selectProviderCompatibleToolNames(authorizedToolNames, {
      model: input.taskContext.model,
      requiredToolNames: localToolNames,
    });
  const compatibleToolNames = createPrivateSet(availableToolNames);
  const compatibleLocalRuntimeTools = toolLoadingMode === "deferred"
    ? localRuntimeTools
    : recordFromEntries(
      filterValues(ownEntries(localRuntimeTools), (entry) => compatibleToolNames.has(entry[0])),
    );
  const compatibleLocalToolNames = ownKeys(compatibleLocalRuntimeTools);
  const compatibleRemoteToolNames = toolLoadingMode === "deferred"
    ? remoteToolNames
    : filterValues(remoteToolNames, (toolName) => compatibleToolNames.has(toolName));
  const compatibleProviderToolNames = toolLoadingMode === "deferred"
    ? providerToolNames
    : filterValues(providerToolNames, (toolName) => compatibleToolNames.has(toolName));
  const bootstrapToolNames = filterValues(
    availableToolNames,
    (toolName) => toolName === "load_skill",
  );
  const hasDeferredTools = availableToolNames.length > bootstrapToolNames.length;
  const modelVisibleToolNames = toolLoadingMode === "deferred"
    ? sortValues(
      [
        ...bootstrapToolNames,
        ...(hasDeferredTools && !toolSearchDenied ? [TOOL_SEARCH_TOOL_NAME] : []),
      ],
      compareStrings,
    )
    : availableToolNames;

  input.taskContext.availableToolNames = modelVisibleToolNames;
  const modelInstructions = input.renderInstructions?.(modelVisibleToolNames) ??
    input.instructions;
  const instructionsWithToolInventory = withRuntimeToolInventory(
    modelInstructions,
    modelVisibleToolNames,
  );
  let preparedInstructions = typeof modelInstructions === "string"
    ? flattenSystemInstructions(instructionsWithToolInventory)
    : instructionsWithToolInventory;

  if ("remoteToolSources" in input) {
    if (input.loadLatestConversationUserText) {
      preparedInstructions = updateDefaultResearchArtifacts({
        taskContext: input.taskContext,
        latestUserText: await observePrivatePromise(
          input.loadLatestConversationUserText(input.signal),
        ),
        system: preparedInstructions,
      });
    }
  } else if (input.preloadLatestConversationUserText !== false) {
    const latestUserText = await fetchLatestConversationUserText({
      apiUrl: input.apiUrl,
      authToken: input.taskContext.authToken,
      conversationId: input.conversationId,
    });
    preparedInstructions = updateDefaultResearchArtifacts({
      taskContext: input.taskContext,
      latestUserText,
      system: preparedInstructions,
    });
  }

  const systemInstructions = typeof preparedInstructions === "string"
    ? preparedInstructions
    : flattenSystemInstructions(preparedInstructions);
  const systemMessages = typeof preparedInstructions === "string"
    ? undefined
    : preparedInstructions;

  const result: FacadedHostedChatRuntimeToolAssemblyResult = {
    normalizedAllowedToolNames,
    authorizedToolNames,
    sourceIntegrationPolicy: input.sourceIntegrationPolicy,
    runtimeTools: compatibleLocalRuntimeTools,
    remoteToolSources,
    ...(researchArtifactRemoteToolSource === undefined ? {} : { researchArtifactRemoteToolSource }),
    localToolNames: compatibleLocalToolNames,
    remoteToolNames,
    providerToolNames: compatibleProviderToolNames,
    availableToolNames,
    modelVisibleToolNames,
    toolLoadingMode,
    compatibleRemoteToolNames,
    systemInstructions,
    ...(systemMessages === undefined ? {} : { systemMessages }),
  };
  if ("remoteToolSources" in input) objectSetPrototypeOf(result, null);
  return result;
}

/** Prepare hosted chat runtime tool assembly. */
export function prepareHostedChatRuntimeToolAssembly<
  TTraceAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: PrepareHostedChatRuntimeToolAssemblyInput<TTraceAttributes>,
): Promise<HostedChatRuntimeToolAssemblyResult> {
  return prepareHostedChatRuntimeToolAssemblyInternal(input, false);
}

/** @internal Prepare an assembly whose selector provenance was verified by the hosted runtime. */
export function prepareConfigDerivedHostedChatRuntimeToolAssembly<
  TTraceAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: PrepareHostedChatRuntimeToolAssemblyInput<TTraceAttributes>,
): Promise<HostedChatRuntimeToolAssemblyResult> {
  return prepareHostedChatRuntimeToolAssemblyInternal(
    input,
    input.includeRuntimeEssentialToolsWhenEmpty === true,
  );
}

/** @internal Use prepared operation facades without constructing credentialed clients. */
export function prepareFacadedHostedChatRuntimeToolAssembly(
  input: PrepareFacadedHostedChatRuntimeToolAssemblyInput,
): Promise<FacadedHostedChatRuntimeToolAssemblyResult> {
  return prepareHostedChatRuntimeToolAssemblyInternal(
    input,
    input.includeRuntimeEssentialToolsWhenEmpty === true,
  );
}
