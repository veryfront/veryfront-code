import { REQUEST_ERROR } from "#veryfront/errors/error-registry.ts";
import type { WorkflowRun } from "#veryfront/workflow/types.ts";
import { parseWorkflowRunResponse, snapshotWorkflowJson } from "./workflow-wire.ts";

const MAX_WORKFLOW_RUN_LIST_ITEMS = 1_000;
const MAX_WORKFLOW_RUN_LIST_CURSOR_LENGTH = 256 * 1024;

/** A validated response from the workflow run-list endpoint. */
export interface WorkflowListResponse {
  runs: WorkflowRun[];
  cursor?: string;
  totalCount?: number;
}

function invalidResponse(detail: string): never {
  throw REQUEST_ERROR.create({
    detail: `Invalid workflow run list response: ${detail}`,
    status: 502,
  });
}

function readDataProperty(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    invalidResponse(`${key} must be a data property`);
  }
  return descriptor.value;
}

/**
 * Validate and snapshot the workflow run-list response envelope.
 *
 * The client intentionally accepts only the documented object response. Legacy
 * bare arrays and accessor-backed objects are rejected instead of being
 * interpreted through a compatibility fallback.
 */
export function parseWorkflowListResponse(value: unknown): WorkflowListResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidResponse("expected an object with a runs array");
  }

  const runs = readDataProperty(value, "runs");
  if (!Array.isArray(runs) || runs.length > MAX_WORKFLOW_RUN_LIST_ITEMS) {
    invalidResponse("runs must be a bounded array");
  }
  const capturedRuns = snapshotWorkflowJson(runs, "workflow run list");
  if (!Array.isArray(capturedRuns)) invalidResponse("runs must be an array");

  const cursor = readDataProperty(value, "cursor");
  if (
    cursor !== undefined &&
    (typeof cursor !== "string" || cursor.length > MAX_WORKFLOW_RUN_LIST_CURSOR_LENGTH)
  ) {
    invalidResponse("cursor must be a bounded string when present");
  }

  const totalCount = readDataProperty(value, "totalCount");
  if (
    totalCount !== undefined &&
    (typeof totalCount !== "number" || !Number.isSafeInteger(totalCount) || totalCount < 0)
  ) {
    invalidResponse("totalCount must be a non-negative safe integer when present");
  }

  return {
    runs: capturedRuns.map((run) => parseWorkflowRunResponse(run)),
    ...(cursor === undefined ? {} : { cursor }),
    ...(totalCount === undefined ? {} : { totalCount }),
  };
}
