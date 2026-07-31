import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { TimedWaitClaim, TimedWaitClaimRequest, WorkflowBackend } from "../backends/types.ts";
import type { WorkflowRun } from "../types.ts";
import { MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS } from "../limits.ts";
import { TimedWaitRecoveryService } from "./timed-wait-recovery.ts";

function createDueDelayRun(id: string, now: number): WorkflowRun {
  return {
    id,
    workflowId: "timed-wait-observer-workflow",
    status: "waiting",
    workerId: `run-execution:${id}`,
    input: {},
    nodeStates: {
      delay: {
        nodeId: "delay",
        status: "running",
        input: {
          type: "event",
          eventName: "__delay__",
          timeout: 1_000,
          _waitKind: "delay",
        },
        attempt: 1,
        startedAt: new Date(now - 1_001),
      },
    },
    currentNodes: ["delay"],
    context: { input: {} },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: new Date(now - 10_000),
    sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
  };
}

Deno.test("timed-wait recovery returns each durable outcome once", async () => {
  const now = Date.now();
  const backend = new MemoryBackend();
  const run = createDueDelayRun("timed-wait-observer", now);
  await backend.createRun(run);

  const recovery = new TimedWaitRecoveryService(backend, "timed-wait-outcome-owner");

  const first = await recovery.recover({ now, maxAwakened: 1 });
  assertEquals(first.awakenedRuns.map((candidate) => candidate.id), [run.id]);
  assertEquals(first.outcomes.map((outcome) => outcome.status), ["awakened"]);
  assertEquals(first.errors, []);
  assertEquals((await backend.getRun(run.id))?.status, "pending");

  assertEquals(await recovery.recover({ now, maxAwakened: 1 }), {
    awakenedRuns: [],
    outcomes: [],
    errors: [],
  });
});

Deno.test("timed-wait recovery rejects malformed claim pages before backend mutation", async () => {
  const now = Date.now();
  const makeClaim = (id: string): TimedWaitClaim => ({
    run: createDueDelayRun(id, now),
    nodeId: "delay",
    deadline: now - 1,
    claimId: `claim:${id}`,
    leaseExpiresAt: new Date(now + 5_000),
    waitKind: "delay",
  });
  const validA = makeClaim("claim-run-a");
  const validB = makeClaim("claim-run-b");
  const validC = makeClaim("claim-run-c");
  const extraPropertyPage = [validA] as TimedWaitClaim[] & { extra?: boolean };
  extraPropertyPage.extra = true;
  const malformedPages: unknown[] = [
    { not: "an array" },
    [validA, validB, validC],
    [{ ...validA, waitKind: "event" }],
    [{ ...validA, deadline: now + 1 }],
    [{ ...validA, nodeId: " " }],
    [{ ...validA, leaseExpiresAt: new Date(Number.NaN) }],
    [{ ...validA, nodeId: "bad\u0000node" }],
    [{
      ...validA,
      run: {
        ...validA.run,
        id: "r".repeat(MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS + 1),
      },
    }],
    [validA, validA],
    [validB, validA],
    extraPropertyPage,
  ];

  for (const page of malformedPages) {
    let updateCalls = 0;
    let releaseCalls = 0;
    const backend = {
      claimDueTimedWaits(request: TimedWaitClaimRequest) {
        return Promise.resolve(request.waitKind === "event" ? [] : page);
      },
      updateRunIfTimedWaitClaim() {
        updateCalls++;
        return Promise.resolve(true);
      },
      releaseTimedWaitClaim() {
        releaseCalls++;
        return Promise.resolve(true);
      },
      getRun() {
        return Promise.resolve(null);
      },
    } as unknown as WorkflowBackend;
    const recovery = new TimedWaitRecoveryService(backend, "claim-page-validator");

    await assertRejects(
      () => recovery.recover({ now, maxAwakened: 2 }),
      Error,
      "timed-wait claim",
    );
    assertEquals(updateCalls, 0);
    assertEquals(releaseCalls, 0);
  }
});

Deno.test("timed-wait claim admission rejects Proxies and accessors without invoking hooks", async () => {
  const now = Date.now();
  const validClaim: TimedWaitClaim = {
    run: createDueDelayRun("claim-hook-run", now),
    nodeId: "delay",
    deadline: now - 1,
    claimId: "claim:hook-run",
    leaseExpiresAt: new Date(now + 5_000),
    waitKind: "delay",
  };
  let proxyTrapCalls = 0;
  const proxiedPage = new Proxy([validClaim], {
    get(_target, key) {
      // Promise resolution necessarily checks thenability before the service
      // receives a backend result. Permit only that language-level probe.
      if (key === "then") return undefined;
      proxyTrapCalls++;
      throw new Error("claim page get trap must not run");
    },
    ownKeys() {
      proxyTrapCalls++;
      throw new Error("claim page ownKeys trap must not run");
    },
    getOwnPropertyDescriptor() {
      proxyTrapCalls++;
      throw new Error("claim page descriptor trap must not run");
    },
  });
  let accessorCalls = 0;
  const accessorClaim = { ...validClaim } as Record<string, unknown>;
  Object.defineProperty(accessorClaim, "run", {
    enumerable: true,
    get() {
      accessorCalls++;
      throw new Error("claim run accessor must not run");
    },
  });

  for (const page of [proxiedPage, [accessorClaim]]) {
    const backend = {
      claimDueTimedWaits(request: TimedWaitClaimRequest) {
        return Promise.resolve(request.waitKind === "event" ? [] : page);
      },
      updateRunIfTimedWaitClaim: () => Promise.resolve(true),
      releaseTimedWaitClaim: () => Promise.resolve(true),
      getRun: () => Promise.resolve(null),
    } as unknown as WorkflowBackend;
    await assertRejects(
      () =>
        new TimedWaitRecoveryService(backend, "claim-hook-validator").recover({
          now,
          maxAwakened: 1,
        }),
      Error,
      "timed-wait claim",
    );
  }

  assertEquals(proxyTrapCalls, 0);
  assertEquals(accessorCalls, 0);
});

Deno.test("timed-wait claim admission detaches snapshots before backend mutation", async () => {
  const now = Date.now();
  const originalRunId = "claim-detached-run";
  const originalClaim: TimedWaitClaim = {
    run: createDueDelayRun(originalRunId, now),
    nodeId: "delay",
    deadline: now - 1,
    claimId: "claim:detached-run",
    leaseExpiresAt: new Date(now + 5_000),
    waitKind: "delay",
  };
  const backend = {
    claimDueTimedWaits(request: TimedWaitClaimRequest) {
      return Promise.resolve(request.waitKind === "event" ? [] : [originalClaim]);
    },
    updateRunIfTimedWaitClaim() {
      originalClaim.run.id = "attacker-mutated-run";
      originalClaim.run.nodeStates = {};
      return Promise.resolve(true);
    },
    releaseTimedWaitClaim: () => Promise.resolve(true),
    getRun: () => Promise.resolve(null),
  } as unknown as WorkflowBackend;

  const recovered = await new TimedWaitRecoveryService(
    backend,
    "claim-detached-validator",
  ).recover({ now, maxAwakened: 1 });

  assertEquals(recovered.awakenedRuns.map((run) => run.id), [originalRunId]);
});

Deno.test("timed-wait recovery returns contained backend errors to its caller", async () => {
  const now = Date.now();
  const run = createDueDelayRun("claim-error-run", now);
  const claim: TimedWaitClaim = {
    run,
    nodeId: "delay",
    deadline: now - 1,
    claimId: "claim:error-run",
    leaseExpiresAt: new Date(now + 5_000),
    waitKind: "delay",
  };
  let releases = 0;
  const backend = {
    claimDueTimedWaits(request: TimedWaitClaimRequest) {
      return Promise.resolve(request.waitKind === "event" ? [] : [claim]);
    },
    updateRunIfTimedWaitClaim() {
      return Promise.reject(new Error("persistence unavailable"));
    },
    releaseTimedWaitClaim() {
      releases++;
      return Promise.resolve(true);
    },
    getRun: () => Promise.resolve(run),
  } as unknown as WorkflowBackend;

  const recovered = await new TimedWaitRecoveryService(
    backend,
    "claim-error-owner",
  ).recover({ now, maxAwakened: 1 });

  assertEquals(recovered.awakenedRuns, []);
  assertEquals(recovered.outcomes, []);
  assertEquals(recovered.errors.length, 1);
  assertEquals(recovered.errors[0]?.runId, run.id);
  assertEquals(releases, 1);
});

Deno.test("timed-wait recovery returns a bounded batch after every lease is durable", async () => {
  const now = Date.now();
  const backend = new MemoryBackend();
  const first = createDueDelayRun("observer-batch-a", now);
  const second = createDueDelayRun("observer-batch-b", now);
  await backend.createRun(first);
  await backend.createRun(second);
  const recovery = new TimedWaitRecoveryService(backend, "outcome-batch-owner");

  const recovered = await recovery.recover({ now, maxAwakened: 2 });

  assertEquals(recovered.awakenedRuns.map((run) => run.id), [first.id, second.id]);
  assertEquals((await backend.getRun(first.id))?.status, "pending");
  assertEquals((await backend.getRun(second.id))?.status, "pending");
  assertEquals(recovered.outcomes.map((outcome) => outcome.status), ["awakened", "awakened"]);
  assertEquals(recovered.errors, []);
});
