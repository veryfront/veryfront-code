import type { HostToolDefinition, HostToolSet, ToolExecutionContext } from "#veryfront/tool";
import { toChildRunToolInputRecord } from "../child-run/execution-support.ts";
import {
  createUnconfirmedProjectContextSwitchResult,
  getConfirmedProjectContextSwitch,
  INVALID_AGENT_PROJECT_REFERENCE_MESSAGE,
  isClaimedSuccessfulProjectContextSwitchResult,
  normalizeAgentProjectReference,
} from "../project/context.ts";
import {
  getProjectSteeringMutation,
  isSuccessfulProjectSteeringMutationResult,
  type ProjectSteeringMutationResult,
  type ProjectSteeringPaths,
} from "../project/steering-mutation.ts";

/** Handler for hosted child steering mutation. */
export type HostedChildSteeringMutationHandler = (
  mutation: ProjectSteeringMutationResult,
) => Promise<void> | void;

/** Handler for hosted child project switch. */
export type HostedChildProjectSwitchHandler = (
  projectId: string,
  projectSlug?: string,
) => Promise<void> | void;

/** Input payload for wrap hosted child steering mutation tool. */
export type WrapHostedChildSteeringMutationToolInput = {
  toolName: string;
  toolDefinition: HostToolDefinition;
  activeProjectId?: string | null;
  activeBranchId?: string | null;
  steeringPaths?: ProjectSteeringPaths;
  onMutation?: HostedChildSteeringMutationHandler;
};

/** Input payload for wrap hosted child project switch tool. */
export type WrapHostedChildProjectSwitchToolInput = {
  tools: HostToolSet;
  toolName?: string;
  onConfirmedProjectSwitch: HostedChildProjectSwitchHandler;
};

/** Wrap hosted child steering mutation tool helper. */
export function wrapHostedChildSteeringMutationTool(
  input: WrapHostedChildSteeringMutationToolInput,
): HostToolDefinition {
  if (!input.toolDefinition.execute) {
    return input.toolDefinition;
  }

  const originalExecute = input.toolDefinition.execute;

  return {
    ...input.toolDefinition,
    execute: async (toolInput: unknown, execOptions?: ToolExecutionContext) => {
      const normalizedToolInput = toChildRunToolInputRecord(toolInput);
      const result = await originalExecute(toolInput, execOptions);
      if (!isSuccessfulProjectSteeringMutationResult(result)) {
        return result;
      }

      const mutation = getProjectSteeringMutation({
        toolName: input.toolName,
        toolInput: normalizedToolInput,
        activeProjectId: input.activeProjectId,
        activeBranchId: input.activeBranchId,
        steeringPaths: input.steeringPaths,
      });

      if (mutation.instructionsChanged || mutation.skillsChanged) {
        await input.onMutation?.(mutation);
      }

      return result;
    },
  };
}

/** Wrap hosted child project switch tool helper. */
export function wrapHostedChildProjectSwitchTool(
  input: WrapHostedChildProjectSwitchToolInput,
): void {
  const toolName = input.toolName ?? "studio_open_project";
  const toolDefinition = input.tools[toolName];
  if (!toolDefinition?.execute) {
    return;
  }

  const originalExecute = toolDefinition.execute;
  input.tools[toolName] = {
    ...toolDefinition,
    execute: async (toolInput: unknown, execOptions?: ToolExecutionContext) => {
      const normalizedToolInput = toChildRunToolInputRecord(toolInput);
      const projectReference = normalizeAgentProjectReference(
        normalizedToolInput.project_reference,
      );
      if (!projectReference) {
        throw new TypeError(INVALID_AGENT_PROJECT_REFERENCE_MESSAGE);
      }

      const result = await originalExecute(toolInput, execOptions);
      if (!isSuccessfulProjectSteeringMutationResult(result)) {
        return result;
      }

      const confirmedProject = getConfirmedProjectContextSwitch(result, projectReference);
      if (confirmedProject) {
        await input.onConfirmedProjectSwitch(
          confirmedProject.projectId,
          confirmedProject.projectSlug,
        );
      } else if (isClaimedSuccessfulProjectContextSwitchResult(result)) {
        return createUnconfirmedProjectContextSwitchResult();
      }
      return result;
    },
  };
}
