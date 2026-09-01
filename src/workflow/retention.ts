import { hasTerminalRunRetentionSupport, type WorkflowBackend } from "./backends/types.ts";
import { DEFAULT_WORKFLOW_RUN_LIST_LIMIT, MAX_WORKFLOW_RUN_LIST_LIMIT } from "./limits.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

const dateGetTime = Date.prototype.getTime;
const mathMin = Math.min;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const reflectApply = Reflect.apply;

/** Options for one bounded terminal-run retention sweep. */
export interface TerminalRunRetentionOptions {
  /** Delete runs completed strictly before this time. */
  completedBefore: Date;
  /** Maximum runs examined and deleted in this sweep. Defaults to 100. */
  limit?: number;
}

/** Outcome of one terminal-run retention sweep. */
export type TerminalRunRetentionResult =
  | { supported: false; reason: "unsupported" }
  | {
    supported: true;
    examined: number;
    deleted: number;
    /** Whether another sweep can continue without retrying a deferred candidate. */
    hasMore: boolean;
  };

function dateTimestamp(value: Date): number | undefined {
  try {
    const timestamp = reflectApply(dateGetTime, value, []) as number;
    return numberIsFinite(timestamp) ? timestamp : undefined;
  } catch {
    return undefined;
  }
}

function retentionLimit(limit: number | undefined): number {
  const resolved = limit ?? DEFAULT_WORKFLOW_RUN_LIST_LIMIT;
  if (
    !numberIsSafeInteger(resolved) || resolved <= 0 ||
    resolved > MAX_WORKFLOW_RUN_LIST_LIMIT
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Terminal-run retention limit must be an integer from 1 to ${MAX_WORKFLOW_RUN_LIST_LIMIT}`,
    });
  }
  return resolved;
}

/**
 * Delete one bounded batch of runs that still match an old terminal snapshot.
 *
 * The backend comparison closes the race between this sweep reading a failed
 * run and a caller retrying it. Unsupported custom backends return an explicit
 * result and no deletion is attempted.
 */
export async function reapTerminalRuns(
  backend: WorkflowBackend,
  options: TerminalRunRetentionOptions,
): Promise<TerminalRunRetentionResult> {
  if (!hasTerminalRunRetentionSupport(backend)) {
    return { supported: false, reason: "unsupported" };
  }

  const cutoff = dateTimestamp(options.completedBefore);
  if (cutoff === undefined) {
    throw INVALID_ARGUMENT.create({
      detail: "Terminal-run retention completedBefore must be a valid Date",
    });
  }
  const limit = retentionLimit(options.limit);
  const batch = await backend.listTerminalRunRetentionCandidates(
    options.completedBefore,
    limit,
  );
  const examined = mathMin(limit, batch.candidates.length);
  let deleted = 0;
  let deletionDeferred = false;
  for (let index = 0; index < examined; index++) {
    if (await backend.deleteTerminalRunIfUnchanged(batch.candidates[index]!)) deleted += 1;
    else deletionDeferred = true;
  }
  return {
    supported: true,
    examined,
    deleted,
    hasMore: !deletionDeferred && batch.hasMore,
  };
}
