/**
 * A hosted run's `maxSteps` budget across its executions.
 *
 * A hosted run resumes in a new execution after each parked tool call. The
 * control plane reports the model steps the run already used, so the agent's
 * `maxSteps` limits the whole run instead of each execution.
 */

/** Finish reason of an execution stopped because the run used its step budget. */
export const RUN_STEP_BUDGET_FINISH_REASON = "max_steps";

/** A reported step count: a positive safe integer, else zero. */
export function normalizeRunStepCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * The step counts a control-plane request reports. `runStepsUsed` is the run's
 * steps before this execution. On a transport recovery, `runStepsFinished` is
 * the steps the run finished in all. Only an agent with its own `maxSteps`
 * gets them; one without keeps its per-execution default.
 */
export function readRunStepCounts(
  config: { maxSteps?: number },
  forwardedProps: Record<string, unknown> | undefined,
): { runStepsUsed?: number; runStepsFinished?: number } {
  if (config.maxSteps === undefined) return {};
  const used = normalizeRunStepCount(forwardedProps?.runStepsUsed);
  const finished = normalizeRunStepCount(forwardedProps?.runStepsFinished);
  const counts: { runStepsUsed?: number; runStepsFinished?: number } = {};
  if (used > 0) counts.runStepsUsed = used;
  if (finished > 0) counts.runStepsFinished = finished;
  return counts;
}

export type RunStepBudgetPlan = {
  /** Steps this execution may take, counted from its first step. */
  maxSteps: number;
  /** The run has no step left for a model call. */
  budgetUsed: boolean;
  /** The loop's exclusive upper step index. */
  stepLimit: number;
};

/**
 * Plan an execution's steps. The run's earlier steps are `runStepsUsed`, or,
 * on a recovery, `runStepsFinished` minus the steps the continuation took
 * (`startStep`). Once the continuation reached what is left, the budget is
 * used; an owed resume call still runs then, in one step of its own.
 */
export function planRunStepBudget(input: {
  runMaxSteps: number;
  runStepsUsed: number;
  runStepsFinished: number;
  startStep: number;
  completed: boolean;
  hasContinuation: boolean;
  owesResumeToolCall: boolean;
}): RunStepBudgetPlan {
  const before = input.runStepsUsed > 0
    ? input.runStepsUsed
    : Math.max(0, input.runStepsFinished - input.startStep);
  const maxSteps = Math.max(0, input.runMaxSteps - before);
  const reported = before > 0 || input.hasContinuation;
  const budgetUsed = !input.completed && reported && input.startStep >= maxSteps;
  const stepLimit = budgetUsed && input.owesResumeToolCall ? input.startStep + 1 : maxSteps;
  return { maxSteps, budgetUsed, stepLimit };
}

/** The `step-end` frame, with the step's private observation when it has one. */
export function stepEndFrame(
  runtimeObservationStepId: string | undefined,
): Record<string, unknown> {
  if (!runtimeObservationStepId) return { type: "step-end" };
  return {
    type: "step-end",
    privateRuntimeObservation: {
      version: 1,
      kind: "step_ended",
      stepId: runtimeObservationStepId,
    },
  };
}
