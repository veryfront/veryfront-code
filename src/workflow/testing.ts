/**
 * Test primitives for driving a workflow end to end.
 *
 * Testing a workflow means waiting for something asynchronous and durable to
 * reach a state, and every test that does it has written the same loop:
 *
 * ```typescript
 * while (Date.now() - start < timeout) {
 *   if ((await client.getRun(runId))?.status === "completed") break;
 *   await delay(50);
 * }
 * ```
 *
 * That loop is where workflow tests go wrong. A bare `await delay(n)` passes
 * on a fast machine and flakes on a loaded one; a poll with no deadline hangs
 * the suite instead of failing it; and a timeout that reports only "timed out"
 * sends the author back to add logging to find out what the run was actually
 * doing. Every harness method here polls to a deadline and, on expiry, throws
 * with the run's status, its pending approvals and its per-node states — the
 * information you would otherwise have gone looking for.
 *
 * Approvals are addressed by **node id**, not approval id. A test author knows
 * they wrote `waitForApproval("review")`; the approval's generated id is
 * something they have to dig out of the run first.
 *
 * ## What this does not do
 *
 * There is no `advanceTime`. The executor schedules timed waits with real
 * `setTimeout` and takes no clock, so fast-forwarding one would mean faking
 * global timers for the whole process. A workflow that sleeps for an hour
 * still sleeps for an hour here. Testing that honestly needs a clock seam in
 * the executor, which is a change to the executor rather than a helper this
 * module can provide.
 *
 * @module workflow/testing
 *
 * @example
 * ```typescript
 * const harness = await startWorkflowTest(
 *   workflow({ id: "ingest", steps: [step("fetch", { tool: fetchTool })] }),
 *   { input: { source: "s3://bucket/key" } },
 * );
 *
 * try {
 *   await harness.settled();
 *   await harness.assertSteps(["fetch"]);
 * } finally {
 *   await harness.dispose();
 * }
 * ```
 */

import { MemoryBackend } from "./backends/memory.ts";
import { createWorkflowClient, type WorkflowClient } from "./api/workflow-client.ts";
import type { WorkflowBackend } from "./backends/types.ts";
import type {
  NodeState,
  PendingApproval,
  Workflow,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStatus,
} from "./types.ts";

/** Statuses a run cannot move out of. */
const TERMINAL: readonly WorkflowStatus[] = ["completed", "failed", "cancelled"] as const;

/** How long any wait polls before giving up. */
const DEFAULT_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 10;

/** Options for {@linkcode startWorkflowTest}. */
export interface StartWorkflowTestOptions<TInput = unknown> {
  /** Input passed to the workflow. Defaults to `{}`. */
  input?: TInput;
  /**
   * Backend to run against. Defaults to a fresh {@linkcode MemoryBackend}, so
   * each harness is isolated from every other.
   */
  backend?: WorkflowBackend;
  /** Deadline for every wait this harness performs (default: 5000ms). */
  timeoutMs?: number;
  /** Additional workflows to register, for a workflow that calls sub-workflows. */
  also?: Array<Workflow | WorkflowDefinition>;
}

/** Options for resolving an approval. */
export interface ApprovalDecisionOptions {
  /** Recorded as the deciding user (default: `"test"`). */
  approver?: string;
  comment?: string;
  /** Payload validated against the wait node's response schema, when it has one. */
  data?: unknown;
}

/** A running workflow under test. */
export interface WorkflowTestHarness<TOutput = unknown> {
  /** Id of the run this harness drives. */
  readonly runId: string;
  /** The client backing the harness, for anything the harness does not wrap. */
  readonly client: WorkflowClient;

  /** Read the run as it is now. */
  run(): Promise<WorkflowRun<unknown, TOutput>>;
  /** The run's context, which is where steps accumulate their output. */
  context(): Promise<WorkflowContext>;

  /** Wait until the run reaches a terminal status, then return it. */
  settled(): Promise<WorkflowRun<unknown, TOutput>>;
  /** Wait until the run reaches `status`, then return it. */
  reaches(status: WorkflowStatus): Promise<WorkflowRun<unknown, TOutput>>;
  /** Wait until at least `count` approvals are pending, then return them. */
  approvals(count?: number): Promise<PendingApproval[]>;

  /** Approve the pending approval raised by `nodeId`. */
  approve(nodeId: string, options?: ApprovalDecisionOptions): Promise<void>;
  /** Reject the pending approval raised by `nodeId`. */
  reject(nodeId: string, options?: ApprovalDecisionOptions): Promise<void>;
  /** Cancel the run. */
  cancel(): Promise<void>;

  /** Ids of completed steps, in the order they completed. */
  steps(): Promise<string[]>;
  /** Assert the completed steps and their order. */
  assertSteps(expected: string[]): Promise<void>;
  /** Assert the run's current status. */
  assertStatus(expected: WorkflowStatus): Promise<void>;

  /** Release the client. Safe to call more than once. */
  dispose(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Everything worth knowing about a stuck run, in one message.
 *
 * A timeout that says only "timed out waiting for completed" is the reason
 * workflow tests get debugged by adding logging. This reports the state the
 * author would have gone looking for.
 */
function describeRun(run: WorkflowRun | null): string {
  if (!run) return "the run no longer exists";

  const nodes = Object.values(run.nodeStates ?? {})
    .map((state: NodeState) =>
      `${state.nodeId}=${state.status}${state.attempt > 1 ? `#${state.attempt}` : ""}${
        state.error ? ` (${state.error})` : ""
      }`
    )
    .join(", ");
  const approvals = (run.pendingApprovals ?? [])
    .filter((approval) => approval.status === "pending")
    .map((approval) => approval.nodeId)
    .join(", ");

  const inFlight = (run.currentNodes ?? []).join(", ");

  // A run persists node states only when it pauses or finishes: while it is
  // actively executing, `nodeStates` and `currentNodes` are both empty. So a
  // `running` run with nothing recorded is the normal in-flight shape, not a
  // corrupt one, and the message says which step is stuck only when the engine
  // actually knows. Saying that outright beats printing "executing: nothing"
  // and leaving the author to wonder whether the run is broken.
  const progress = inFlight
    ? `executing: ${inFlight}`
    : run.status === "running"
    ? "executing: unrecorded (a run mid-step persists no node state)"
    : "executing: nothing";

  return [
    `status=${run.status}`,
    progress,
    `nodes: ${nodes || "none"}`,
    `pending approvals: ${approvals || "none"}`,
    run.error ? `error: ${run.error.message}` : undefined,
  ].filter(Boolean).join("; ");
}

/**
 * Start a workflow and return a harness for driving it.
 *
 * The workflow is registered on a client of its own, backed by a fresh
 * in-memory backend unless one is supplied, so harnesses never observe each
 * other's runs.
 */
export async function startWorkflowTest<TInput = unknown, TOutput = unknown>(
  definition: Workflow | WorkflowDefinition,
  options: StartWorkflowTestOptions<TInput> = {},
): Promise<WorkflowTestHarness<TOutput>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = createWorkflowClient({
    backend: options.backend ?? new MemoryBackend({ debug: false }),
    debug: false,
  });

  client.register(definition);
  for (const extra of options.also ?? []) client.register(extra);

  const workflowId = (definition as { id: string }).id;
  const handle = await client.start<TInput, TOutput>(
    workflowId,
    (options.input ?? {}) as TInput,
  );
  const runId = handle.runId;

  async function readRun(): Promise<WorkflowRun<unknown, TOutput>> {
    const run = await client.getRun(runId);
    if (!run) throw new Error(`Workflow run ${runId} no longer exists`);
    return run as WorkflowRun<unknown, TOutput>;
  }

  /** Poll until `check` holds, or fail with what the run was doing. */
  async function waitFor<T>(
    check: (run: WorkflowRun<unknown, TOutput>) => T | undefined,
    describeGoal: string,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: WorkflowRun<unknown, TOutput> | null = null;

    while (Date.now() < deadline) {
      last = await client.getRun(runId) as WorkflowRun<unknown, TOutput> | null;
      if (last) {
        const result = check(last);
        if (result !== undefined) return result;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${describeGoal} on run ${runId}. ` +
        describeRun(last),
    );
  }

  function pendingApprovals(run: WorkflowRun): PendingApproval[] {
    return (run.pendingApprovals ?? []).filter((approval) => approval.status === "pending");
  }

  async function decide(
    nodeId: string,
    approved: boolean,
    decisionOptions: ApprovalDecisionOptions | undefined,
  ): Promise<void> {
    const approval = await waitFor(
      (run) => pendingApprovals(run).find((candidate) => candidate.nodeId === nodeId),
      `an approval pending on node "${nodeId}"`,
    );

    const approver = decisionOptions?.approver ?? "test";
    if (approved) {
      await client.approve(
        runId,
        approval.id,
        approver,
        decisionOptions?.comment,
        decisionOptions?.data,
      );
      return;
    }
    await client.reject(
      runId,
      approval.id,
      approver,
      decisionOptions?.comment,
      decisionOptions?.data,
    );
  }

  let disposed = false;

  const harness: WorkflowTestHarness<TOutput> = {
    runId,
    client,

    run: readRun,

    async context() {
      return (await readRun()).context;
    },

    settled() {
      return waitFor(
        (run) => TERMINAL.includes(run.status) ? run : undefined,
        `the run to finish (one of ${TERMINAL.join(", ")})`,
      );
    },

    reaches(status) {
      return waitFor(
        (run) => run.status === status ? run : undefined,
        `status "${status}"`,
      );
    },

    approvals(count = 1) {
      return waitFor(
        (run) => {
          const pending = pendingApprovals(run);
          return pending.length >= count ? pending : undefined;
        },
        `${count} pending approval${count === 1 ? "" : "s"}`,
      );
    },

    approve(nodeId, decisionOptions) {
      return decide(nodeId, true, decisionOptions);
    },

    reject(nodeId, decisionOptions) {
      return decide(nodeId, false, decisionOptions);
    },

    async cancel() {
      await client.cancel(runId);
    },

    async steps() {
      const run = await readRun();
      // Ordered by when each step actually finished, so the assertion is
      // evidence of execution order rather than of object key order.
      return Object.values(run.nodeStates ?? {})
        .filter((state: NodeState) => state.status === "completed")
        .sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0))
        .map((state: NodeState) => state.nodeId);
    },

    async assertSteps(expected) {
      const actual = await harness.steps();
      if (actual.length === expected.length && actual.every((id, i) => id === expected[i])) return;
      throw new Error(
        `Expected steps [${expected.join(", ")}] but ran [${actual.join(", ")}] on run ${runId}. ` +
          describeRun(await client.getRun(runId)),
      );
    },

    async assertStatus(expected) {
      const run = await readRun();
      if (run.status === expected) return;
      throw new Error(
        `Expected run ${runId} to be "${expected}". ` + describeRun(run),
      );
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      await client.destroy();
    },
  };

  return harness;
}
