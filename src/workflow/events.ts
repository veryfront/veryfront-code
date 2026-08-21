/**
 * Workflow run events: what changed on a run, derived from what was persisted.
 *
 * A caller who wants to react to a run — a dashboard, a CI job, an operator
 * console — has had one option: poll `GET /runs/:id` on a timer. Polling picks
 * a latency floor and pays for it whether or not anything happened, and it
 * cannot report a transition that started and finished inside one interval.
 *
 * The events here are **derived, not emitted**. Nothing in the executor calls
 * into this module. Every run mutation already funnels through
 * `WorkflowBackend.updateRun`, so wrapping that one method with
 * {@linkcode observeRunUpdates} sees every transition exactly once, in the
 * order it was durably applied. Deriving from persisted state rather than from
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
 * @module workflow/events
 */

import type { NodeState, WorkflowRun, WorkflowStatus } from "./types.ts";
import type { WorkflowRunUpdate } from "./backends/types.ts";
import type { WorkflowBackend } from "./backends/types.ts";

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

/** Receives every event derived for a run. */
export type WorkflowRunEventListener = (event: WorkflowRunEvent) => void;

/**
 * Per-run fan-out for derived events.
 *
 * Scoped by run id rather than process-global: two runs executing
 * concurrently would otherwise interleave on one channel with no way to tell
 * them apart. A run with no subscribers costs nothing — `publish` returns
 * before any diffing work when the run is not being watched, which is the
 * common case in a process serving mostly unwatched runs.
 */
export class WorkflowRunEventBus {
  readonly #listeners = new Map<string, Set<WorkflowRunEventListener>>();
  readonly #snapshots = new Map<string, RunEventSnapshot>();

  /** Whether anything is currently watching this run. */
  hasListeners(runId: string): boolean {
    return (this.#listeners.get(runId)?.size ?? 0) > 0;
  }

  /**
   * Watch a run. The returned function unsubscribes and is safe to call more
   * than once.
   *
   * `initial` seeds the diff baseline so the first update after subscribing
   * reports only what changed since the caller's own read, rather than
   * replaying the run's whole history as if it had just happened.
   */
  subscribe(
    runId: string,
    listener: WorkflowRunEventListener,
    initial?: RunEventSnapshot,
  ): () => void {
    let listeners = this.#listeners.get(runId);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(runId, listeners);
    }
    listeners.add(listener);
    if (initial && !this.#snapshots.has(runId)) this.#snapshots.set(runId, initial);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.#listeners.get(runId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        // Drop the baseline with the last listener. Keeping it would leak one
        // entry per run for the process's lifetime, and the next subscriber
        // seeds its own from a fresh read anyway.
        this.#listeners.delete(runId);
        this.#snapshots.delete(runId);
      }
    };
  }

  /**
   * Diff a run's new state against what this bus last saw and deliver the
   * result. A listener that throws does not stop the others.
   */
  publish(
    runId: string,
    next: RunEventSnapshot,
    runError?: string,
    nodeErrors?: Record<string, string | undefined>,
  ): void {
    const listeners = this.#listeners.get(runId);
    if (!listeners || listeners.size === 0) return;

    const events = deriveRunEvents(runId, this.#snapshots.get(runId), next, runError, nodeErrors);
    this.#snapshots.set(runId, next);
    if (events.length === 0) return;

    for (const event of events) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // A broken subscriber is that subscriber's problem. Letting it throw
          // here would abort the backend write that produced the event.
        }
      }
    }
  }
}

/**
 * Wrap a backend so every run mutation is also published to `bus`.
 *
 * Returns a delegating object rather than mutating the backend, so a backend
 * shared with something that must not emit events is unaffected.
 *
 * The read-back is skipped entirely when nothing is watching the run, so an
 * unobserved run pays one map lookup per update and nothing else. When a run
 * *is* watched, the wrapper re-reads it after the write rather than deriving
 * from the patch: a patch carries only the fields that changed, and a
 * conditional update may not have applied at all.
 */
export function observeRunUpdates<T extends WorkflowBackend>(
  backend: T,
  bus: WorkflowRunEventBus,
): T {
  async function publishCurrent(runId: string): Promise<void> {
    if (!bus.hasListeners(runId)) return;
    try {
      const run = await backend.getRun(runId);
      if (!run) return;
      const nodeErrors: Record<string, string | undefined> = {};
      for (const [nodeId, state] of Object.entries(run.nodeStates ?? {})) {
        if (state?.error !== undefined) nodeErrors[nodeId] = state.error;
      }
      bus.publish(runId, snapshotRun(run), run.error?.message, nodeErrors);
    } catch {
      // Observation must never fail the write that triggered it.
    }
  }

  // A Proxy rather than a spread or a subclass. Backends are classes, so their
  // methods live on the prototype and `{ ...backend }` copies none of them;
  // subclassing would only work for the concrete types this module imports.
  // Forwarding everything unknown keeps optional backend capabilities intact,
  // including the `typeof backend.updateRunIfStatusAndWorker === "function"`
  // probes callers use to detect them.
  return new Proxy(backend, {
    get(target, property) {
      if (property === "createRun") {
        return async (run: Parameters<WorkflowBackend["createRun"]>[0]): Promise<void> => {
          await target.createRun(run);
          await publishCurrent(run.id);
        };
      }

      if (property === "updateRun") {
        return async (runId: string, patch: WorkflowRunUpdate): Promise<void> => {
          await target.updateRun(runId, patch);
          await publishCurrent(runId);
        };
      }

      if (property === "updateRunIfStatus" && typeof target.updateRunIfStatus === "function") {
        return async (
          runId: string,
          expectedStatuses: Parameters<NonNullable<WorkflowBackend["updateRunIfStatus"]>>[1],
          patch: WorkflowRunUpdate,
        ): Promise<boolean> => {
          const applied = await target.updateRunIfStatus!(runId, expectedStatuses, patch);
          if (applied) await publishCurrent(runId);
          return applied;
        };
      }

      if (
        property === "updateRunIfStatusAndWorker" &&
        typeof target.updateRunIfStatusAndWorker === "function"
      ) {
        return async (
          runId: string,
          expectedStatuses: Parameters<
            NonNullable<WorkflowBackend["updateRunIfStatusAndWorker"]>
          >[1],
          expectedWorkerId: string,
          patch: WorkflowRunUpdate,
        ): Promise<boolean> => {
          const applied = await target.updateRunIfStatusAndWorker!(
            runId,
            expectedStatuses,
            expectedWorkerId,
            patch,
          );
          if (applied) await publishCurrent(runId);
          return applied;
        };
      }

      // Bind to the target, not the proxy: a backend reading its own private
      // fields through `this` would otherwise fail on the proxy receiver.
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}
