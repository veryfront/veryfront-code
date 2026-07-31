import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { RunFilter } from "../types.ts";
import type { WorkflowRunCursorFilter } from "./types.ts";
import {
  DEFAULT_WORKFLOW_RUN_LIST_LIMIT,
  MAX_WORKFLOW_RUN_LIST_LIMIT,
  MAX_WORKFLOW_RUN_LIST_OFFSET,
} from "../limits.ts";

export {
  DEFAULT_WORKFLOW_RUN_LIST_LIMIT,
  MAX_WORKFLOW_RUN_LIST_LIMIT,
  MAX_WORKFLOW_RUN_LIST_OFFSET,
} from "../limits.ts";

export interface ResolvedRunListPage {
  limit: number;
  offset: number;
}

export interface ResolvedRunDateBounds {
  createdAfterMs?: number;
  createdBeforeMs?: number;
}

export interface ResolvedWorkflowRunCursorPage {
  readonly limit: number;
  readonly cursor?: { readonly createdAtMs: number; readonly runId: string };
}

const UTF8_ENCODER = new TextEncoder();

/** Apply deterministic UTF-8 byte ordering across every backend. */
export function compareRunIdsDescending(left: string, right: string): number {
  if (left === right) return 0;
  const leftBytes = UTF8_ENCODER.encode(left);
  const rightBytes = UTF8_ENCODER.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index++) {
    const difference = rightBytes[index]! - leftBytes[index]!;
    if (difference !== 0) return difference;
  }
  return rightBytes.length - leftBytes.length;
}

function readDateMilliseconds(
  value: Date,
  field: "createdAfter" | "createdBefore" | "cursor createdAt",
): number {
  let milliseconds: number;
  try {
    milliseconds = Date.prototype.getTime.call(value);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: `Workflow run ${field} must be a valid date` });
  }
  if (!Number.isFinite(milliseconds)) {
    throw INVALID_ARGUMENT.create({ detail: `Workflow run ${field} must be a valid date` });
  }
  return milliseconds;
}

/** Validate optional date filters without invoking caller-provided methods. */
export function resolveRunDateBounds(filter: RunFilter): ResolvedRunDateBounds {
  return {
    createdAfterMs: filter.createdAfter === undefined
      ? undefined
      : readDateMilliseconds(filter.createdAfter, "createdAfter"),
    createdBeforeMs: filter.createdBefore === undefined
      ? undefined
      : readDateMilliseconds(filter.createdBefore, "createdBefore"),
  };
}

/** Validate and resolve the shared built-in backend pagination contract. */
export function resolveRunListPage(filter: RunFilter): ResolvedRunListPage {
  const limit = filter.limit ?? DEFAULT_WORKFLOW_RUN_LIST_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_WORKFLOW_RUN_LIST_LIMIT
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Workflow run list limit must be an integer between 1 and ${MAX_WORKFLOW_RUN_LIST_LIMIT}`,
    });
  }

  const offset = filter.offset ?? 0;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_WORKFLOW_RUN_LIST_OFFSET
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Workflow run list offset must be an integer between 0 and ${MAX_WORKFLOW_RUN_LIST_OFFSET}`,
    });
  }

  return { limit, offset };
}

/** Validate the bounded exclusive cursor contract shared by managed backends. */
export function resolveWorkflowRunCursorPage(
  filter: WorkflowRunCursorFilter,
): ResolvedWorkflowRunCursorPage {
  if (
    !Number.isSafeInteger(filter.limit) || filter.limit < 1 ||
    filter.limit > MAX_WORKFLOW_RUN_LIST_LIMIT
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Workflow recovery page limit must be an integer between 1 and ${MAX_WORKFLOW_RUN_LIST_LIMIT}`,
    });
  }
  if (!filter.cursor) return { limit: filter.limit };
  if (typeof filter.cursor.runId !== "string" || filter.cursor.runId.length === 0) {
    throw INVALID_ARGUMENT.create({ detail: "Workflow recovery cursor runId is invalid" });
  }
  const createdAtMs = readDateMilliseconds(filter.cursor.createdAt, "cursor createdAt");
  return {
    limit: filter.limit,
    cursor: { createdAtMs, runId: filter.cursor.runId },
  };
}
