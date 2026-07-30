import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { applySourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  listProjectScopedRemoteToolNames,
  type ProjectScopedRemoteToolOptions,
} from "#veryfront/tool";
import type {
  DefaultHostedChatRuntimeSystemRefreshInput,
  DefaultHostedChatRuntimeTaskContext,
} from "./default-chat-runtime.ts";
import type { HostedChatRuntimePreparationSteering } from "./chat-preparation.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import {
  resolveRuntimeSkillSelectorSnapshotForAgent,
  type RuntimeSkillDefinition,
} from "../runtime/skill-metadata.ts";
import { selectProviderCompatibleToolNames } from "../runtime/provider-tool-compat.ts";
import { flattenSystemInstructions, withRuntimeToolInventory } from "../runtime/tool-inventory.ts";
import type { HostedChatRuntimeInstructionsInput } from "./chat-preparation.ts";
import { resolveHostedToolExecutionIdentity } from "./runtime-state-resolver.ts";
import {
  assertResolvedSkillSelector,
  createNoneSkillSelectorSnapshot,
  type ResolvedSkillSelectorPolicy,
} from "#veryfront/skill/selector.ts";

/** Public API contract for default hosted project steering refresh logger. */
export type DefaultHostedProjectSteeringRefreshLogger = {
  error(message: string, metadata?: Record<string, unknown>): void;
};

/** Public API contract for default hosted project steering refresh lookup. */
export type DefaultHostedProjectSteeringRefreshLookup = {
  projectId: string;
  authToken: string;
  branchId?: string | null;
  /** Cancellation authority for this steering read. */
  signal?: AbortSignal;
};

/** Public API contract for default hosted project steering fetchers. */
export type DefaultHostedProjectSteeringFetchers = {
  fetchProjectInstructions: (
    lookup: DefaultHostedProjectSteeringRefreshLookup,
  ) => Promise<string>;
  fetchSkills: (
    lookup: DefaultHostedProjectSteeringRefreshLookup,
  ) => Promise<RuntimeSkillDefinition[]>;
};

/** Options accepted by create default hosted project steering refresh. */
export type CreateDefaultHostedProjectSteeringRefreshOptions =
  & DefaultHostedProjectSteeringFetchers
  & {
    buildInstructions: (
      input: HostedChatRuntimeInstructionsInput<RuntimeAgentMarkdownDefinition>,
    ) => string | ChatSystemMessage[];
    projectScopedRemoteToolOptions?: ProjectScopedRemoteToolOptions;
    logger?: DefaultHostedProjectSteeringRefreshLogger;
  };

/** Input payload for fetch default hosted project steering. */
export type FetchDefaultHostedProjectSteeringInput =
  & DefaultHostedProjectSteeringFetchers
  & {
    projectId: string | null;
    authToken: string;
    branchId?: string | null;
    trace?: <TResult>(
      operationName: string,
      operation: () => Promise<TResult>,
    ) => Promise<TResult>;
    traceOperationName?: string;
    signal?: AbortSignal;
  };

function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined
    ? new DOMException("The operation was aborted", "AbortError")
    : signal.reason;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw getAbortReason(signal);
  }
}

function createSteeringFetchScope(signal: AbortSignal | undefined): {
  signal: AbortSignal | undefined;
  abort: (reason: unknown) => void;
  dispose: () => void;
} {
  if (!signal) {
    return {
      signal: undefined,
      abort: () => undefined,
      dispose: () => undefined,
    };
  }

  const controller = new AbortController();
  const forwardAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(getAbortReason(signal));
    }
  };
  signal.addEventListener("abort", forwardAbort, { once: true });
  if (signal.aborted) {
    forwardAbort();
  }

  return {
    signal: controller.signal,
    abort: (reason) => {
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    },
    dispose: () => signal.removeEventListener("abort", forwardAbort),
  };
}

function buildSteeringLookup(input: {
  projectId: string;
  authToken: string;
  branchId?: string | null;
  signal?: AbortSignal;
}): DefaultHostedProjectSteeringRefreshLookup {
  return {
    projectId: input.projectId,
    authToken: input.authToken,
    branchId: input.branchId,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
}

/** Fetch default hosted project steering helper. */
export async function fetchDefaultHostedProjectSteering(
  input: FetchDefaultHostedProjectSteeringInput,
): Promise<HostedChatRuntimePreparationSteering> {
  const projectId = input.projectId;

  if (!projectId) {
    return { instructions: "", skills: [] };
  }

  throwIfAborted(input.signal);
  const fetchScope = createSteeringFetchScope(input.signal);
  const fetchSteering = async () => {
    const lookup = buildSteeringLookup({
      projectId,
      authToken: input.authToken,
      branchId: input.branchId,
      signal: fetchScope.signal,
    });
    const runSibling = <T>(operation: () => Promise<T>): Promise<T> =>
      Promise.resolve()
        .then(operation)
        .catch((error) => {
          fetchScope.abort(error);
          throw error;
        });
    const [instructions, skills] = await Promise.all([
      runSibling(() => input.fetchProjectInstructions(lookup)),
      runSibling(() => input.fetchSkills(lookup)),
    ]);

    throwIfAborted(fetchScope.signal);
    return {
      instructions,
      skills,
    };
  };

  try {
    if (!input.trace) {
      return await fetchSteering();
    }

    return await input.trace(
      input.traceOperationName ?? "agent.fetchProjectSteering",
      fetchSteering,
    );
  } catch (error) {
    fetchScope.abort(error);
    throw error;
  } finally {
    fetchScope.dispose();
  }
}

function getActiveProjectId(taskContext: DefaultHostedChatRuntimeTaskContext): string | null {
  return taskContext.projectId || null;
}

function getActiveBranchId(taskContext: DefaultHostedChatRuntimeTaskContext): string | null {
  return taskContext.branchId ?? null;
}

async function fetchProjectInstructionsWithFallback(input: {
  options: CreateDefaultHostedProjectSteeringRefreshOptions;
  taskContext: DefaultHostedChatRuntimeTaskContext;
  projectId: string;
  branchId: string | null;
  initialProjectInstructions: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  try {
    return await input.options.fetchProjectInstructions(
      buildSteeringLookup({
        projectId: input.projectId,
        authToken: input.taskContext.authToken,
        branchId: input.branchId,
        signal: input.abortSignal,
      }),
    );
  } catch (error) {
    throwIfAborted(input.abortSignal);
    input.options.logger?.error(
      "Refreshing project instructions failed during hosted runtime steering update",
      {
        projectId: input.projectId,
        branchId: input.branchId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return input.initialProjectInstructions;
  }
}

async function fetchSkillsWithFallback(input: {
  options: CreateDefaultHostedProjectSteeringRefreshOptions;
  taskContext: DefaultHostedChatRuntimeTaskContext;
  projectId: string;
  branchId: string | null;
  initialSkills: readonly RuntimeSkillDefinition[];
  abortSignal?: AbortSignal;
}): Promise<readonly RuntimeSkillDefinition[]> {
  try {
    return await input.options.fetchSkills(
      buildSteeringLookup({
        projectId: input.projectId,
        authToken: input.taskContext.authToken,
        branchId: input.branchId,
        signal: input.abortSignal,
      }),
    );
  } catch (error) {
    throwIfAborted(input.abortSignal);
    input.options.logger?.error(
      "Refreshing skills failed during hosted runtime steering update",
      {
        projectId: input.projectId,
        branchId: input.branchId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return input.initialSkills;
  }
}

function resolveRefreshedSkillSnapshot(input: {
  skills: readonly RuntimeSkillDefinition[];
  agentId: string;
  selector: true | false | readonly string[] | undefined;
  policy: ResolvedSkillSelectorPolicy | undefined;
}) {
  if (
    !input.policy &&
    (input.selector === false || (Array.isArray(input.selector) && input.selector.length === 0))
  ) {
    return createNoneSkillSelectorSnapshot<RuntimeSkillDefinition>();
  }

  if (!input.policy && Array.isArray(input.selector)) {
    return resolveRuntimeSkillSelectorSnapshotForAgent({
      skills: input.skills,
      agentId: input.agentId,
      selector: [...input.selector],
    });
  }

  if (!input.policy || input.policy.kind === "all-visible") {
    return resolveRuntimeSkillSelectorSnapshotForAgent({
      skills: input.skills,
      agentId: input.agentId,
      selector: input.policy?.source === "true" ? true : undefined,
    });
  }

  if (input.policy.kind === "none") {
    return createNoneSkillSelectorSnapshot<RuntimeSkillDefinition>(input.policy);
  }

  return resolveRuntimeSkillSelectorSnapshotForAgent({
    skills: input.skills,
    agentId: input.agentId,
    selector: input.policy.entries,
  });
}

/** Create default hosted project steering refresh. */
export function createDefaultHostedProjectSteeringRefresh(
  options: CreateDefaultHostedProjectSteeringRefreshOptions,
): (input: DefaultHostedChatRuntimeSystemRefreshInput) => Promise<string> {
  return async (input) => {
    throwIfAborted(input.abortSignal);
    const projectId = getActiveProjectId(input.taskContext);
    const branchId = getActiveBranchId(input.taskContext);
    const canUseInitialProjectSteering = projectId !== null &&
      projectId === input.initialProjectId;
    const initialProjectInstructions = canUseInitialProjectSteering
      ? input.liveProjectSteering.initialProjectInstructions ?? ""
      : "";
    const initialSkills = canUseInitialProjectSteering
      ? input.liveProjectSteering.initialSkills ?? []
      : [];

    const [projectInstructions, skills, remoteToolNames] = await Promise.all([
      projectId
        ? fetchProjectInstructionsWithFallback({
          options,
          taskContext: input.taskContext,
          projectId,
          branchId,
          initialProjectInstructions,
          abortSignal: input.abortSignal,
        })
        : Promise.resolve(""),
      projectId
        ? fetchSkillsWithFallback({
          options,
          taskContext: input.taskContext,
          projectId,
          branchId,
          initialSkills,
          abortSignal: input.abortSignal,
        })
        : Promise.resolve([]),
      listProjectScopedRemoteToolNames(input.toolAssembly.remoteToolSources, {
        projectId,
        context: {
          ...resolveHostedToolExecutionIdentity(input.taskContext),
          ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
        },
        projectScopedRemoteToolOptions: options.projectScopedRemoteToolOptions,
      }),
    ]);
    throwIfAborted(input.abortSignal);

    const skillSelectorSnapshot = resolveRefreshedSkillSnapshot({
      skills,
      agentId: input.liveProjectSteering.agent.id,
      selector: input.liveProjectSteering.agent.skills,
      policy: input.taskContext.skillSelectorPolicy ??
        input.liveProjectSteering.skillSelectorPolicy,
    });
    assertResolvedSkillSelector(skillSelectorSnapshot);
    // The task context is intentionally mutable across steering refreshes;
    // keep its owned array separate from the immutable selector snapshot.
    input.taskContext.availableSkillIds = [...skillSelectorSnapshot.allowedSkillIds];
    input.taskContext.skillSelectorPolicy = skillSelectorSnapshot.policy;
    input.taskContext.skillSourcePaths =
      Object.keys(skillSelectorSnapshot.skillSourcePaths).length > 0
        ? skillSelectorSnapshot.skillSourcePaths
        : undefined;
    const sourceAllowedRemoteToolNames = applySourceIntegrationPolicy(
      remoteToolNames,
      input.toolAssembly.sourceIntegrationPolicy,
    );
    const allToolNames = [
      ...new Set([
        ...input.toolAssembly.localToolNames,
        ...sourceAllowedRemoteToolNames,
        ...input.toolAssembly.providerToolNames,
      ]),
    ].sort();
    const toolNames = selectProviderCompatibleToolNames(allToolNames, {
      model: input.taskContext.model,
      requiredToolNames: input.toolAssembly.localToolNames,
    });
    input.taskContext.availableToolNames = toolNames;

    const refreshedInstructions = options.buildInstructions({
      agentConfig: input.liveProjectSteering.agent,
      projectId,
      branchId,
      environmentContext: input.liveProjectSteering.environmentContext,
      instructions: projectInstructions,
      skills: skillSelectorSnapshot.definitions,
      availableToolNames: toolNames,
    });

    return flattenSystemInstructions(withRuntimeToolInventory(refreshedInstructions, toolNames));
  };
}
