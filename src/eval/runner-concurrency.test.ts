import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { datasets, evalAgent, type EvalProgressEvent, runEval } from "veryfront/eval";
import {
  notifyProviderRequestRetry,
  runWithProviderRequestObserver,
} from "../provider/runtime-loader/provider-request-observer.ts";
import { createEvalModelAccessDeniedError } from "./model-access.ts";

async function withinDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Expected concurrent work to start")), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function definition(repetitions = 1) {
  return evalAgent({
    id: "eval:concurrent",
    target: "agent:echo",
    dataset: datasets.inline([
      { id: "first", input: "one" },
      { id: "second", input: "two" },
      { id: "third", input: "three" },
    ]),
    repetitions,
  });
}

describe("eval record concurrency", () => {
  it("bounds in-flight records and retains dataset order after out-of-order completions", async () => {
    const gates = Array.from({ length: 6 }, () => Promise.withResolvers<void>());
    const started = Array.from({ length: 6 }, () => Promise.withResolvers<void>());
    const events: EvalProgressEvent[] = [];
    let next = 0;
    let active = 0;
    let maximum = 0;
    const pending = runEval(definition(2), {
      concurrency: 2,
      onProgress: (event) => {
        events.push(event);
      },
      adapters: {
        agent: async ({ example, repetition }) => {
          const index = next++;
          active++;
          maximum = Math.max(maximum, active);
          started[index]!.resolve();
          try {
            await gates[index]!.promise;
            return { text: `${example.id}:${repetition}`, usage: { totalTokens: index + 1 } };
          } finally {
            active--;
          }
        },
      },
    });
    try {
      await withinDeadline(started[1]!.promise);
      assertEquals(next, 2, "only two records may start before a slot is released");
      gates[1]!.resolve();
      await withinDeadline(started[2]!.promise);
      assertEquals(next, 3, "a completed record releases exactly one slot");
    } finally {
      for (const gate of gates) gate.resolve();
      await pending;
    }
    const report = await pending;
    assertEquals(maximum, 2);
    assertEquals(
      report.records.map((record) => record.output),
      [
        "first:1",
        "first:2",
        "second:1",
        "second:2",
        "third:1",
        "third:2",
      ].map((text) => ({ text })),
    );
    assertEquals(report.summary.usage?.totalTokens, 21);
    const finished = events.filter((event) => event.type === "record-finished");
    assertEquals(finished[0]?.index, 1, "progress reports completion order");
    assertEquals(finished.map((event) => event.index).sort(), [0, 1, 2, 3, 4, 5]);
  });

  it("keeps the default execution sequential", async () => {
    let active = 0;
    let maximum = 0;
    const report = await runEval(definition(), {
      adapters: {
        agent: async ({ example }) => {
          maximum = Math.max(maximum, ++active);
          await Promise.resolve();
          active--;
          return { text: example.id };
        },
      },
    });
    assertEquals(maximum, 1);
    assertEquals(report.records.map((record) => record.exampleId), ["first", "second", "third"]);
  });

  it("holds concurrency slots while checks are still running", async () => {
    const checking = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const evalDefinition = definition();
    let targetsStarted = 0;
    let checksStarted = 0;
    evalDefinition.check = async () => {
      if (++checksStarted === 2) checking.resolve();
      await release.promise;
    };
    const pending = runEval(evalDefinition, {
      concurrency: 2,
      adapters: {
        agent: () => {
          targetsStarted++;
          return "done";
        },
      },
    });
    try {
      await withinDeadline(checking.promise);
      assertEquals(targetsStarted, 2, "grading occupies the same slot as its target");
    } finally {
      release.resolve();
      await pending;
    }
    assertEquals(targetsStarted, 3);
  });

  it("isolates a record timeout and ordinary failure from sibling cases", async () => {
    let timedOut = false;
    const report = await runEval(definition(), {
      concurrency: 2,
      recordTimeoutMs: 20,
      adapters: {
        agent: ({ example, signal }) => {
          if (example.id === "first") {
            return new Promise((_, reject) => {
              signal!.addEventListener("abort", () => {
                timedOut = true;
                reject(signal!.reason);
              }, { once: true });
            });
          }
          if (example.id === "second") throw new Error("invalid example");
          return "done";
        },
      },
    });
    assertEquals(timedOut, true);
    assertEquals(report.records.map((record) => record.completed), [false, false, true]);
    assertEquals(report.records[1]?.error, "invalid example");
  });

  it("rejects invalid concurrency before loading the dataset or executing a target", async () => {
    const evalDefinition = definition();
    let datasetLoads = 0;
    evalDefinition.dataset.load = () => {
      datasetLoads++;
      return Promise.resolve([]);
    };
    for (const concurrency of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assertRejects(
        () => runEval(evalDefinition, { adapters: {}, concurrency }),
        Error,
        "Eval concurrency must be a positive safe integer",
      );
    }
    assertEquals(datasetLoads, 0);
  });

  it("stops queued records on access denial and drains active cleanup before rejecting", async () => {
    const bothStarted = Promise.withResolvers<void>();
    const observedAbort = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const denial = createEvalModelAccessDeniedError("eval:concurrent", {
      kind: "forbidden",
      code: "FORBIDDEN",
      message: "Project access denied",
    }, undefined);
    const started: string[] = [];
    let settled = false;
    const pending = runEval(definition(), {
      concurrency: 2,
      adapters: {
        agent: async ({ example, signal }) => {
          started.push(example.id);
          if (started.length === 2) bothStarted.resolve();
          if (example.id === "first") {
            await bothStarted.promise;
            throw denial;
          }
          await new Promise<void>((resolve) => {
            signal!.addEventListener("abort", () => {
              observedAbort.resolve();
              resolve();
            }, { once: true });
          });
          await cleanup.promise;
          throw signal!.reason;
        },
      },
    });
    const result = pending.then(
      () => {
        settled = true;
        return undefined;
      },
      (error) => {
        settled = true;
        return error;
      },
    );
    try {
      await withinDeadline(observedAbort.promise);
      assertEquals(started, ["first", "second"]);
      assertEquals(settled, false, "extension teardown must wait for active record cleanup");
    } finally {
      bothStarted.resolve();
      cleanup.resolve();
    }
    assertEquals(await result, denial, "the initial denial must remain the reported failure");
  });

  it("cancels all active records without starting queued work", async () => {
    const controller = new AbortController();
    const bothStarted = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const reason = new Error("run cancelled");
    const started: string[] = [];
    const aborted: string[] = [];
    const pending = runEval(definition(), {
      concurrency: 2,
      signal: controller.signal,
      adapters: {
        agent: async ({ example, signal }) => {
          started.push(example.id);
          if (started.length === 2) bothStarted.resolve();
          await new Promise<void>((resolve) => {
            signal!.addEventListener("abort", () => {
              aborted.push(example.id);
              resolve();
            }, { once: true });
          });
          await cleanup.promise;
          throw signal!.reason;
        },
      },
    });
    const result = pending.catch((error) => error);
    try {
      await withinDeadline(bothStarted.promise);
      controller.abort(reason);
      assertEquals(aborted, ["first", "second"]);
    } finally {
      controller.abort(reason);
      cleanup.resolve();
    }
    assertEquals(await result, reason);
    assertEquals(started, ["first", "second"]);
  });

  it("pauses new record starts for a rate-limited retry's delay across concurrent cases", async () => {
    const retried = Promise.withResolvers<void>();
    const reasons: string[] = [];
    let retriedAt = 0;
    let thirdStartedAt = 0;
    const report = await runWithProviderRequestObserver(
      { onRetry: (event) => void reasons.push(event.reason) },
      () =>
        runEval(definition(), {
          concurrency: 2,
          adapters: {
            agent: async ({ example }) => {
              if (example.id === "first") {
                retriedAt = Date.now();
                notifyProviderRequestRetry({
                  providerLabel: "test",
                  reason: "429",
                  attempt: 2,
                  maxAttempts: 3,
                  delayMs: 200,
                });
                retried.resolve();
              }
              if (example.id === "second") await retried.promise;
              if (example.id === "third") thirdStartedAt = Date.now();
              return example.id;
            },
          },
        }),
    );
    assertEquals(report.records.map((record) => record.completed), [true, true, true]);
    assert(
      thirdStartedAt - retriedAt >= 180,
      `queued record started ${thirdStartedAt - retriedAt}ms after the 429`,
    );
    assertEquals(reasons, ["429"], "the caller's observer still sees the retry");
  });

  it("frees a slot at the record deadline while an abort-ignoring target keeps running", async () => {
    // Documents current behaviour: the limit bounds records, not abandoned
    // targets, so targets that ignore their signal can outlive their slot.
    let started = 0;
    let startedAtFirstDeadline: number | undefined;
    const report = await runEval(definition(), {
      concurrency: 2,
      recordTimeoutMs: 20,
      onProgress: (event) => {
        if (event.type === "record-finished") startedAtFirstDeadline ??= started;
      },
      adapters: {
        agent: () => {
          started++;
          return new Promise<never>(() => {});
        },
      },
    });
    assertEquals(startedAtFirstDeadline, 2, "no record starts beyond the limit before a deadline");
    assertEquals(started, 3, "abandoned targets do not hold a slot");
    assertEquals(report.records.map((record) => record.completed), [false, false, false]);
  });

  it("surfaces a fail-fast error at the record deadline of an abort-ignoring sibling", async () => {
    // Documents current behaviour: fail-fast waits for active records, and a
    // target that ignores its signal is only released by its record deadline.
    const denial = createEvalModelAccessDeniedError("eval:concurrent", {
      kind: "forbidden",
      code: "FORBIDDEN",
      message: "Project access denied",
    }, undefined);
    const started: string[] = [];
    const before = Date.now();
    const error = await runEval(definition(), {
      concurrency: 2,
      recordTimeoutMs: 200,
      adapters: {
        agent: ({ example }) => {
          started.push(example.id);
          return example.id === "first" ? new Promise<never>(() => {}) : Promise.reject(denial);
        },
      },
    }).catch((error) => error);
    const elapsed = Date.now() - before;
    assertEquals(error, denial);
    assertEquals(started, ["first", "second"]);
    assert(elapsed >= 180 && elapsed < 2_000, `fail-fast surfaced after ${elapsed}ms`);
  });
});
