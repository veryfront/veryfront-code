import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils";
import type { RetryConfig, WorkflowNode } from "../types.ts";
import { branch } from "./branch.ts";
import { loop } from "./loop.ts";
import { map } from "./map.ts";
import { parallel } from "./parallel.ts";
import { step } from "./step.ts";
import { subWorkflow } from "./sub-workflow.ts";
import { delay, waitForApproval, waitForEvent } from "./wait.ts";
import { workflow } from "./workflow.ts";
import { calculateRetryDelay } from "../executor/retry-policy.ts";

const processor: WorkflowNode = {
  id: "processor",
  config: { type: "step", tool: "processor" },
};

function timeoutFactories(): Array<[string, (timeout: number | string) => unknown]> {
  return [
    ["workflow", (timeout) => workflow({ id: "numeric-workflow", steps: [], timeout })],
    ["step", (timeout) => step("numeric-step", { tool: "tool", timeout })],
    [
      "parallel",
      (timeout) => parallel("numeric-parallel", [processor], { timeout }),
    ],
    [
      "map",
      (timeout) =>
        map("numeric-map", {
          items: [],
          processor,
          timeout,
        }),
    ],
    [
      "branch",
      (timeout) =>
        branch("numeric-branch", {
          condition: () => true,
          then: [processor],
          timeout,
        }),
    ],
    [
      "approval wait",
      (timeout) => waitForApproval("numeric-approval", { timeout }),
    ],
    [
      "event wait",
      (timeout) =>
        waitForEvent("numeric-event", {
          eventName: "event",
          timeout,
        }),
    ],
    [
      "loop",
      (timeout) =>
        loop("numeric-loop", {
          while: () => true,
          steps: [],
          timeout,
        }),
    ],
    [
      "sub-workflow",
      (timeout) =>
        subWorkflow("numeric-sub-workflow", {
          workflow: { id: "child", steps: [] },
          timeout,
        }),
    ],
  ];
}

function retryFactories(): Array<[string, (retry: RetryConfig) => unknown]> {
  return [
    ["workflow", (retry) => workflow({ id: "retry-workflow", steps: [], retry })],
    ["step", (retry) => step("retry-step", { tool: "tool", retry })],
    ["parallel", (retry) => parallel("retry-parallel", [processor], { retry })],
    [
      "map",
      (retry) => map("retry-map", { items: [], processor, retry }),
    ],
    [
      "branch",
      (retry) =>
        branch("retry-branch", {
          condition: () => true,
          then: [processor],
          retry,
        }),
    ],
    ["approval wait", (retry) => waitForApproval("retry-approval", { retry })],
    [
      "event wait",
      (retry) => waitForEvent("retry-event", { eventName: "event", retry }),
    ],
    [
      "loop",
      (retry) =>
        loop("retry-loop", {
          while: () => true,
          steps: [],
          retry,
        }),
    ],
    [
      "sub-workflow",
      (retry) =>
        subWorkflow("retry-sub-workflow", {
          workflow: { id: "child", steps: [] },
          retry,
        }),
    ],
  ];
}

describe("workflow DSL numeric validation", () => {
  it("accepts the exact portable timer boundary for every timeout surface", () => {
    for (const [, create] of timeoutFactories()) {
      create(MAX_TIMER_DELAY_MS);
      create(`${MAX_TIMER_DELAY_MS}ms`);
    }
  });

  it("rejects invalid timeout values before definitions are scheduled", () => {
    const invalidTimeouts: Array<number | string> = [
      0,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_TIMER_DELAY_MS + 1,
      `${MAX_TIMER_DELAY_MS + 1}ms`,
    ];

    for (const [name, create] of timeoutFactories()) {
      for (const timeout of invalidTimeouts) {
        assertThrows(
          () => create(timeout),
          Error,
          "timeout",
          `${name} accepted invalid timeout ${String(timeout)}`,
        );
      }
    }
  });

  it("rejects invalid retry policies on every policy-bearing DSL surface", () => {
    const invalidRetries: RetryConfig[] = [
      { maxAttempts: Number.NaN },
      { maxAttempts: Number.POSITIVE_INFINITY },
      { maxAttempts: 1.5 },
      { initialDelay: Number.NaN },
      { initialDelay: MAX_TIMER_DELAY_MS + 1 },
      { maxDelay: Number.POSITIVE_INFINITY },
      { backoff: "random" as "fixed" },
    ];

    for (const [name, create] of retryFactories()) {
      for (const retry of invalidRetries) {
        assertThrows(
          () => create(retry),
          Error,
          undefined,
          `${name} accepted invalid retry policy`,
        );
      }
    }
  });

  it("preserves zero delay and backoff semantics", () => {
    assertEquals(delay("zero-delay", 0).config.timeout, 0);
    assertEquals(delay("maximum-delay", MAX_TIMER_DELAY_MS).config.timeout, MAX_TIMER_DELAY_MS);

    const retry = { maxAttempts: 2, initialDelay: 0, maxDelay: 0 } as const;
    assertEquals(step("zero-backoff", { tool: "tool", retry }).config.retry, retry);

    const node = loop("zero-loop-delay", {
      while: () => true,
      steps: [],
      delay: 0,
    });
    assertEquals(node.config.type === "loop" ? node.config.delay : undefined, 0);
  });

  it("keeps the largest exponential retry inside the portable timer domain", () => {
    assertEquals(
      calculateRetryDelay(100, {
        maxAttempts: 100,
        backoff: "exponential",
        initialDelay: MAX_TIMER_DELAY_MS,
        maxDelay: MAX_TIMER_DELAY_MS,
      }),
      MAX_TIMER_DELAY_MS,
    );
  });

  it("snapshots validated retry policies at definition time", () => {
    const retry: RetryConfig = {
      maxAttempts: 2,
      initialDelay: 10,
      maxDelay: 20,
    };
    const node = step("snapshotted-retry", { tool: "tool", retry });

    retry.maxAttempts = Number.NaN;
    retry.initialDelay = Number.POSITIVE_INFINITY;

    assertEquals(node.config.retry, {
      maxAttempts: 2,
      initialDelay: 10,
      maxDelay: 20,
    });
  });

  it("reads accessor-backed execution policies once before validation", () => {
    let retryReads = 0;
    let timeoutReads = 0;
    const options = {
      tool: "tool",
      get retry(): RetryConfig {
        retryReads++;
        return retryReads === 1
          ? { maxAttempts: 2, initialDelay: 10, maxDelay: 20 }
          : { maxAttempts: Number.NaN };
      },
      get timeout(): number {
        timeoutReads++;
        return timeoutReads === 1 ? 1_000 : Number.NaN;
      },
    };

    const node = step("accessor-backed-policy", options);

    assertEquals(retryReads, 1);
    assertEquals(timeoutReads, 1);
    assertEquals(node.config.retry, {
      maxAttempts: 2,
      initialDelay: 10,
      maxDelay: 20,
    });
    assertEquals(node.config.timeout, 1_000);
  });

  it("stores the exact numeric values validated from accessor-backed options", () => {
    let concurrencyReads = 0;
    const mapped = map("accessor-backed-concurrency", {
      items: [],
      processor,
      get concurrency(): number {
        concurrencyReads++;
        return concurrencyReads === 1 ? 2 : Number.NaN;
      },
    });

    let iterationTimeoutReads = 0;
    let delayReads = 0;
    const looped = loop("accessor-backed-loop-timers", {
      while: () => true,
      steps: [],
      get iterationTimeout(): number {
        iterationTimeoutReads++;
        return iterationTimeoutReads === 1 ? 1_000 : Number.NaN;
      },
      get delay(): number {
        delayReads++;
        return delayReads === 1 ? 25 : Number.NaN;
      },
    });

    assertEquals(concurrencyReads, 1);
    assertEquals(
      mapped.config.type === "map" ? mapped.config.concurrency : undefined,
      2,
    );
    assertEquals(iterationTimeoutReads, 1);
    assertEquals(delayReads, 1);
    assertEquals(
      looped.config.type === "loop" ? looped.config.iterationTimeout : undefined,
      1_000,
    );
    assertEquals(
      looped.config.type === "loop" ? looped.config.delay : undefined,
      25,
    );
  });

  it("accepts only positive safe-integer map concurrency", () => {
    for (const concurrency of [1, Number.MAX_SAFE_INTEGER]) {
      const node = map(`concurrency-${concurrency}`, {
        items: [],
        processor,
        concurrency,
      });
      assertEquals(node.config.type === "map" ? node.config.concurrency : undefined, concurrency);
    }

    for (
      const concurrency of [
        0,
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ]
    ) {
      assertThrows(
        () => map("invalid-concurrency", { items: [], processor, concurrency }),
        Error,
        "positive safe integer",
      );
    }
  });

  it("rejects invalid explicit and loop delays", () => {
    const invalidDelays = [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MAX_TIMER_DELAY_MS + 1,
    ];

    for (const invalidDelay of invalidDelays) {
      assertThrows(() => delay("invalid-delay", invalidDelay), Error, "delay");
      assertThrows(
        () =>
          loop("invalid-loop-delay", {
            while: () => true,
            steps: [],
            delay: invalidDelay,
          }),
        Error,
        "delay",
      );
    }
  });

  it("validates loop iteration timeouts independently", () => {
    const valid = loop("valid-iteration-timeout", {
      while: () => true,
      steps: [],
      iterationTimeout: MAX_TIMER_DELAY_MS,
    });
    assertEquals(
      valid.config.type === "loop" ? valid.config.iterationTimeout : undefined,
      MAX_TIMER_DELAY_MS,
    );

    for (
      const iterationTimeout of [
        0,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_TIMER_DELAY_MS + 1,
      ]
    ) {
      assertThrows(
        () =>
          loop("invalid-iteration-timeout", {
            while: () => true,
            steps: [],
            iterationTimeout,
          }),
        Error,
        "iterationTimeout",
      );
    }
  });
});
