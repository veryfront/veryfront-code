import { assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createSkillOperationBudget, SkillOperationTimeoutError } from "./operation-budget.ts";

describe("createSkillOperationBudget", () => {
  it("rejects a synchronous operation that returns after the total deadline", async () => {
    const budget = createSkillOperationBudget({ timeoutMs: 1 });

    await assertRejects(
      () =>
        budget.run(() => {
          const startedAt = performance.now();
          while (performance.now() - startedAt < 10) {
            // Deliberately block the event loop past the total deadline.
          }
          return Promise.resolve("late success");
        }),
      SkillOperationTimeoutError,
      "timed out",
    );
  });

  it("rejects when an operation aborts its own signal before settling", async () => {
    const controller = new AbortController();
    const cancellation = new Error("cancel during operation");
    const budget = createSkillOperationBudget({ abortSignal: controller.signal });

    await assertRejects(
      () =>
        budget.run(() => {
          controller.abort(cancellation);
          return Promise.resolve("late success");
        }),
      Error,
      cancellation.message,
    );
  });

  it("rejects an operation that wins the race after the deadline", async () => {
    const budget = createSkillOperationBudget({ timeoutMs: 1 });

    await assertRejects(
      () =>
        budget.run(() =>
          new Promise<string>((resolve) => {
            setTimeout(() => {
              const startedAt = performance.now();
              while (performance.now() - startedAt < 10) {
                // Let this settlement win the race only after the deadline.
              }
              resolve("late success");
            }, 0);
          })
        ),
      SkillOperationTimeoutError,
      "timed out",
    );
  });

  it("maps a synchronous late failure to the total timeout", async () => {
    const budget = createSkillOperationBudget({ timeoutMs: 1 });

    await assertRejects(
      () =>
        budget.run(() => {
          const startedAt = performance.now();
          while (performance.now() - startedAt < 10) {
            // Deliberately fail only after the total deadline.
          }
          throw new Error("late adapter failure");
        }),
      SkillOperationTimeoutError,
      "timed out",
    );
  });

  it("maps a raced late rejection to the total timeout", async () => {
    const budget = createSkillOperationBudget({ timeoutMs: 1 });

    await assertRejects(
      () =>
        budget.run(() =>
          new Promise<string>((_resolve, reject) => {
            setTimeout(() => {
              const startedAt = performance.now();
              while (performance.now() - startedAt < 10) {
                // Let this rejection win the race only after the deadline.
              }
              reject(new Error("late adapter failure"));
            }, 0);
          })
        ),
      SkillOperationTimeoutError,
      "timed out",
    );
  });
});
