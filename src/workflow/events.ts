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

const objectDefineProperty = Object.defineProperty;
const objectEntries = Object.entries;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const reflectApply = Reflect.apply;

function defineRecordEntry<T>(record: Record<string, T>, key: string, value: T): void {
  objectDefineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function appendEvent(events: WorkflowRunEvent[], event: WorkflowRunEvent): void {
  objectDefineProperty(events, events.length, {
    value: event,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function readOwnNodeSnapshot(
  nodes: RunEventSnapshot["nodes"],
  nodeId: string,
): { status: NodeState["status"]; attempt: number } | undefined {
  try {
    const descriptor = objectGetOwnPropertyDescriptor(nodes, nodeId);
    return descriptor && objectHasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function readOwnNodeError(
  nodeErrors: Record<string, string | undefined> | undefined,
  nodeId: string,
): string | undefined {
  if (nodeErrors === undefined) return undefined;
  try {
    const descriptor = objectGetOwnPropertyDescriptor(nodeErrors, nodeId);
    if (!descriptor || !objectHasOwn(descriptor, "value")) return undefined;
    return typeof descriptor.value === "string" ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function readOwnObservedNodeError(
  node: WorkflowRunObservedState["nodes"][string],
): string | undefined {
  try {
    const descriptor = objectGetOwnPropertyDescriptor(node, "error");
    if (!descriptor || !objectHasOwn(descriptor, "value")) return undefined;
    return typeof descriptor.value === "string" ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a run in this status can still produce events. */
export function isTerminalRunStatus(status: WorkflowStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
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
 * A pending approval was persisted; the run is parked until it is decided.
 *
 * The run flips to `waiting` before the approval exists, so a subscriber who
 * reacts to `run.status: "waiting"` with a fetch can race the approval write.
 * This event names the approval directly and removes that second fetch.
 */
export interface WorkflowApprovalPendingEvent {
  type: "approval.pending";
  runId: string;
  approvalId: string;
  nodeId: string;
  /** The persisted request message, absent when none was recorded. */
  message?: string;
}

/**
 * A persisted workflow transition suitable for streaming to run observers.
 *
 * Events contain identifiers, statuses, attempts, persisted error messages,
 * and approval request messages only. Workflow inputs, outputs, approval
 * payloads, context, and tenant metadata are never part of this stream.
 */
export type WorkflowRunEvent =
  | WorkflowStepStartedEvent
  | WorkflowStepCompletedEvent
  | WorkflowStepFailedEvent
  | WorkflowStepSkippedEvent
  | WorkflowRunStatusEvent
  | WorkflowApprovalPendingEvent;

/**
 * The slice of a run this module diffs against.
 *
 * Deliberately not the whole `WorkflowRun`: holding one per subscriber would
 * retain every step's input and output for the life of a connection, and a
 * workflow that passes large payloads between steps would make an idle
 * subscriber expensive. Status, per-node status/attempt, and per-approval
 * identifiers are all a diff needs; approval payloads stay out for the same
 * reason step payloads do.
 */
export interface RunEventSnapshot {
  status: WorkflowStatus;
  nodes: Record<string, { status: NodeState["status"]; attempt: number }>;
  /**
   * Pending approvals by id. Absent means the producer did not observe
   * approvals; the diff then treats them as unchanged, never as revoked.
   */
  approvals?: Record<string, { nodeId: string; message?: string }>;
}

/** Reduce a run to the state {@linkcode deriveRunEvents} compares. */
export function snapshotRun(
  run:
    & Pick<WorkflowRun, "status" | "nodeStates">
    & Partial<Pick<WorkflowRun, "pendingApprovals">>,
): RunEventSnapshot {
  const nodes: RunEventSnapshot["nodes"] = {};
  const entries = objectEntries(run.nodeStates ?? {});
  for (let index = 0; index < entries.length; index++) {
    const nodeId = entries[index]![0];
    const state = entries[index]![1];
    if (!state) continue;
    defineRecordEntry(nodes, nodeId, { status: state.status, attempt: state.attempt });
  }
  const approvals: NonNullable<RunEventSnapshot["approvals"]> = {};
  const pendingApprovals = run.pendingApprovals ?? [];
  for (let index = 0; index < pendingApprovals.length; index++) {
    const approval = pendingApprovals[index];
    if (!approval || approval.status !== "pending") continue;
    defineRecordEntry(approvals, approval.id, {
      nodeId: approval.nodeId,
      ...(approval.message !== undefined ? { message: approval.message } : {}),
    });
  }
  return { status: run.status, nodes, approvals };
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

  const entries = objectEntries(next.nodes);
  for (let index = 0; index < entries.length; index++) {
    const nodeId = entries[index]![0];
    const state = entries[index]![1];
    const before = previous ? readOwnNodeSnapshot(previous.nodes, nodeId) : undefined;
    if (before && before.status === state.status && before.attempt === state.attempt) continue;
    const event = stepEventFor(runId, nodeId, state, readOwnNodeError(nodeErrors, nodeId));
    if (event) appendEvent(events, event);
  }

  if (!previous || previous.status !== next.status) {
    appendEvent(events, {
      type: "run.status",
      runId,
      status: next.status,
      ...(next.status === "failed" && runError !== undefined ? { error: runError } : {}),
    });
  }

  // After the run-status event on purpose: the engine persists `waiting`
  // before the approval exists, so the live stream always delivers the status
  // first, and a combined diff keeps that one sequence. A baseline without an
  // approvals field never observed approvals, so nothing is derived against
  // it: emitting there could repeat an approval the caller already knew.
  if (next.approvals && (!previous || previous.approvals !== undefined)) {
    const baseline = previous?.approvals;
    const approvalEntries = objectEntries(next.approvals);
    for (let index = 0; index < approvalEntries.length; index++) {
      const approvalId = approvalEntries[index]![0];
      const approval = approvalEntries[index]![1];
      if (baseline && objectHasOwn(baseline, approvalId)) continue;
      appendEvent(events, {
        type: "approval.pending",
        runId,
        approvalId,
        nodeId: approval.nodeId,
        ...(approval.message !== undefined ? { message: approval.message } : {}),
      });
    }
  }

  return events;
}

/** Subscriber-local event stream derived from one atomic backend observation. */
export interface WorkflowRunEventObservation {
  initial: WorkflowRun;
  events: AsyncIterable<WorkflowRunEvent>;
  close(): Promise<void>;
}

function snapshotObservedState(
  state: WorkflowRunObservedState,
  previous: RunEventSnapshot,
): RunEventSnapshot {
  const nodes: RunEventSnapshot["nodes"] = {};
  const entries = objectEntries(state.nodes);
  for (let index = 0; index < entries.length; index++) {
    const nodeId = entries[index]![0];
    const node = entries[index]![1];
    defineRecordEntry(nodes, nodeId, { status: node.status, attempt: node.attempt });
  }
  // Observed states carry approvals only when the producing mutation touched
  // them. An absent field means unchanged, so the previous baseline is carried
  // forward; dropping it instead would re-report every approval on the next
  // record that does carry the field.
  let approvals = previous.approvals;
  if (state.approvals !== undefined) {
    const projected: NonNullable<RunEventSnapshot["approvals"]> = {};
    for (let index = 0; index < state.approvals.length; index++) {
      const approval = state.approvals[index]!;
      defineRecordEntry(projected, approval.id, {
        nodeId: approval.nodeId,
        ...(approval.message !== undefined ? { message: approval.message } : {}),
      });
    }
    approvals = projected;
  }
  return {
    status: state.status,
    nodes,
    ...(approvals !== undefined ? { approvals } : {}),
  };
}

/** Derive public events from a backend observation without shared baselines. */
export function deriveWorkflowRunEventObservation(
  observation: WorkflowRunObservation,
): WorkflowRunEventObservation {
  const close = observation.close;
  return {
    initial: observation.initial,
    events: {
      async *[Symbol.asyncIterator]() {
        let previous = snapshotRun(observation.initial);
        for await (const state of observation.changes) {
          const next = snapshotObservedState(state, previous);
          const nodeErrors: Record<string, string | undefined> = {};
          const entries = objectEntries(state.nodes);
          for (let index = 0; index < entries.length; index++) {
            const nodeId = entries[index]![0];
            const node = entries[index]![1];
            const error = readOwnObservedNodeError(node);
            if (error !== undefined) defineRecordEntry(nodeErrors, nodeId, error);
          }
          const events = deriveRunEvents(
            observation.initial.id,
            previous,
            next,
            state.runError,
            nodeErrors,
          );
          for (let index = 0; index < events.length; index++) yield events[index]!;
          previous = next;
        }
      },
    },
    close: () => reflectApply(close, observation, []) as Promise<void>,
  };
}
