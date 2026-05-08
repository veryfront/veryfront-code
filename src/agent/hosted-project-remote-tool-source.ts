import {
  createProjectScopedRemoteToolCatalog,
  isProjectNavigationRemoteTool,
  type ProjectScopedRemoteToolDefaultProjectId,
  type ProjectScopedRemoteToolOptions,
  type RemoteToolSource,
  type ToolExecutionContext,
} from "#veryfront/tool";
import { toChildRunToolInputRecord } from "./child-run-execution-support.ts";
import { getConfirmedProjectContextSwitchId } from "./project-context.ts";
import {
  getProjectSteeringMutation,
  isSuccessfulProjectSteeringMutationResult,
  type ProjectSteeringMutationResult,
  type ProjectSteeringPaths,
} from "./project-steering-mutation.ts";

export type HostedProjectRemoteToolSourceMutationHandler = (
  mutation: ProjectSteeringMutationResult,
) => Promise<void> | void;

export type HostedProjectRemoteToolSourceProjectSwitchHandler = (
  projectId: string,
) => Promise<void> | void;

export type HostedProjectRemoteToolSourcePrepareToolInput = (input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  context?: ToolExecutionContext;
}) => Record<string, unknown>;

export type HostedProjectRemoteToolSourceRetryPolicy = (input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  activeProjectId: string | null;
  activeBranchId: string | null;
  error: unknown;
}) => boolean;

export type CreateHostedProjectRemoteToolSourceInput = {
  source: RemoteToolSource;
  defaultProjectId?: ProjectScopedRemoteToolDefaultProjectId;
  getActiveBranchId?: () => string | null | undefined;
  allowedToolNames?: ReadonlySet<string> | null;
  projectScopedRemoteToolOptions?: ProjectScopedRemoteToolOptions;
  prepareToolInput?: HostedProjectRemoteToolSourcePrepareToolInput;
  retryToolName?: string;
  shouldRetryWithTool?: HostedProjectRemoteToolSourceRetryPolicy;
  steeringPaths?: ProjectSteeringPaths;
  onProjectSwitch?: HostedProjectRemoteToolSourceProjectSwitchHandler;
  onSteeringMutation?: HostedProjectRemoteToolSourceMutationHandler;
};

function resolveActiveBranchId(
  getActiveBranchId: (() => string | null | undefined) | undefined,
): string | null {
  return getActiveBranchId?.() ?? null;
}

export function createHostedProjectRemoteToolSource(
  input: CreateHostedProjectRemoteToolSourceInput,
): RemoteToolSource {
  const toolCatalog = createProjectScopedRemoteToolCatalog({
    source: input.source,
    defaultProjectId: input.defaultProjectId,
    allowedToolNames: input.allowedToolNames,
    projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
  });
  const retryToolName = input.retryToolName ?? "update_file";

  async function executeWithRetry(inputExecution: {
    toolName: string;
    toolInput: Record<string, unknown>;
    executeContext?: ToolExecutionContext;
    activeProjectId: string | null;
    activeBranchId: string | null;
  }): Promise<unknown> {
    try {
      return await input.source.executeTool(
        inputExecution.toolName,
        inputExecution.toolInput,
        inputExecution.executeContext,
      );
    } catch (error) {
      if (
        input.shouldRetryWithTool?.({
          toolName: inputExecution.toolName,
          toolInput: inputExecution.toolInput,
          activeProjectId: inputExecution.activeProjectId,
          activeBranchId: inputExecution.activeBranchId,
          error,
        })
      ) {
        return input.source.executeTool(
          retryToolName,
          inputExecution.toolInput,
          inputExecution.executeContext,
        );
      }

      throw error;
    }
  }

  return {
    id: input.source.id,
    listTools: (context) => toolCatalog.listTools(context),
    async executeTool(toolName, args, context) {
      const normalizedToolInput = input.prepareToolInput?.({
        toolName,
        toolInput: toChildRunToolInputRecord(args),
        context,
      }) ?? toChildRunToolInputRecord(args);
      const {
        activeProjectId,
        toolInput: hydratedToolInput,
        executeContext,
      } = await toolCatalog.prepareExecution({
        toolName,
        toolInput: normalizedToolInput,
        context,
      });
      const activeBranchId = resolveActiveBranchId(input.getActiveBranchId);
      let result = await executeWithRetry({
        toolName,
        toolInput: hydratedToolInput,
        executeContext,
        activeProjectId,
        activeBranchId,
      });

      if (
        input.shouldRetryWithTool?.({
          toolName,
          toolInput: hydratedToolInput,
          activeProjectId,
          activeBranchId,
          error: result,
        })
      ) {
        result = await input.source.executeTool(retryToolName, hydratedToolInput, executeContext);
      }

      if (!isSuccessfulProjectSteeringMutationResult(result)) {
        return result;
      }

      if (isProjectNavigationRemoteTool(toolName, input.projectScopedRemoteToolOptions)) {
        const requestedProjectId = normalizedToolInput.project_id;
        const confirmedProjectId = typeof requestedProjectId === "string"
          ? getConfirmedProjectContextSwitchId(result, requestedProjectId)
          : null;

        if (confirmedProjectId) {
          await input.onProjectSwitch?.(confirmedProjectId);
        }

        return result;
      }

      const mutation = getProjectSteeringMutation({
        toolName,
        toolInput: hydratedToolInput,
        activeProjectId,
        activeBranchId,
        steeringPaths: input.steeringPaths,
      });

      if (mutation.instructionsChanged || mutation.skillsChanged) {
        await input.onSteeringMutation?.(mutation);
      }

      return result;
    },
  };
}
