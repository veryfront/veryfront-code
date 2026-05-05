import type { HostToolDefinition, HostToolSet, ToolExecutionContext } from "#veryfront/tool";
import { toChildRunToolInputRecord } from "./child-run-execution-support.ts";
import { getConfirmedProjectContextSwitchId } from "./project-context.ts";
import {
  getProjectSteeringMutation,
  isSuccessfulProjectSteeringMutationResult,
  type ProjectSteeringMutationResult,
  type ProjectSteeringPaths,
} from "./project-steering-mutation.ts";

export type HostedChildSteeringMutationHandler = (
  mutation: ProjectSteeringMutationResult,
) => Promise<void> | void;

export type HostedChildProjectSwitchHandler = (projectId: string) => Promise<void> | void;

export type WrapHostedChildSteeringMutationToolInput = {
  toolName: string;
  toolDefinition: HostToolDefinition;
  activeProjectId?: string | null;
  activeBranchId?: string | null;
  steeringPaths?: ProjectSteeringPaths;
  onMutation?: HostedChildSteeringMutationHandler;
};

export type WrapHostedChildProjectSwitchToolInput = {
  tools: HostToolSet;
  toolName?: string;
  onConfirmedProjectSwitch: HostedChildProjectSwitchHandler;
};

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
      const result = await originalExecute(toolInput, execOptions);
      const projectId = normalizedToolInput.project_id;
      const confirmedProjectId = typeof projectId === "string"
        ? getConfirmedProjectContextSwitchId(result, projectId)
        : null;
      if (confirmedProjectId) {
        await input.onConfirmedProjectSwitch(confirmedProjectId);
      }
      return result;
    },
  };
}
