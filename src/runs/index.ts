/**
 * Canonical durable runs for task, workflow, and eval execution.
 *
 * @module
 *
 * @example
 * ```ts
 * import { VeryfrontRunsClient } from "veryfront/runs";
 *
 * const runs = new VeryfrontRunsClient({
 *   authToken: process.env.VERYFRONT_API_TOKEN,
 *   projectReference: "my-project",
 * });
 *
 * const accepted = await runs.createTaskRun({
 *   projectId: "00000000-0000-4000-8000-000000000000",
 *   target: "task:sync-data",
 *   config: { batchSize: 100 },
 * });
 *
 * const events = await runs.events(accepted.run.run_id);
 * ```
 */

export {
  type CompleteProjectEvalRunInput,
  type CreateEvalRunInput,
  type CreateProjectEvalRunInput,
  createRunsClient,
  type CreateTaskRunInput,
  type CreateWorkflowRunInput,
  type EvalRunSourceTargetKind,
  type FailProjectEvalRunInput,
  type KnowledgeIngestByUploadIdsInput,
  type KnowledgeIngestByUploadPathsInput,
  type KnowledgeIngestByUploadPrefixInput,
  type ListRunEventsOptions,
  type ListRunsOptions,
  type ProjectEvalRunRouteOptions,
  type ProjectScopedOptions,
  type RunRuntimeTargetKind,
  type RunRuntimeTargetOptions,
  VeryfrontRunsClient,
  type VeryfrontRunsClientConfig,
} from "./runs-client.ts";
export {
  type CancelRunResponse,
  CancelRunResponseSchema,
  type CreateRunResponse,
  CreateRunResponseSchema,
  type Run,
  type RunEvent,
  RunEventListSchema,
  RunEventSchema,
  type RunExecutionError,
  type RunKind,
  type RunList,
  RunListSchema,
  type RunOwner,
  RunSchema,
  type RunStatus,
  type RunTriggerKind,
} from "./schemas.ts";
