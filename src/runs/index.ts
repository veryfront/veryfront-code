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
 *   authToken: "<TOKEN>",
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

export type {
  InferSchema,
  InferShape,
  RefinementCtx,
  Schema,
  ValidationFailure,
  ValidationIssue,
  ValidationResult,
  ValidationSuccess,
} from "#veryfront/extensions/schema/index.ts";

export {
  type CreateEvalRunInput,
  createRunsClient,
  type CreateTaskRunInput,
  type CreateWorkflowRunInput,
  type KnowledgeIngestByUploadIdsInput,
  type KnowledgeIngestByUploadPathsInput,
  type KnowledgeIngestByUploadPrefixInput,
  type ListRunEventsOptions,
  type ListRunsOptions,
  type ProjectScopedOptions,
  type RunCreateBaseInput,
  type RunRuntimeTargetOptions,
  type RunsRequestIdentity,
  type RunsRequestPolicy,
  type RunsRetryConfig,
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
  type RunEventList,
  RunEventListSchema,
  RunEventSchema,
  type RunExecutionError,
  type RunKind,
  type RunList,
  RunListSchema,
  type RunOwner,
  type RunPageInfo,
  type RunRuntimeTargetKind,
  RunSchema,
  type RunStatus,
  type RunTriggerKind,
} from "./schemas.ts";
