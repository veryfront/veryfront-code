/**
 * Workflow run events: what changed on a run, derived from what was persisted.
 *
 * A caller who wants to react to a run, such as a dashboard, CI job, or operator
 * console, has had one option: poll `GET /runs/:id` on a timer. Polling picks
 * a latency floor and pays for it whether or not anything happened, and it
 * cannot report a transition that started and finished inside one interval.
 *
 * The events here are **derived, not emitted**. Nothing in the executor calls
 * into this module. A backend observation supplies every persisted transition
 * in revision order. Deriving from persisted state rather than from
 * in-process callbacks means an event is only reported once the change it
 * describes actually survived, and a run driven by a worker in another process
 * is observed on the same terms as a local one.
 *
 * `StepExecutorConfig` does carry `onStepStart`/`onStepComplete` hooks, which
 * look like the obvious source. They are deliberately not used: they fire
 * in-process before persistence, so a crash between hook and write would
 * report a step that never happened, and a run executing elsewhere emits
 * nothing at all.
 *
 * ## Granularity is bounded by what the engine persists
 *
 * Before a top-level node batch executes, the engine persists every node in the
 * batch as `running`. It persists the settled batch again before dependents can
 * run or the graph can return. A sequential workflow therefore reports a
 * distinct `step.started` and terminal step event for each node.
 *
 * Parallel nodes start together and settle after the full batch has joined,
 * because their context patches must be merged deterministically before the
 * durable root state advances. Synthetic child graphs are never written over
 * the root run. A top-level composite reports its own start and settled state;
 * its child detail becomes durable when the composite parks or settles.
 *
 * @module workflow/events
 */

import type { NodeState, WorkflowRun, WorkflowStatus } from "./types.ts";
import type { WorkflowRunObservation, WorkflowRunObservedState } from "./backends/types.ts";

/** Terminal run statuses: no further event can follow one. */
const TERMINAL_STATUSES: readonly WorkflowStatus[] = [
  "completed",
  "failed",
  "cancelled",
] as const;

/** Whether a run in this status can still produce events. */
export function isTerminalRunStatus(status: WorkflowStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** A step began executing. */
export interface WorkflowStepStartedEvent {
  type: "step.started";
  runId: string;
  nodeId: string;
  attempt: number;
}

/** A step finished successfully. */
export interface WorkflowStepCompletedEvent {
  type: "step.completed";
  runId: string;
  nodeId: string;
  attempt: number;
}

/** A step failed. `error` is the persisted message, absent when none was set. */
export interface WorkflowStepFailedEvent {
  type: "step.failed";
  runId: string;
  nodeId: string;
  attempt: number;
  error?: string;
}

/** A step was skipped, typically by an unmet branch condition. */
export interface WorkflowStepSkippedEvent {
  type: "step.skipped";
  runId: string;
  nodeId: string;
}

/** The run as a whole moved to a new status. */
export interface WorkflowRunStatusEvent {
  type: "run.status";
  runId: string;
  status: WorkflowStatus;
  /** Set only for a run that reached `failed`. */
  error?: string;
}

/**
 * A persisted workflow transition suitable for streaming to run observers.
 *
 * Events contain identifiers, statuses, attempts, and persisted error messages
 * only. Workflow inputs, outputs, context, and tenant metadata are never part
 * of this stream.
 */
export type WorkflowRunEvent =
  | WorkflowStepStartedEvent
  | WorkflowStepCompletedEvent
  | WorkflowStepFailedEvent
  | WorkflowStepSkippedEvent
  | WorkflowRunStatusEvent;

/**
 * The slice of a run this module diffs against.
 *
 * Deliberately not the whole `WorkflowRun`: holding one per subscriber would
 * retain every step's input and output for the life of a connection, and a
 * workflow that passes large payloads between steps would make an idle
 * subscriber expensive. Status and per-node status/attempt are all a diff
 * needs.
 */
export interface RunEventSnapshot {
  status: WorkflowStatus;
  nodes: Record<string, { status: NodeState["status"]; attempt: number }>;
}

/** Reduce a run to the state {@linkcode deriveRunEvents} compares. */
export function snapshotRun(run: Pick<WorkflowRun, "status" | "nodeStates">): RunEventSnapshot {
  const nodes: RunEventSnapshot["nodes"] = {};
  for (const [nodeId, state] of Object.entries(run.nodeStates ?? {})) {
    if (!state) continue;
    nodes[nodeId] = { status: state.status, attempt: state.attempt };
  }
  return { status: run.status, nodes };
}

function stepEventFor(
  runId: string,
  nodeId: string,
  state: { status: NodeState["status"]; attempt: number },
  error?: string,
): WorkflowRunEvent | null {
  switch (state.status) {
    case "running":
      return { type: "step.started", runId, nodeId, attempt: state.attempt };
    case "completed":
      return { type: "step.completed", runId, nodeId, attempt: state.attempt };
    case "failed":
      return {
        type: "step.failed",
        runId,
        nodeId,
        attempt: state.attempt,
        ...(error !== undefined ? { error } : {}),
      };
    case "skipped":
      return { type: "step.skipped", runId, nodeId };
    // `pending` is a node's initial state, not a transition worth reporting.
    default:
      return null;
  }
}

/**
 * Events describing how a run got from `previous` to `next`.
 *
 * A retry is a real transition even though the status repeats: a node going
 * `failed` → `running` on attempt 2 reads identically to attempt 1 unless
 * `attempt` is compared too, so both are part of a node's identity here.
 *
 * Step events precede the run-status event when both are present, because a
 * `completed` run whose last step is still reported as running is a state no
 * consumer should ever have to render.
 */
export function deriveRunEvents(
  runId: string,
  previous: RunEventSnapshot | undefined,
  next: RunEventSnapshot,
  runError?: string,
  nodeErrors?: Record<string, string | undefined>,
): WorkflowRunEvent[] {
  const events: WorkflowRunEvent[] = [];

  for (const [nodeId, state] of Object.entries(next.nodes)) {
    const before = previous?.nodes[nodeId];
    if (before && before.status === state.status && before.attempt === state.attempt) continue;
    const event = stepEventFor(runId, nodeId, state, nodeErrors?.[nodeId]);
    if (event) events.push(event);
  }

  if (!previous || previous.status !== next.status) {
    events.push({
      type: "run.status",
      runId,
      status: next.status,
      ...(next.status === "failed" && runError !== undefined ? { error: runError } : {}),
    });
  }

  return events;
}

/** Subscriber-local event stream derived from one atomic backend observation. */
export interface WorkflowRunEventObservation {
  initial: WorkflowRun;
  events: AsyncIterable<WorkflowRunEvent>;
  close(): Promise<void>;
}

function snapshotObservedState(state: WorkflowRunObservedState): RunEventSnapshot {
  const nodes: RunEventSnapshot["nodes"] = {};
  for (const [nodeId, node] of Object.entries(state.nodes)) {
    nodes[nodeId] = { status: node.status, attempt: node.attempt };
  }
  return { status: state.status, nodes };
}

/** Derive public events from a backend observation without shared baselines. */
export function deriveWorkflowRunEventObservation(
  observation: WorkflowRunObservation,
): WorkflowRunEventObservation {
  return {
    initial: observation.initial,
    events: {
      async *[Symbol.asyncIterator]() {
        let previous = snapshotRun(observation.initial);
        for await (const state of observation.changes) {
          const next = snapshotObservedState(state);
          const nodeErrors: Record<string, string | undefined> = {};
          for (const [nodeId, node] of Object.entries(state.nodes)) {
            if (node.error !== undefined) nodeErrors[nodeId] = node.error;
          }
          yield* deriveRunEvents(
            observation.initial.id,
            previous,
            next,
            state.runError,
            nodeErrors,
          );
          previous = next;
        }
      },
    },
    close: () => observation.close(),
  };
}
