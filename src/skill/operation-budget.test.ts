import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createSkillOperationBudget, SkillOperationTimeoutError } from "./operation-budget.ts";

describe("createSkillOperationBudget", () => {
  it("precreates one immutable timeout reason before external prototype mutation", () => {
    const budget = createSkillOperationBudget({ timeoutMs: 1 });
    const originalName = Object.getOwnPropertyDescriptor(
      SkillOperationTimeoutError.prototype,
      "name",
    );
    const originalTimeout = Object.getOwnPropertyDescriptor(
      SkillOperationTimeoutError.prototype,
      "timeoutMs",
    );
    let setterCalls = 0;

    try {
      for (const key of ["name", "timeoutMs"] as const) {
        Object.defineProperty(SkillOperationTimeoutError.prototype, key, {
          configurable: true,
          set() {
            setterCalls += 1;
            throw new Error(`mutated ${key} setter must not run`);
          },
        });
      }
      const startedAt = performance.now();
      while (performance.now() - startedAt < 5) {
        // Advance the monotonic deadline without scheduling a timer task.
      }

      let first: unknown;
      let second: unknown;
      try {
        budget.throwIfTerminated();
      } catch (error) {
        first = error;
      }
      try {
        budget.throwIfTerminated();
      } catch (error) {
        second = error;
      }
      assertEquals(first instanceof SkillOperationTimeoutError, true);
      assertEquals(second, first);
      assertEquals(setterCalls, 0);
    } finally {
      Reflect.deleteProperty(SkillOperationTimeoutError.prototype, "name");
      Reflect.deleteProperty(SkillOperationTimeoutError.prototype, "timeoutMs");
      if (originalName) {
        Object.defineProperty(SkillOperationTimeoutError.prototype, "name", originalName);
      }
      if (originalTimeout) {
        Object.defineProperty(
          SkillOperationTimeoutError.prototype,
          "timeoutMs",
          originalTimeout,
        );
      }
    }
  });

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

  it("uses native cancellation without invoking hostile signal properties", async () => {
    const cancellation = new Error("cancel hostile budget signal");
    let hookCalls = 0;
    const abortedController = new AbortController();
    abortedController.abort(cancellation);
    Object.defineProperties(abortedController.signal, {
      aborted: {
        configurable: true,
        get() {
          hookCalls += 1;
          throw new Error("own aborted hook ran");
        },
      },
      reason: {
        configurable: true,
        get() {
          hookCalls += 1;
          throw new Error("own reason hook ran");
        },
      },
      addEventListener: {
        configurable: true,
        value() {
          hookCalls += 1;
          throw new Error("own addEventListener hook ran");
        },
      },
      removeEventListener: {
        configurable: true,
        value() {
          hookCalls += 1;
          throw new Error("own removeEventListener hook ran");
        },
      },
    });
    const abortedBudget = createSkillOperationBudget({
      abortSignal: abortedController.signal,
    });

    await assertRejects(
      () => abortedBudget.run(() => Promise.resolve("late success")),
      Error,
      cancellation.message,
    );

    const activeController = new AbortController();
    Object.defineProperties(activeController.signal, {
      aborted: {
        configurable: true,
        get() {
          hookCalls += 1;
          throw new Error("own active aborted hook ran");
        },
      },
      reason: {
        configurable: true,
        get() {
          hookCalls += 1;
          throw new Error("own active reason hook ran");
        },
      },
      addEventListener: {
        configurable: true,
        value() {
          hookCalls += 1;
          throw new Error("own active addEventListener hook ran");
        },
      },
      removeEventListener: {
        configurable: true,
        value() {
          hookCalls += 1;
          throw new Error("own active removeEventListener hook ran");
        },
      },
    });
    const activeBudget = createSkillOperationBudget({
      abortSignal: activeController.signal,
    });

    assertEquals(await activeBudget.run(() => Promise.resolve("ok")), "ok");
    assertEquals(hookCalls, 0);
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
