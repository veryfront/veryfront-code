import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { MemoryBackend } from "../backends/memory.ts";
import type { TimedWaitClaim, TimedWaitClaimRequest, WorkflowBackend } from "../backends/types.ts";
import type { WorkflowRun } from "../types.ts";
import { MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS } from "../limits.ts";
import { getTimedWorkflowWaits, reconcileTimedWorkflowWait } from "./timed-wait-reconciliation.ts";
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

function createDueMixedWaitRun(id: string, now: number): WorkflowRun {
  const run = createDueDelayRun(id, now);
  run.nodeStates.event = {
    nodeId: "event",
    status: "running",
    input: {
      type: "event",
      eventName: "never-arrives",
      timeout: 1_000,
      _waitKind: "event",
    },
    attempt: 1,
    startedAt: new Date(now - 1_001),
  };
  run.currentNodes = ["delay", "event"];
  return run;
}

Deno.test("local timed-wait reconciliation gives a due event precedence over a delay", async () => {
  const now = Date.now();
  const backend = new MemoryBackend();
  const run = createDueMixedWaitRun("local-delay-behind-event", now);
  run.nodeStates.delay!.startedAt = new Date(now - 1_002);
  await backend.createRun(run);
  const delay = getTimedWorkflowWaits(run).find((registration) =>
    registration.waitKind === "delay"
  );
  if (!delay) throw new Error("Expected a due delay registration");

  const outcome = await reconcileTimedWorkflowWait(backend, delay, { now });

  assertEquals(outcome.status, "failed");
  assertEquals(outcome.registration.nodeId, "event");
  const failed = await backend.getRun(run.id);
  assertEquals(failed?.status, "failed");
  assertEquals(failed?.nodeStates.event?.status, "failed");
  assertEquals(failed?.nodeStates.delay?.status, "running");
});

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

Deno.test("timed-wait recovery accepts unbounded well-formed worker and claim identities", async () => {
  const now = Date.now();
  const backend = new MemoryBackend();
  const run = createDueDelayRun("long-timed-wait-identities", now);
  run.workerId = "w".repeat(MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS + 1);
  await backend.createRun(run);

  const recovered = await new TimedWaitRecoveryService(
    backend,
    "o".repeat(MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS),
  ).recover({ now, maxAwakened: 1 });

  assertEquals(recovered.awakenedRuns.map((candidate) => candidate.id), [run.id]);
  assertEquals(recovered.errors, []);
});

Deno.test("timed-wait recovery admits independently bounded durable run values", async () => {
  const now = Date.now();
  const backend = new MemoryBackend();
  const run = createDueDelayRun("large-durable-timed-wait-values", now);
  const payload = Array.from({ length: 139 }, () => "x".repeat(60_349));
  run.input = { payload };
  run.context = { input: { payload: structuredClone(payload) } };
  await backend.createRun(run);

  const recovered = await new TimedWaitRecoveryService(
    backend,
    "large-durable-values-owner",
  ).recover({ now, maxAwakened: 1 });

  assertEquals(recovered.awakenedRuns.map((candidate) => candidate.id), [run.id]);
  assertEquals(recovered.errors, []);
  assertEquals((await backend.getRun(run.id))?.status, "pending");
});

Deno.test("timed-wait recovery rejects a non-well-formed owner identity", () => {
  assertThrows(
    () => new TimedWaitRecoveryService(new MemoryBackend(), "\uD800"),
    TypeError,
    "canonical non-empty string",
  );
});

Deno.test("timed-wait recovery fails closed before invoking a legacy cursor backend", () => {
  let pageCalls = 0;
  let traps = 0;
  const hostilePage = new Proxy([], {
    get(target, property, receiver) {
      if (property === "then") return undefined;
      traps++;
      return Reflect.get(target, property, receiver);
    },
    ownKeys(target) {
      traps++;
      return Reflect.ownKeys(target);
    },
  });
  const backend = {
    listRunsAfterCursor() {
      pageCalls++;
      return Promise.resolve(hostilePage);
    },
  } as unknown as WorkflowBackend;

  assertThrows(
    () => new TimedWaitRecoveryService(backend, "legacy-hostile-page"),
    Error,
    "atomic indexed timed-wait recovery",
  );
  assertEquals(pageCalls, 0);
  assertEquals(traps, 0);
});

Deno.test("timed-wait recovery never admits a delay behind the event batch boundary", async () => {
  const now = Date.now();
  const backend = new MemoryBackend();
  for (let index = 0; index < 101; index++) {
    await backend.createRun(
      createDueMixedWaitRun(`mixed-batch-${String(index).padStart(3, "0")}`, now),
    );
  }

  const recovered = await new TimedWaitRecoveryService(
    backend,
    "mixed-batch-boundary-owner",
  ).recover({ now, maxAwakened: 1 });

  assertEquals(recovered.awakenedRuns, []);
  assertEquals(
    recovered.outcomes.filter((outcome) => outcome.status === "failed").length,
    100,
  );
  assertEquals(
    (await backend.listRuns({ status: "waiting" })).map((run) => run.id),
    ["mixed-batch-100"],
  );
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
  const siblingRun = createDueDelayRun("claim-run-siblings", now);
  siblingRun.nodeStates.delayB = {
    ...structuredClone(siblingRun.nodeStates.delay!),
    nodeId: "delayB",
  };
  const siblingClaims: TimedWaitClaim[] = [
    {
      ...makeClaim(siblingRun.id),
      run: siblingRun,
    },
    {
      ...makeClaim(siblingRun.id),
      run: siblingRun,
      nodeId: "delayB",
      claimId: "claim:claim-run-siblings-b",
    },
  ];
  const extraPropertyPage = [validA] as TimedWaitClaim[] & { extra?: boolean };
  extraPropertyPage.extra = true;
  const malformedPages: unknown[] = [
    { not: "an array" },
    [validA, validB, validC],
    [{ ...validA, waitKind: "event" }],
    [{ ...validA, deadline: now + 1 }],
    [{ ...validA, nodeId: " " }],
    [{ ...validA, leaseExpiresAt: new Date(Number.NaN) }],
    [{
      ...validA,
      run: {
        ...validA.run,
        id: "r".repeat(MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS + 1),
      },
    }],
    [validA, validA],
    siblingClaims,
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

Deno.test("timed-wait recovery rejects a delay claim behind a due sibling event", async () => {
  const now = Date.now();
  const run = createDueMixedWaitRun("claim-delay-behind-event", now);
  const claim: TimedWaitClaim = {
    run,
    nodeId: "delay",
    deadline: now - 1,
    claimId: "claim:delay-behind-event",
    leaseExpiresAt: new Date(now + 5_000),
    waitKind: "delay",
  };
  let updateCalls = 0;
  let releaseCalls = 0;
  const backend = {
    claimDueTimedWaits(request: TimedWaitClaimRequest) {
      return Promise.resolve(request.waitKind === "event" ? [] : [claim]);
    },
    updateRunIfTimedWaitClaim() {
      updateCalls++;
      return Promise.resolve(true);
    },
    releaseTimedWaitClaim() {
      releaseCalls++;
      return Promise.resolve(true);
    },
    getRun: () => Promise.resolve(null),
  } as unknown as WorkflowBackend;

  await assertRejects(
    () =>
      new TimedWaitRecoveryService(backend, "claim-delay-priority-validator").recover({
        now,
        maxAwakened: 1,
      }),
    Error,
    "timed-wait claim",
  );
  assertEquals(updateCalls, 0);
  assertEquals(releaseCalls, 0);
});

Deno.test("timed-wait recovery rejects non-well-formed claim identities before mutation", async () => {
  const now = Date.now();
  const run = createDueDelayRun("claim-run-\uD800", now);
  run.workerId = "run-execution:well-formed-owner";
  const claim: TimedWaitClaim = {
    run,
    nodeId: "delay",
    deadline: now - 1,
    claimId: "claim:non-well-formed-run",
    leaseExpiresAt: new Date(now + 5_000),
    waitKind: "delay",
  };
  let updateCalls = 0;
  let releaseCalls = 0;
  const backend = {
    claimDueTimedWaits(request: TimedWaitClaimRequest) {
      return Promise.resolve(request.waitKind === "event" ? [] : [claim]);
    },
    updateRunIfTimedWaitClaim() {
      updateCalls++;
      return Promise.resolve(true);
    },
    releaseTimedWaitClaim() {
      releaseCalls++;
      return Promise.resolve(true);
    },
    getRun: () => Promise.resolve(null),
  } as unknown as WorkflowBackend;

  await assertRejects(
    () =>
      new TimedWaitRecoveryService(backend, "claim-unicode-validator").recover({
        now,
        maxAwakened: 1,
      }),
    Error,
    "timed-wait claim",
  );
  assertEquals(updateCalls, 0);
  assertEquals(releaseCalls, 0);
});

Deno.test("timed-wait recovery admits code-unit ordering and control identities", async () => {
  const now = Date.now();
  const makeClaim = (id: string, nodeId: string): TimedWaitClaim => {
    const run = createDueDelayRun(id, now);
    const state = run.nodeStates.delay!;
    state.nodeId = nodeId;
    run.nodeStates = { [nodeId]: state };
    run.currentNodes = [nodeId];
    return {
      run,
      nodeId,
      deadline: now - 1,
      claimId: `claim:${id}`,
      leaseExpiresAt: new Date(now + 5_000),
      waitKind: "delay",
    };
  };
  const identities = [
    ['claim-run-a"', "node\0value"],
    ["claim-run-a#", "node\nvalue"],
    ["claim-run-😀", "node\uE000value"],
    ["claim-run-\uE000", "node/value"],
  ] as const;
  const claims = identities.map(([id, nodeId]) => makeClaim(id, nodeId)).sort((left, right) =>
    left.run.id < right.run.id ? -1 : left.run.id > right.run.id ? 1 : 0
  );
  const backend = {
    claimDueTimedWaits(request: TimedWaitClaimRequest) {
      return Promise.resolve(request.waitKind === "event" ? [] : claims);
    },
    updateRunIfTimedWaitClaim: () => Promise.resolve(true),
    releaseTimedWaitClaim: () => Promise.resolve(true),
    getRun: () => Promise.resolve(null),
  } as unknown as WorkflowBackend;

  const recovered = await new TimedWaitRecoveryService(
    backend,
    "claim-escaped-order-owner",
  ).recover({ now, maxAwakened: claims.length });

  assertEquals(recovered.awakenedRuns.map((run) => run.id), claims.map((claim) => claim.run.id));
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

Deno.test("timed-wait claim admission detaches and preserves cycles and aliases", async () => {
  const now = Date.now();
  const originalRunId = "claim-detached-run";
  const shared = { label: "original" } as { label: string; self?: unknown };
  shared.self = shared;
  const originalClaim: TimedWaitClaim = {
    run: createDueDelayRun(originalRunId, now),
    nodeId: "delay",
    deadline: now - 1,
    claimId: "claim:detached-run",
    leaseExpiresAt: new Date(now + 5_000),
    waitKind: "delay",
  };
  originalClaim.run.context = { input: shared, alias: shared };
  const backend = {
    claimDueTimedWaits(request: TimedWaitClaimRequest) {
      return Promise.resolve(request.waitKind === "event" ? [] : [originalClaim]);
    },
    updateRunIfTimedWaitClaim() {
      originalClaim.run.id = "attacker-mutated-run";
      originalClaim.run.nodeStates = {};
      shared.label = "attacker-mutated-label";
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
  const context = recovered.awakenedRuns[0]!.context as Record<string, unknown>;
  const input = context.input as { label: string; self?: unknown };
  assertEquals(input.label, "original");
  assertEquals(input === context.alias, true);
  assertEquals(input.self === input, true);
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

Deno.test("timed-wait recovery rejects truthy non-boolean claim updates", async () => {
  const now = Date.now();
  for (const invalidResult of [{}, "true"] as const) {
    const run = createDueDelayRun(`claim-non-boolean-${typeof invalidResult}`, now);
    const claim: TimedWaitClaim = {
      run,
      nodeId: "delay",
      deadline: now - 1,
      claimId: `claim:non-boolean-${typeof invalidResult}`,
      leaseExpiresAt: new Date(now + 5_000),
      waitKind: "delay",
    };
    let releases = 0;
    const backend = {
      claimDueTimedWaits(request: TimedWaitClaimRequest) {
        return Promise.resolve(request.waitKind === "event" ? [] : [claim]);
      },
      updateRunIfTimedWaitClaim() {
        return Promise.resolve(invalidResult);
      },
      releaseTimedWaitClaim() {
        releases++;
        return Promise.resolve(true);
      },
      getRun: () => Promise.resolve(run),
    } as unknown as WorkflowBackend;

    const recovered = await new TimedWaitRecoveryService(
      backend,
      "claim-non-boolean-owner",
    ).recover({ now, maxAwakened: 1 });

    assertEquals(recovered.awakenedRuns, []);
    assertEquals(recovered.outcomes, []);
    assertEquals(recovered.errors.length, 1);
    assertEquals(recovered.errors[0]?.runId, run.id);
    assertEquals(releases, 1);
  }
});

Deno.test("timed-wait recovery rejects non-boolean claim releases", async () => {
  const now = Date.now();
  const run = createDueDelayRun("claim-non-boolean-release", now);
  const claim: TimedWaitClaim = {
    run,
    nodeId: "delay",
    deadline: now - 1,
    claimId: "claim:non-boolean-release",
    leaseExpiresAt: new Date(now + 5_000),
    waitKind: "delay",
  };
  let releases = 0;
  const backend = {
    claimDueTimedWaits(request: TimedWaitClaimRequest) {
      return Promise.resolve(request.waitKind === "event" ? [] : [claim]);
    },
    updateRunIfTimedWaitClaim: () => Promise.resolve(false),
    releaseTimedWaitClaim() {
      releases++;
      return Promise.resolve({ released: true });
    },
    getRun: () => Promise.resolve(run),
  } as unknown as WorkflowBackend;

  const recovered = await new TimedWaitRecoveryService(
    backend,
    "claim-non-boolean-release-owner",
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
