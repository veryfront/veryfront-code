import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Tool } from "#veryfront/tool";
import { MemoryBackend } from "../backends/memory.ts";
import { delay, dependsOn, step, workflow } from "../dsl/index.ts";
import { WorkflowExecutor } from "../executor/workflow-executor.ts";
import type { WorkflowRun } from "../types.ts";
import { WorkflowWorker } from "./workflow-worker.ts";
import { FakeTime } from "#std/testing/time";

const UNRESTRICTED_SOURCE_INTEGRATION_POLICY = normalizeSourceIntegrationPolicy(undefined);

function createRun(sourceIntegrationPolicy = UNRESTRICTED_SOURCE_INTEGRATION_POLICY): WorkflowRun {
  return {
    id: "run-worker-policy",
    workflowId: "workflow-1",
    status: "running",
    input: {},
    nodeStates: {},
    currentNodes: [],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(),
    sourceIntegrationPolicy,
  };
}

function createExpiredTimedWaitRun(
  id: string,
  waitKind: "delay" | "event" = "delay",
): WorkflowRun {
  return {
    ...createRun(),
    id,
    status: "waiting",
    workerId: `run-execution:${id}:previous`,
    currentNodes: ["pause"],
    nodeStates: {
      pause: {
        nodeId: "pause",
        status: "running",
        input: {
          type: "event",
          eventName: waitKind === "delay" ? "__delay__" : "never-arrives",
          timeout: 5,
          _waitKind: waitKind,
        },
        attempt: 1,
        startedAt: new Date(Date.now() - 10),
      },
    },
  };
}

function resumeInBackground(worker: WorkflowWorker, run: WorkflowRun): void {
  (worker as unknown as { resumeInBackground(run: WorkflowRun): void })
    .resumeInBackground(run);
}

function pollOnce(worker: WorkflowWorker): Promise<void> {
  return (worker as unknown as { poll(): Promise<void> }).poll();
}

const NO_SCHEDULED_POLL = 1_000_000;

class GatedFindBackend extends MemoryBackend {
  readonly findStarted = Promise.withResolvers<void>();
  readonly continueFind = Promise.withResolvers<void>();
  claimCalls = 0;

  override async findStalledRuns(stalledThreshold: number): Promise<WorkflowRun[]> {
    this.findStarted.resolve();
    await this.continueFind.promise;
    return await super.findStalledRuns(stalledThreshold);
  }

  override async claimStalledRun(
    runId: string,
    workerId: string,
    stalledThreshold: number,
  ): Promise<boolean> {
    this.claimCalls++;
    return await super.claimStalledRun(runId, workerId, stalledThreshold);
  }
}

class GatedClaimBackend extends MemoryBackend {
  readonly claimStarted = Promise.withResolvers<void>();
  readonly continueClaim = Promise.withResolvers<void>();

  override async claimStalledRun(
    runId: string,
    workerId: string,
    stalledThreshold: number,
  ): Promise<boolean> {
    this.claimStarted.resolve();
    await this.continueClaim.promise;
    return await super.claimStalledRun(runId, workerId, stalledThreshold);
  }
}

describe("workflow/worker/workflow-worker", () => {
  it("rejects invalid polling, recovery, identity, and concurrency configuration", () => {
    const backend = new MemoryBackend();
    const resumeFn = () => Promise.resolve();

    for (const option of ["pollInterval", "stalledThreshold"] as const) {
      for (const value of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertThrows(
          () => new WorkflowWorker({ backend, resumeFn, [option]: value }),
          Error,
          option,
        );
      }
    }
    for (const concurrency of [0, -1, 0.5, Number.NaN]) {
      assertThrows(
        () => new WorkflowWorker({ backend, resumeFn, concurrency }),
        Error,
        "concurrency",
      );
    }
    for (const workerId of ["  ", " worker", "worker ", "\tworker"]) {
      assertThrows(
        () => new WorkflowWorker({ backend, resumeFn, workerId }),
        Error,
        "canonical",
      );
    }
  });

  it("polls and claims through bound real MemoryBackend methods", async () => {
    const backend = new MemoryBackend();
    const run = {
      ...createRun(),
      id: "run-real-memory-poll",
      createdAt: new Date(0),
    };
    await backend.createRun(run);
    let resumeCalls = 0;
    const worker = new WorkflowWorker({
      backend,
      workerId: "worker-real-memory",
      pollInterval: NO_SCHEDULED_POLL,
      stalledThreshold: 1,
      resumeFn: () => {
        resumeCalls++;
        return Promise.resolve();
      },
    });

    worker.start();
    try {
      await pollOnce(worker);
      await worker.stop();

      assertEquals(resumeCalls, 1);
      assertEquals((await backend.getRun(run.id))?.workerId, "worker-real-memory");
      assertEquals(worker.getStats().pollCount, 1);
      assertEquals(worker.getStats().resumeCount, 1);
    } finally {
      await worker.stop();
    }
  });

  it("recovers an expired durable delay after a fresh worker starts", async () => {
    const backend = new MemoryBackend();
    const run = createExpiredTimedWaitRun("run-worker-expired-delay");
    await backend.createRun(run);
    const resumed: Array<{ runId: string; workerId?: string }> = [];
    const worker = new WorkflowWorker({
      backend,
      workerId: "worker-timed-wait-restart",
      pollInterval: NO_SCHEDULED_POLL,
      resumeFn: (runId, workerId) => {
        resumed.push({ runId, workerId });
        return Promise.resolve();
      },
    });

    worker.start();
    try {
      await pollOnce(worker);
      await Promise.resolve();

      assertEquals(resumed, [{
        runId: run.id,
        workerId: "worker-timed-wait-restart",
      }]);
      assertEquals((await backend.getRun(run.id))?.status, "pending");
      assertEquals((await backend.getRun(run.id))?.workerId, "worker-timed-wait-restart");
    } finally {
      await worker.stop();
    }
  });

  for (
    const scenario of [
      {
        label: "unversioned stored run",
        storedVersion: undefined,
        currentVersion: "1",
        error: "non-null durable workflow version",
      },
      {
        label: "changed workflow version",
        storedVersion: "1",
        currentVersion: "2",
        error: "definition version changed",
      },
    ] as const
  ) {
    it(`terminalizes an awakened delay with ${scenario.label}`, async () => {
      const backend = new MemoryBackend();
      const run: WorkflowRun = {
        ...createExpiredTimedWaitRun(`run-worker-${scenario.label.replaceAll(" ", "-")}`),
        ...(scenario.storedVersion === undefined ? {} : { version: scenario.storedVersion }),
      };
      await backend.createRun(run);
      let resumedEffects = 0;
      const effect: Tool = {
        id: `post-wake-${scenario.currentVersion}`,
        type: "function",
        description: "Must not run after version admission fails",
        inputSchema: defineSchema((v) => v.object({}).passthrough())(),
        execute: () => {
          resumedEffects++;
          return Promise.resolve({ done: true });
        },
      };
      const executor = new WorkflowExecutor({ backend });
      executor.register(
        workflow({
          id: run.workflowId,
          version: scenario.currentVersion,
          steps: [
            delay("pause", 5),
            dependsOn(step("effect", { tool: effect }), "pause"),
          ],
        }).definition,
      );
      const worker = new WorkflowWorker({
        backend,
        workerId: `worker-${scenario.currentVersion}`,
        pollInterval: NO_SCHEDULED_POLL,
        resumeFn: (runId, workerId) => executor.resume(runId, undefined, workerId),
      });

      worker.start();
      try {
        await pollOnce(worker);
        await worker.stop();

        const failedRun = await backend.getRun(run.id);
        assertEquals(failedRun?.status, "failed");
        assertEquals(failedRun?.error?.message.includes(scenario.error), true);
        assertEquals(resumedEffects, 0);
        assertEquals(worker.getStats().resumeCount, 0);
        assertEquals(worker.getStats().errorCount, 1);
      } finally {
        await Promise.allSettled([worker.stop(), executor.destroy()]);
      }
    });
  }

  it("does not terminalize a replacement owner after timed-wait resume fails", async () => {
    const backend = new MemoryBackend();
    const run = createExpiredTimedWaitRun("run-worker-timed-wake-replacement");
    await backend.createRun(run);
    const workerId = "worker-timed-wake-original";
    const replacementWorkerId = "worker-timed-wake-replacement";
    const worker = new WorkflowWorker({
      backend,
      workerId,
      pollInterval: NO_SCHEDULED_POLL,
      resumeFn: async (runId, expectedWorkerId) => {
        assertEquals(
          await backend.updateRunIfStatusAndWorker(
            runId,
            ["pending"],
            expectedWorkerId!,
            { workerId: replacementWorkerId },
          ),
          true,
        );
        throw new Error("old owner resume failed after replacement");
      },
    });

    worker.start();
    try {
      await pollOnce(worker);
      await worker.stop();

      const replacementRun = await backend.getRun(run.id);
      assertEquals(replacementRun?.status, "pending");
      assertEquals(replacementRun?.workerId, replacementWorkerId);
      assertEquals(replacementRun?.error, undefined);
      assertEquals(worker.getStats().errorCount, 1);
    } finally {
      await worker.stop();
    }
  });

  it("lets only one worker resume the same expired durable delay", async () => {
    const backend = new MemoryBackend();
    const run = createExpiredTimedWaitRun("run-worker-timed-wait-race");
    await backend.createRun(run);
    const resumed: string[] = [];
    const workers = ["worker-timed-wait-a", "worker-timed-wait-b"].map((workerId) =>
      new WorkflowWorker({
        backend,
        workerId,
        pollInterval: NO_SCHEDULED_POLL,
        resumeFn: () => {
          resumed.push(workerId);
          return Promise.resolve();
        },
      })
    );
    for (const worker of workers) worker.start();
    try {
      await Promise.all(workers.map((worker) => pollOnce(worker)));
      await Promise.resolve();

      assertEquals(resumed.length, 1);
      assertEquals((await backend.getRun(run.id))?.workerId, resumed[0]);
    } finally {
      await Promise.all(workers.map((worker) => worker.stop()));
    }
  });

  it("durably fails an expired event wait without invoking resume", async () => {
    const backend = new MemoryBackend();
    const run = createExpiredTimedWaitRun("run-worker-expired-event", "event");
    await backend.createRun(run);
    let resumeCalls = 0;
    const worker = new WorkflowWorker({
      backend,
      workerId: "worker-event-timeout",
      pollInterval: NO_SCHEDULED_POLL,
      resumeFn: () => {
        resumeCalls++;
        return Promise.resolve();
      },
    });
    worker.start();
    try {
      await pollOnce(worker);

      assertEquals(resumeCalls, 0);
      assertEquals((await backend.getRun(run.id))?.status, "failed");
      assertEquals(
        (await backend.getRun(run.id))?.error?.message,
        'Wait node "pause" timed out after 5ms',
      );
    } finally {
      await worker.stop();
    }
  });

  it("joins a gated find and does not claim after shutdown starts", async () => {
    const backend = new GatedFindBackend();
    await backend.createRun({
      ...createRun(),
      id: "run-stop-during-find",
      createdAt: new Date(0),
    });
    let resumeCalls = 0;
    const worker = new WorkflowWorker({
      backend,
      pollInterval: NO_SCHEDULED_POLL,
      stalledThreshold: 1,
      resumeFn: () => {
        resumeCalls++;
        return Promise.resolve();
      },
    });

    worker.start();
    const polling = pollOnce(worker);
    try {
      await backend.findStarted.promise;
      let stopSettled = false;
      const stopping = worker.stop().finally(() => {
        stopSettled = true;
      });
      await Promise.resolve();
      assertEquals(stopSettled, false);

      backend.continueFind.resolve();
      await Promise.all([polling, stopping]);

      assertEquals(backend.claimCalls, 0);
      assertEquals(resumeCalls, 0);
      assertEquals(worker.getStats().status, "stopped");
    } finally {
      backend.continueFind.resolve();
      await Promise.allSettled([polling, worker.stop()]);
    }
  });

  it("joins a gated claim and does not resume after shutdown starts", async () => {
    const backend = new GatedClaimBackend();
    await backend.createRun({
      ...createRun(),
      id: "run-stop-during-claim",
      createdAt: new Date(0),
    });
    let resumeCalls = 0;
    const worker = new WorkflowWorker({
      backend,
      pollInterval: NO_SCHEDULED_POLL,
      stalledThreshold: 1,
      resumeFn: () => {
        resumeCalls++;
        return Promise.resolve();
      },
    });

    worker.start();
    const polling = pollOnce(worker);
    try {
      await backend.claimStarted.promise;
      let stopSettled = false;
      const stopping = worker.stop().finally(() => {
        stopSettled = true;
      });
      await Promise.resolve();
      assertEquals(stopSettled, false);

      backend.continueClaim.resolve();
      await Promise.all([polling, stopping]);

      assertEquals(resumeCalls, 0);
      assertEquals((await backend.getRun("run-stop-during-claim"))?.status, "pending");
      assertEquals(worker.getStats().status, "stopped");
    } finally {
      backend.continueClaim.resolve();
      await Promise.allSettled([polling, worker.stop()]);
    }
  });

  it("shares one in-flight stop and rejects restart during shutdown", async () => {
    const time = new FakeTime();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const worker = new WorkflowWorker({
      backend: new MemoryBackend(),
      resumeFn: async () => {
        started.resolve();
        await release.promise;
      },
    });

    try {
      worker.start();
      resumeInBackground(worker, createRun());
      await started.promise;

      const firstStop = worker.stop();
      const secondStop = worker.stop();
      assertEquals(worker.getStats().status, "stopping");
      assertThrows(() => worker.start(), Error, "shutdown is in progress");

      release.resolve();
      await time.tickAsync(1_000);
      await Promise.all([firstStop, secondStop]);
      assertEquals(worker.getStats().status, "stopped");
    } finally {
      release.resolve();
      await time.tickAsync(0);
      if (worker.getStats().status === "stopping") await worker.stop();
      time.restore();
    }
  });

  it("requires stop completion before restarting an otherwise idle worker", async () => {
    const worker = new WorkflowWorker({
      backend: new MemoryBackend(),
      pollInterval: NO_SCHEDULED_POLL,
      resumeFn: () => Promise.resolve(),
    });

    worker.start();
    const stopping = worker.stop();
    assertThrows(() => worker.start(), Error, "shutdown is in progress");
    await stopping;

    worker.start();
    assertEquals(worker.getStats().status, "running");
    await worker.stop();
  });

  it("remains retryably stopping when an active resume exceeds the stop timeout", async () => {
    const time = new FakeTime();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const worker = new WorkflowWorker({
      backend: new MemoryBackend(),
      pollInterval: NO_SCHEDULED_POLL,
      resumeFn: async () => {
        started.resolve();
        await release.promise;
      },
    });

    try {
      worker.start();
      resumeInBackground(worker, createRun());
      await started.promise;

      const timedOut = assertRejects(
        () => worker.stop(),
        Error,
        "still stopping",
      );
      await time.tickAsync(30_000);
      await timedOut;

      assertEquals(worker.getStats().status, "stopping");
      assertThrows(() => worker.start(), Error, "shutdown is in progress");

      const retry = worker.stop();
      release.resolve();
      await time.tickAsync(0);
      await retry;
      assertEquals(worker.getStats().status, "stopped");
    } finally {
      release.resolve();
      await time.tickAsync(0);
      if (worker.getStats().status === "stopping") await worker.stop();
      time.restore();
    }
  });

  it("returns detached statistic timestamps", async () => {
    const worker = new WorkflowWorker({
      backend: new MemoryBackend(),
      resumeFn: () => Promise.resolve(),
    });
    worker.start();
    try {
      const snapshot = worker.getStats();
      snapshot.startedAt?.setTime(0);
      assertEquals(worker.getStats().startedAt?.getTime() === 0, false);
    } finally {
      await worker.stop();
    }
  });

  it("rejects backends that cannot fence owner-bound persistence", () => {
    const backend = new MemoryBackend();
    Object.defineProperty(backend, "saveCheckpointIfStatusAndWorker", {
      value: undefined,
    });

    assertThrows(
      () =>
        new WorkflowWorker({
          backend,
          resumeFn: () => Promise.resolve(),
        }),
      Error,
      "saveCheckpointIfStatusAndWorker",
    );
  });

  it("restores a stalled run source policy around the resume callback", async () => {
    const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy({
      allow: { confluence: { allowedTools: ["search_content"] } },
    });
    const resumed = Promise.withResolvers<void>();
    let observedPolicy: unknown;
    const worker = new WorkflowWorker({
      backend: new MemoryBackend(),
      resumeFn: () => {
        observedPolicy = getActiveSourceIntegrationPolicy();
        resumed.resolve();
        return Promise.resolve();
      },
    });

    resumeInBackground(worker, createRun(sourceIntegrationPolicy));
    await resumed.promise;

    assertEquals(observedPolicy, sourceIntegrationPolicy);
  });

  it("passes the claiming worker ID to the resume callback", async () => {
    const resumed = Promise.withResolvers<void>();
    let observed: { runId: string; workerId?: string } | undefined;
    const worker = new WorkflowWorker({
      backend: new MemoryBackend(),
      workerId: "worker-current-owner",
      resumeFn: (runId, workerId) => {
        observed = { runId, workerId };
        resumed.resolve();
        return Promise.resolve();
      },
    });

    resumeInBackground(worker, createRun());
    await resumed.promise;

    assertEquals(observed, {
      runId: "run-worker-policy",
      workerId: "worker-current-owner",
    });
  });

  it("does not invoke the resume callback when a stalled run has no snapshot", async () => {
    let resumeCalls = 0;
    const worker = new WorkflowWorker({
      backend: new MemoryBackend(),
      resumeFn: () => {
        resumeCalls++;
        return Promise.resolve();
      },
    });
    const { sourceIntegrationPolicy: _sourceIntegrationPolicy, ...missingSnapshot } = createRun();

    resumeInBackground(worker, missingSnapshot as unknown as WorkflowRun);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(resumeCalls, 0);
    assertEquals(worker.getStats().errorCount, 1);
  });
});
