import { createAgentServiceEvalAdapter } from "#veryfront/eval/agent-service.ts";
import { findEvalById } from "#veryfront/eval/discovery.ts";
import { runEval } from "#veryfront/eval/runner.ts";
import { runTask } from "#veryfront/task/runner.ts";
import { findWorkflowById } from "#veryfront/workflow/discovery";
import { ensureProjectDiscovery } from "./api/project-discovery.ts";
import {
  executeLocalEvalRun,
  executeRemoteEvalRun,
  executeRemoteTaskRun,
} from "./project-run-eval-execution.ts";
import { executeIsolatedProjectRun } from "./project-run-isolation.ts";
import { executeKnowledgeIngestRun } from "./project-run-knowledge-executor.ts";
import {
  createRuntimeWorkflowClient,
  executeLocalTaskRun,
  executeLocalWorkflowRun,
} from "./project-run-local-execution.ts";
import { executeReleaseAssetBuildRun } from "./project-run-release-asset-executor.ts";
import { uploadEvalReportToProjectFiles } from "./project-run-runtime-api.ts";
import { executeStyleArtifactBuildRun } from "./project-run-style-artifact-executor.ts";
import type {
  ProjectRunExecuteHandlerDeps,
  ProjectRunExecuteResponse,
  ProjectRunExecutorInput,
} from "./project-run-types.ts";

/**
 * Preserve the current remote workflow behavior until the project Worker
 * contract supports durable workflow execution. This compatibility path runs
 * project workflow discovery and execution in the host process.
 */
async function executeRemoteWorkflowWithHostCompatibility(
  input: ProjectRunExecutorInput,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  return await executeLocalWorkflowRun(input.request, input.ctx, deps);
}

export const defaultProjectRunExecuteHandlerDeps: ProjectRunExecuteHandlerDeps = {
  runTask,
  findWorkflowById,
  findEvalById,
  createWorkflowClient: createRuntimeWorkflowClient,
  runEval,
  createEvalAgentAdapter: createAgentServiceEvalAdapter,
  uploadEvalReport: uploadEvalReportToProjectFiles,
  executeIsolatedProjectRun,
  executeRemoteWorkflow: executeRemoteWorkflowWithHostCompatibility,
  ensureProjectDiscovery,
  executeKnowledgeIngest: executeKnowledgeIngestRun,
  executeReleaseAssetBuild: executeReleaseAssetBuildRun,
  executeStyleArtifactBuild: executeStyleArtifactBuildRun,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export async function executeProjectRun(
  input: ProjectRunExecutorInput,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  const { request, ctx, req } = input;
  if (request.kind === "task") {
    if (request.target === "task:knowledge-ingest") return await deps.executeKnowledgeIngest(input);
    if (request.target === "task:release-asset-build") {
      return await deps.executeReleaseAssetBuild(input);
    }
    if (request.target === "task:style-artifact-build") {
      return await deps.executeStyleArtifactBuild(input);
    }
    return ctx.isLocalProject === false
      ? await executeRemoteTaskRun(request, ctx, req, deps)
      : await executeLocalTaskRun(request, ctx, deps);
  }

  if (request.kind === "eval") {
    return ctx.isLocalProject === false
      ? await executeRemoteEvalRun(request, ctx, req, deps)
      : await executeLocalEvalRun(request, ctx, req, deps);
  }

  if (ctx.isLocalProject === false && deps.executeRemoteWorkflow) {
    return await deps.executeRemoteWorkflow(input, deps);
  }
  return await executeLocalWorkflowRun(request, ctx, deps);
}
