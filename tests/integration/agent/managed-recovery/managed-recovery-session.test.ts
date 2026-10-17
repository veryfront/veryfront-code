import { makeTempDir, waitFor } from "#veryfront/testing/deno-compat.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { createManagedRecoveryWriter } from "#veryfront/internal-agents/managed-recovery-writer.ts";
import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { verifyControlPlaneRequest } from "#veryfront/internal-agents/control-plane-auth.ts";
import { RecoverySessionOwner } from "#veryfront/internal-agents/recovery-session-owner.ts";

const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const identity = {
  agentId: "recovery-proof",
  threadId: "77777777-7777-4777-8777-777777777777",
  projectId: "11111111-1111-4111-8111-111111111111",
  canonicalRunId: "22222222-2222-4222-8222-222222222222",
  publicRunId: "run-proof",
  sourceHash: "a".repeat(64),
};
function admission(attempt = 0) {
  return {
    version: 1,
    identity,
    generation: {
      workerId: `worker-${attempt}`,
      dispatchNonce: `66666666-6666-4666-8666-${String(attempt).padStart(12, "0")}`,
      transportRecoveryAttempt: attempt,
    },
    acknowledgedExternalSequence: 0,
    leaseRemainingMs: 10_000,
    sourceBinding: {
      projectId: identity.projectId,
      environmentId: "33333333-3333-4333-8333-333333333333",
      releaseId: "44444444-4444-4444-8444-444444444444",
    },
    eventPersistence: "runtime-owned-v1" as const,
    expiresAt: Math.floor(Date.now() / 1000) + 30,
  };
}
function receipt(value = admission()) {
  return {
    version: 1,
    identity: {
      agentId: value.identity.agentId,
      threadId: value.identity.threadId,
      projectId: value.identity.projectId,
      canonicalRunId: value.identity.canonicalRunId,
      publicRunId: value.identity.publicRunId,
    },
    generation: value.generation,
    acknowledgedEventId: 1,
    acknowledgedExternalSequence: value.acknowledgedExternalSequence,
    leaseRemainingMs: value.leaseRemainingMs,
  };
}
async function signed(value = admission()) {
  const body = JSON.stringify({
    managedRecoveryAdmission: value,
    credentials: { authToken: "NEVER_PERSIST_TEST_CREDENTIAL" },
  });
  const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
    projectId: identity.projectId,
    requestId: identity.publicRunId,
  });
  Deno.env.set(envKey, publicKeyPem);
  const ctx = createCtx(publicKeyPem);
  ctx.projectId = identity.projectId;
  return await verifyControlPlaneRequest(
    new Request(`https://veryfront.test/api/control-plane/runs/${identity.publicRunId}/stream`, {
      method: "POST",
      headers: { "x-veryfront-control-plane-jws": jws },
    }),
    ctx,
    body,
  );
}

import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";

it("managed sessions require opt-in and genuine private claims", async () => {
  const previous = Deno.env.get(envKey);
  try {
    const claims = await signed();
    const manager = new AgentRunSessionManager();
    await assertRejects(() =>
      manager.startManagedRecoveryRun({
        runId: identity.publicRunId,
        threadId: identity.threadId,
        claims,
      })
    );
    await assertRejects(() =>
      manager.startManagedRecoveryRun({
        runId: identity.publicRunId,
        threadId: identity.threadId,
        claims: { ...claims },
      })
    );
    assertEquals(manager.getRunStatus(identity.publicRunId), null);
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("actual session replacement joins predecessor and fences its late finalizer", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  let current = admission();
  const prior = current;
  let retirements = 0;
  const manager = new AgentRunSessionManager({
    maxConcurrentSessions: 1,
    recoveryOwnerFactory: async ({ claims, awaitRetiredPreviousOwner }) => {
      const owner = await RecoverySessionOwner.acquire({
        claims,
        directory,
        validateCurrentOwnership: async () => receipt(current),
        awaitRetiredPreviousOwner: async (generation) => {
          retirements++;
          await awaitRetiredPreviousOwner(generation);
        },
      });
      return {
        owner,
        ...(owner.requiresRestoredSnapshot
          ? {
            snapshot: {
              version: 1,
              binding: {
                identity,
                generation: prior.generation,
                sourceBinding: prior.sourceBinding,
              },
              acknowledgedEventId: 1,
              acknowledgedExternalSequence: 0,
              messages: [],
              modelTurns: [],
              toolBoundaries: [],
              toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
            },
          }
          : {}),
      };
    },
  });
  try {
    const firstClaims = await signed(current);
    const first = await manager.startManagedRecoveryRun({
      runId: identity.publicRunId,
      threadId: identity.threadId,
      claims: firstClaims,
    });
    await assertRejects(() =>
      manager.startManagedRecoveryRun({
        runId: identity.publicRunId,
        threadId: identity.threadId,
        claims: firstClaims,
      })
    );
    assertEquals(first.signal.aborted, false);
    assertEquals(retirements, 0);
    current = admission(1);
    let replaced = false;
    const replacement = manager.startManagedRecoveryRun({
      runId: identity.publicRunId,
      threadId: identity.threadId,
      claims: await signed(current),
    }).then((value) => {
      replaced = true;
      return value;
    });
    // Wait until the real retirement callback aborts generation A, not a guessed timeout.
    await new Promise<void>((resolve) => {
      if (first.signal.aborted) resolve();
      else first.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    assertEquals(replaced, false);
    assertThrows(() => manager.startRun({ runId: "unrelated", threadId: identity.threadId }));
    manager.settleCancelledRun(identity.publicRunId, first.signal);
    assertEquals(manager.getRunStatus(identity.publicRunId), null);
    // Producer bookkeeping retirement alone must not free the managed owner slot.
    assertThrows(() => manager.startRun({ runId: "unrelated", threadId: identity.threadId }));
    first.settle();
    const second = await replacement;
    assertEquals(retirements, 1);
    assertEquals(second.signal.aborted, false);
    manager.settleCancelledRun(identity.publicRunId, first.signal);
    assertEquals(manager.getRunStatus(identity.publicRunId), "running");
    manager.failRun(identity.publicRunId, first.signal);
    assertEquals(manager.getRunStatus(identity.publicRunId), "running");
    manager.completeRun(identity.publicRunId, second.signal);
    second.settle();
    assertEquals(manager.getRunStatus(identity.publicRunId), null);
  } finally {
    manager.reset();
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

import {
  bindManagedRecoveryInput,
  getManagedRecoveryInputClaims,
} from "#veryfront/internal-agents/managed-recovery-input.ts";
import { createRuntimeAgentStreamResponse } from "#veryfront/internal-agents/run-stream.ts";
import { agent as createAgent } from "#veryfront/agent";

it("pre-producer setup failure restores its snapshot and late response cancellation preserves the replacement", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  const firstAdmission = admission();
  let current = firstAdmission;
  const manager = new AgentRunSessionManager({
    recoveryOwnerFactory: async ({ claims, awaitRetiredPreviousOwner }) => {
      const owner = await RecoverySessionOwner.acquire({
        claims,
        directory: `${directory}/owner`,
        validateCurrentOwnership: async () => ({
          ...receipt(current),
          // A predecessor event was acknowledged after the first setup attempt.
          acknowledgedExternalSequence: current.generation.transportRecoveryAttempt > 0 ? 1 : 0,
        }),
        awaitRetiredPreviousOwner,
      });
      return {
        owner,
        writer: await createManagedRecoveryWriter({
          claims,
          owner,
          directory,
          append: async () => ({ eventId: 1, externalSequence: 0, toolAdmissions: [] }),
          bindAdmissionWriter: () => {},
        }),
        ...(owner.requiresRestoredSnapshot
          ? {
            snapshot: {
              version: 1,
              binding: {
                identity,
                generation: firstAdmission.generation,
                sourceBinding: firstAdmission.sourceBinding,
              },
              acknowledgedEventId: 1,
              acknowledgedExternalSequence: 1,
              messages: [{
                id: "durable-user",
                role: "user",
                parts: [{ type: "text", text: "acknowledged durable input" }],
              }],
              runtimeContinuation: {
                version: 1,
                nextStep: 0,
                messages: [{
                  id: "durable-user",
                  role: "user",
                  parts: [{ type: "text", text: "acknowledged durable input" }],
                }],
                toolCalls: [],
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                latestAssistantText: "",
                completed: false,
                recoveredEmptyResponse: false,
                recoveredInterruptedLocalToolBatch: false,
              },
              modelTurns: [],
              toolBoundaries: [],
              toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
            },
          }
          : {}),
      };
    },
  });
  let retainedStop: () => void = () => {
    throw new Error("Managed response did not register its stop callback");
  };
  const registerStop = manager.stopRegistry.register.bind(manager.stopRegistry);
  manager.stopRegistry.register = (runId, stop) => {
    retainedStop = stop;
    return registerStop(runId, stop);
  };
  try {
    const agent = createAgent({
      id: "recovery-proof",
      model: "anthropic/test",
      system: "Synthetic test",
      skills: false,
    });
    for (const attempt of [0, 1]) {
      current = admission(attempt);
      const input = {
        runId: identity.publicRunId,
        threadId: identity.threadId,
        messages: [{ id: "request-user", role: "user" as const, content: "unrestored request" }],
        tools: [],
        context: [],
      };
      const claims = await signed(current);
      bindManagedRecoveryInput(input, claims);
      assertEquals(getManagedRecoveryInputClaims({ ...input }), undefined);
      let observed: unknown;
      const responsePromise = createRuntimeAgentStreamResponse(input, agent, {
        sessionManager: manager,
        createRuntime: () => {
          if (attempt === 0) throw new Error("synthetic setup failure before producer");
          return {
            stream: async (messages, _context, callbacks) => {
              observed = messages;
              callbacks?.onStreamCompletion?.(Promise.resolve());
              return new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.close();
                },
              });
            },
          };
        },
      });
      if (attempt === 0) {
        await assertRejects(
          () => responsePromise,
          Error,
          "synthetic setup failure before producer",
        );
        continue;
      }
      const response = await responsePromise;
      if (attempt === 1) {
        assertEquals(observed, [{
          id: "durable-user",
          role: "user",
          parts: [{ type: "text", text: "acknowledged durable input" }],
        }]);
        await waitFor(() => manager.getRunStatus(identity.publicRunId) === null);
        current = admission(2);
        const replacement = await manager.startManagedRecoveryRun({
          runId: identity.publicRunId,
          threadId: identity.threadId,
          claims: await signed(current),
        });
        assertEquals(replacement.signal.aborted, false);
        retainedStop();
        assertEquals(replacement.signal.aborted, false);
        // Leave the predecessor's queued response bytes unread, then detach it.
        await response.body!.cancel();
        assertEquals(replacement.signal.aborted, false);
        assertEquals(manager.getRunStatus(identity.publicRunId), "running");
        manager.completeRun(identity.publicRunId, replacement.signal);
        replacement.settle();
      }
    }
  } finally {
    manager.reset();
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

import { startManagedRecoveryLifetime } from "#veryfront/internal-agents/managed-recovery-lifetime.ts";
import { executeConfiguredTool } from "#veryfront/agent/runtime/tool-helpers.ts";

it("blocked renewal cannot extend the last live receipt deadline", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  let calls = 0;
  let unblock = () => {};
  const blocked = new Promise<unknown>((resolve) => {
    unblock = () => resolve(receipt());
  });
  let lifetime: Awaited<ReturnType<typeof startManagedRecoveryLifetime>> | undefined;
  try {
    const owner = await RecoverySessionOwner.acquire({
      claims: await signed(),
      directory,
      validateCurrentOwnership: async () => {
        calls++;
        if (calls > 4) return blocked;
        return { ...receipt(), leaseRemainingMs: 80 };
      },
      awaitRetiredPreviousOwner: async () => {},
    });
    let aborts = 0;
    const aborted = new Promise<void>((resolve) => {
      void startManagedRecoveryLifetime(owner, () => {
        aborts++;
        resolve();
      }).then((value) => {
        lifetime = value;
      });
    });
    await aborted;
    assertEquals(aborts, 1);
    assertEquals(calls > 4, true);
    await assertRejects(() => lifetime!.assertCurrent());
  } finally {
    lifetime?.stop();
    unblock();
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("actual stream denies a callable effect after live generation changes", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  const first = admission();
  let current = first;
  let effects = 0;
  const manager = new AgentRunSessionManager({
    recoveryOwnerFactory: async ({ claims, awaitRetiredPreviousOwner }) => {
      const owner = await RecoverySessionOwner.acquire({
        claims,
        directory: `${directory}/owner`,
        validateCurrentOwnership: async () => receipt(current),
        awaitRetiredPreviousOwner,
      });
      const writer = await createManagedRecoveryWriter({
        claims,
        owner,
        directory,
        append: async () => ({ eventId: 1, externalSequence: 0, toolAdmissions: [] }),
        bindAdmissionWriter: () => {},
      });
      return { owner, writer };
    },
  });
  try {
    const input = {
      runId: identity.publicRunId,
      threadId: identity.threadId,
      messages: [],
      tools: [],
      context: [],
    };
    bindManagedRecoveryInput(input, await signed(first));
    const agent = createAgent({
      id: "recovery-proof",
      model: "anthropic/test",
      system: "Synthetic",
      skills: false,
    });
    await assertRejects(() =>
      createRuntimeAgentStreamResponse(input, agent, {
        sessionManager: manager,
        createRuntime: () => ({
          stream: async () => {
            current = admission(1);
            await executeConfiguredTool("ledger", {}, {
              ledger: {
                id: "ledger",
                type: "function",
                description: "synthetic",
                inputSchemaJson: {},
                inputSchema: defineSchema((v) => v.object({}))(),
                execute: () => {
                  effects++;
                  return Promise.resolve({});
                },
              },
            });
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            });
          },
        }),
      })
    );
    assertEquals(effects, 0);
  } finally {
    manager.reset();
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("project WeakMap hooks cannot intercept recovery input authority", async () => {
  const previous = Deno.env.get(envKey);
  const originalSet = WeakMap.prototype.set;
  const originalGet = WeakMap.prototype.get;
  try {
    const claims = await signed();
    const input = {
      runId: identity.publicRunId,
      threadId: identity.threadId,
      messages: [],
      tools: [],
      context: [],
    };
    let intercepted = false;
    let actual;
    try {
      WeakMap.prototype.set = function (key, value) {
        if (value === claims) intercepted = true;
        return originalSet.call(this, key, value);
      };
      WeakMap.prototype.get = function (key) {
        const value = originalGet.call(this, key);
        if (value === claims) intercepted = true;
        return value;
      };
      bindManagedRecoveryInput(input, claims);
      actual = getManagedRecoveryInputClaims(input);
    } finally {
      WeakMap.prototype.set = originalSet;
      WeakMap.prototype.get = originalGet;
    }
    assertEquals(actual, claims);
    assertEquals(intercepted, false);
  } finally {
    WeakMap.prototype.set = originalSet;
    WeakMap.prototype.get = originalGet;
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("a verified recovery admission expiring before input binding cannot become an ordinary run", async () => {
  const previous = Deno.env.get(envKey);
  try {
    const value = { ...admission(), expiresAt: Math.floor(Date.now() / 1000) + 2 };
    const claims = await signed(value);
    const input = {
      runId: identity.publicRunId,
      threadId: identity.threadId,
      messages: [],
      tools: [],
      context: [],
    };
    await waitFor(() => Date.now() >= value.expiresAt * 1000);
    assertThrows(
      () => bindManagedRecoveryInput(input, claims),
      Error,
      "Managed recovery admission expired",
    );
    assertEquals(getManagedRecoveryInputClaims(input), undefined);
    bindManagedRecoveryInput(input, undefined);
    assertEquals(getManagedRecoveryInputClaims(input), undefined);
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("cancellation during successor acquisition prevents its producer from starting", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  let current = admission();
  let notifyGap = () => {};
  const gap = new Promise<void>((resolve) => {
    notifyGap = resolve;
  });
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const manager = new AgentRunSessionManager({
    recoveryOwnerFactory: async ({ claims, awaitRetiredPreviousOwner }) => {
      const owner = await RecoverySessionOwner.acquire({
        claims,
        directory,
        validateCurrentOwnership: async () => receipt(current),
        awaitRetiredPreviousOwner: async (generation) => {
          await awaitRetiredPreviousOwner(generation);
          notifyGap();
          await blocked;
        },
      });
      return {
        owner,
        ...(owner.requiresRestoredSnapshot
          ? {
            snapshot: {
              version: 1,
              binding: {
                identity,
                generation: admission().generation,
                sourceBinding: admission().sourceBinding,
              },
              acknowledgedEventId: 1,
              acknowledgedExternalSequence: 0,
              messages: [],
              modelTurns: [],
              toolBoundaries: [],
              toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
            },
          }
          : {}),
      };
    },
  });
  try {
    const first = await manager.startManagedRecoveryRun({
      runId: identity.publicRunId,
      threadId: identity.threadId,
      claims: await signed(current),
    });
    current = admission(1);
    const replacing = manager.startManagedRecoveryRun({
      runId: identity.publicRunId,
      threadId: identity.threadId,
      claims: await signed(current),
    });
    const outcome = replacing.then(() => undefined, (error: unknown) => error);
    await waitFor(() => first.signal.aborted);
    first.settle();
    await gap;
    const cancelled = manager.cancelRun(identity.publicRunId);
    release();
    const error = await outcome;
    assertEquals(cancelled, true);
    assertEquals(error instanceof Error ? error.message : undefined, "Run cancelled");
    assertEquals(manager.getRunStatus(identity.publicRunId), null);
  } finally {
    release();
    manager.reset();
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("cancelled ordinary cleanup blocks managed acquisition at combined capacity", async () => {
  const previous = Deno.env.get(envKey);
  let acquisitions = 0;
  const manager = new AgentRunSessionManager({
    maxConcurrentSessions: 1,
    recoveryOwnerFactory: () => {
      acquisitions++;
      return Promise.reject(new Error("factory reached"));
    },
  });
  try {
    const claims = await signed();
    const ordinary = manager.startRun({ runId: "ordinary", threadId: identity.threadId });
    manager.cancelRun("ordinary");
    await assertRejects(
      () =>
        manager.startManagedRecoveryRun({
          runId: identity.publicRunId,
          threadId: identity.threadId,
          claims,
        }),
      Error,
      "Maximum concurrent sessions",
    );
    assertEquals(acquisitions, 0);
    manager.settleCancelledRun("ordinary", ordinary);
    await assertRejects(
      () =>
        manager.startManagedRecoveryRun({
          runId: identity.publicRunId,
          threadId: identity.threadId,
          claims,
        }),
      Error,
      "factory reached",
    );
    assertEquals(acquisitions, 1);
  } finally {
    manager.reset();
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});
