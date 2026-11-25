import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  normalizeRunStepCount,
  planRunStepBudget,
  readRunStepCounts,
  stepEndFrame,
} from "./run-step-budget.ts";

const plan = (input: Partial<Parameters<typeof planRunStepBudget>[0]>) =>
  planRunStepBudget({
    runMaxSteps: 4,
    runStepsUsed: 0,
    runStepsFinished: 0,
    startStep: 0,
    completed: false,
    hasContinuation: false,
    owesResumeToolCall: false,
    ...input,
  });

describe("planRunStepBudget", () => {
  it("keeps the full budget for a first execution", () => {
    assertEquals(plan({}), { maxSteps: 4, budgetUsed: false, stepLimit: 4 });
  });

  it("gives a resume what the run's earlier steps leave", () => {
    assertEquals(plan({ runStepsUsed: 3 }), { maxSteps: 1, budgetUsed: false, stepLimit: 1 });
  });

  it("prefers the reported earlier steps over a recovery's finished steps", () => {
    assertEquals(plan({ runStepsUsed: 1, runStepsFinished: 3 }).maxSteps, 3);
  });

  it("derives a recovery's earlier steps from the finished steps its continuation did not take", () => {
    assertEquals(
      plan({ runStepsFinished: 3, startStep: 1, hasContinuation: true }),
      { maxSteps: 2, budgetUsed: false, stepLimit: 2 },
    );
    assertEquals(plan({ runStepsFinished: 1, startStep: 2, hasContinuation: true }).maxSteps, 4);
  });

  it("marks the budget used and runs no step once the run has none left", () => {
    assertEquals(plan({ runStepsUsed: 4 }), { maxSteps: 0, budgetUsed: true, stepLimit: 0 });
    assertEquals(plan({ runStepsUsed: 6 }).maxSteps, 0);
  });

  it("runs an owed call in one step of its own once the budget is used", () => {
    assertEquals(
      plan({ runStepsUsed: 4, owesResumeToolCall: true }),
      { maxSteps: 0, budgetUsed: true, stepLimit: 1 },
    );
    assertEquals(
      plan({ startStep: 4, hasContinuation: true, owesResumeToolCall: true }),
      { maxSteps: 4, budgetUsed: true, stepLimit: 5 },
    );
  });

  it("marks a continuation that reached its limit as used, with nothing owed", () => {
    assertEquals(
      plan({ startStep: 4, hasContinuation: true }),
      { maxSteps: 4, budgetUsed: true, stepLimit: 4 },
    );
  });

  it("leaves a completed continuation and an unreported first execution alone", () => {
    assertEquals(plan({ startStep: 4, hasContinuation: true, completed: true }).budgetUsed, false);
    assertEquals(plan({ runMaxSteps: 0 }).budgetUsed, false);
  });
});

describe("readRunStepCounts", () => {
  it("reads both counts for an agent with its own maxSteps", () => {
    assertEquals(readRunStepCounts({ maxSteps: 3 }, { runStepsUsed: 2, runStepsFinished: 1 }), {
      runStepsUsed: 2,
      runStepsFinished: 1,
    });
  });

  it("reads nothing for an agent without its own maxSteps", () => {
    assertEquals(readRunStepCounts({}, { runStepsUsed: 2 }), {});
  });

  it("drops missing and invalid counts", () => {
    assertEquals(readRunStepCounts({ maxSteps: 3 }, undefined), {});
    assertEquals(
      readRunStepCounts({ maxSteps: 3 }, { runStepsUsed: 0, runStepsFinished: "2" }),
      {},
    );
  });
});

describe("normalizeRunStepCount", () => {
  it("accepts only positive safe integers", () => {
    assertEquals(normalizeRunStepCount(3), 3);
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "3", undefined, null]) {
      assertEquals(normalizeRunStepCount(value), 0);
    }
  });
});

describe("stepEndFrame", () => {
  it("adds the private observation only for an observed step", () => {
    assertEquals(stepEndFrame(undefined), { type: "step-end" });
    assertEquals(stepEndFrame("step-id"), {
      type: "step-end",
      privateRuntimeObservation: { version: 1, kind: "step_ended", stepId: "step-id" },
    });
  });
});
