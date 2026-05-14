import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import {
  listProjectScopedRemoteToolNames,
  type ProjectScopedRemoteToolOptions,
} from "#veryfront/tool";
import type {
  DefaultHostedChatRuntimeSystemRefreshInput,
  DefaultHostedChatRuntimeTaskContext,
} from "./default-hosted-chat-runtime.ts";
import type { HostedChatRuntimePreparationSteering } from "./hosted/chat-preparation.ts";
import type { RuntimeAgentMarkdownDefinition } from "./runtime/agent-definition.ts";
import type { RuntimeSkillDefinition } from "./runtime/skill-metadata.ts";
import { selectProviderCompatibleToolNames } from "./runtime/provider-tool-compat.ts";
import { flattenSystemInstructions, withRuntimeToolInventory } from "./runtime/tool-inventory.ts";
import type { HostedChatRuntimeInstructionsInput } from "./hosted/chat-preparation.ts";

export type DefaultHostedProjectSteeringRefreshLogger = {
  error(message: string, metadata?: Record<string, unknown>): void;
};

export type DefaultHostedProjectSteeringRefreshLookup = {
  projectId: string;
  authToken: string;
  branchId?: string | null;
};

export type DefaultHostedProjectSteeringFetchers = {
  fetchProjectInstructions: (
    lookup: DefaultHostedProjectSteeringRefreshLookup,
  ) => Promise<string>;
  fetchSkills: (
    lookup: DefaultHostedProjectSteeringRefreshLookup,
  ) => Promise<RuntimeSkillDefinition[]>;
};

export type CreateDefaultHostedProjectSteeringRefreshOptions =
  & DefaultHostedProjectSteeringFetchers
  & {
    buildInstructions: (
      input: HostedChatRuntimeInstructionsInput<RuntimeAgentMarkdownDefinition>,
    ) => string | ChatSystemMessage[];
    projectScopedRemoteToolOptions?: ProjectScopedRemoteToolOptions;
    logger?: DefaultHostedProjectSteeringRefreshLogger;
  };

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
  };

export async function fetchDefaultHostedProjectSteering(
  input: FetchDefaultHostedProjectSteeringInput,
): Promise<HostedChatRuntimePreparationSteering> {
  const projectId = input.projectId;

  if (!projectId) {
    return { instructions: "", skills: [] };
  }

  const fetchSteering = async () => {
    const [instructions, skills] = await Promise.all([
      input.fetchProjectInstructions({
        projectId,
        authToken: input.authToken,
        branchId: input.branchId,
      }),
      input.fetchSkills({
        projectId,
        authToken: input.authToken,
        branchId: input.branchId,
      }),
    ]);

    return {
      instructions,
      skills,
    };
  };

  if (!input.trace) {
    return await fetchSteering();
  }

  return await input.trace(
    input.traceOperationName ?? "agent.fetchProjectSteering",
    fetchSteering,
  );
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
}): Promise<string> {
  try {
    return await input.options.fetchProjectInstructions({
      projectId: input.projectId,
      authToken: input.taskContext.authToken,
      branchId: input.branchId,
    });
  } catch (error) {
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
  initialSkills: RuntimeSkillDefinition[];
}): Promise<RuntimeSkillDefinition[]> {
  try {
    return await input.options.fetchSkills({
      projectId: input.projectId,
      authToken: input.taskContext.authToken,
      branchId: input.branchId,
    });
  } catch (error) {
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

function filterVisibleSkills(input: {
  skills: RuntimeSkillDefinition[];
  allowedSkillIds?: string[];
}): RuntimeSkillDefinition[] {
  if (!input.allowedSkillIds || input.allowedSkillIds.length === 0) {
    return input.skills;
  }

  return input.skills.filter((skill) => input.allowedSkillIds?.includes(skill.id));
}

export function createDefaultHostedProjectSteeringRefresh(
  options: CreateDefaultHostedProjectSteeringRefreshOptions,
): (input: DefaultHostedChatRuntimeSystemRefreshInput) => Promise<string> {
  return async (input) => {
    const projectId = getActiveProjectId(input.taskContext);
    const branchId = getActiveBranchId(input.taskContext);
    const initialProjectInstructions = input.liveProjectSteering.initialProjectInstructions ?? "";
    const initialSkills = input.liveProjectSteering.initialSkills ?? [];

    const [projectInstructions, skills, remoteToolNames] = await Promise.all([
      projectId
        ? fetchProjectInstructionsWithFallback({
          options,
          taskContext: input.taskContext,
          projectId,
          branchId,
          initialProjectInstructions,
        })
        : Promise.resolve(""),
      projectId
        ? fetchSkillsWithFallback({
          options,
          taskContext: input.taskContext,
          projectId,
          branchId,
          initialSkills,
        })
        : Promise.resolve([]),
      listProjectScopedRemoteToolNames(input.toolAssembly.remoteToolSources, {
        projectId,
        projectScopedRemoteToolOptions: options.projectScopedRemoteToolOptions,
      }),
    ]);

    const visibleSkills = filterVisibleSkills({
      skills,
      allowedSkillIds: input.taskContext.availableSkillIds,
    });
    const allToolNames = [
      ...new Set([...input.toolAssembly.localToolNames, ...remoteToolNames]),
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
      skills: visibleSkills,
    });

    return flattenSystemInstructions(withRuntimeToolInventory(refreshedInstructions, toolNames));
  };
}
