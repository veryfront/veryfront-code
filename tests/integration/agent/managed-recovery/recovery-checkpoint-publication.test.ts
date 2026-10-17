import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { verifyControlPlaneRequest } from "#veryfront/internal-agents/control-plane-auth.ts";
import { RecoverySessionOwner } from "#veryfront/internal-agents/recovery-session-owner.ts";
import { DurableRunHome } from "#veryfront/internal-agents/durable-run-home.ts";

const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const identity = {
  projectId: "11111111-1111-4111-8111-111111111111",
  canonicalRunId: "22222222-2222-4222-8222-222222222222",
  publicRunId: "run-proof",
  agentId: "proof-agent",
  threadId: "77777777-7777-4777-8777-777777777777",
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
      projectId: value.identity.projectId,
      canonicalRunId: value.identity.canonicalRunId,
      publicRunId: value.identity.publicRunId,
      agentId: value.identity.agentId,
      threadId: value.identity.threadId,
    },
    generation: value.generation,
    acknowledgedEventId: 0,
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
    projectId: value.sourceBinding.projectId,
    requestId: identity.publicRunId,
  });
  Deno.env.set(envKey, publicKeyPem);
  const ctx = createCtx(publicKeyPem);
  ctx.projectId = value.sourceBinding.projectId;
  return await verifyControlPlaneRequest(
    new Request(`https://veryfront.test/api/control-plane/runs/${identity.publicRunId}/stream`, {
      method: "POST",
      headers: { "x-veryfront-control-plane-jws": jws },
    }),
    ctx,
    body,
  );
}

import { createManagedRecoveryWriter } from "#veryfront/internal-agents/managed-recovery-writer.ts";
import { createEphemeralAgentWithRuntimeOptions } from "#veryfront/agent/factory.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";

import {
  getRecoverySnapshotSchema,
  parseRecoverySnapshot,
} from "#veryfront/internal-agents/recovery-snapshot.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { createManagedRecoveryHostFactory } from "#veryfront/internal-agents/managed-recovery-host.ts";
import { createRecoverySourceManifest } from "#veryfront/internal-agents/recovery-source-manifest.ts";
import {
  readAuthenticatedRecoverySuffix,
  recoverySuffixPayloadHash,
} from "#veryfront/internal-agents/recovery-suffix.ts";

for (const crashAfterExposure of [false, true]) {
  it(`first native runtime append restores without local snapshot (exposure committed: ${crashAfterExposure})`, async () => {
    const previous = Deno.env.get(envKey);
    const directory = await makeTempDir();
    try {
      const value = admission();
      value.identity = { ...identity, sourceHash: createRecoverySourceManifest([]).hash };
      const claims = await signed(value);
      let cursor = { acknowledgedEventId: 0, acknowledgedExternalSequence: 0 };
      const owner = await RecoverySessionOwner.acquire({
        claims,
        directory: `${directory}/${identity.canonicalRunId}`,
        validateCurrentOwnership: async () => ({ ...receipt(value), ...cursor }),
        awaitRetiredPreviousOwner: async () => {},
      });
      let sealed: unknown;
      let acceptedEvent: Record<string, unknown> | undefined;
      let exposureEvent: Record<string, unknown> | undefined;
      const writer = await createManagedRecoveryWriter({
        claims,
        owner,
        directory,
        bindAdmissionWriter: () => {},
        append: async (event, _occurrence, checkpoint) => {
          if (acceptedEvent) {
            assertEquals(event.type, "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED");
            exposureEvent = event;
            cursor = { acknowledgedEventId: 13, acknowledgedExternalSequence: 2 };
            throw new Error("simulated crash after exposure commit");
          }
          assertEquals(event.type, "MESSAGES_SNAPSHOT");
          assertEquals(checkpoint !== undefined, true);
          acceptedEvent = event;
          sealed = {
            ...checkpoint!.snapshot,
            acknowledgedEventId: 10,
            acknowledgedExternalSequence: 1,
          };
          cursor = { acknowledgedEventId: 12, acknowledgedExternalSequence: 1 };
          if (!crashAfterExposure) {
            throw new Error("simulated crash after canonical checkpoint commit");
          }
          return {
            eventId: 10,
            externalSequence: 1,
            toolAdmissions: [],
            recoveryCheckpoint: {
              snapshot_event_id: 10,
              snapshot_external_sequence: 1,
              checkpoint_event_id: 12,
            },
          };
        },
      });
      writer.bindSignal(new AbortController().signal);
      const model = scriptedModel([{ text: "must not run" }], { only: "stream" });
      const runtime = createEphemeralAgentWithRuntimeOptions({
        model: "veryfront-cloud/openai/gpt-5.4",
        system: "Synthetic",
        maxSteps: 1,
      }, { resolveModelRuntime: () => model, persistRecoveryBoundary: writer.persistBoundary });
      const result = await runtime.stream({
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "test" }] }],
      });
      await result.toDataStreamResponse().text();
      assertEquals(sealed !== undefined, true);
      assertEquals(model.callCount, 0);
      const home = await DurableRunHome.open({
        directory: `${directory}/${identity.canonicalRunId}.snapshot`,
        identity: value.identity,
      });
      assertEquals((await home.read()).length, 0);
      const next = admission(1);
      next.identity = value.identity;
      next.acknowledgedExternalSequence = cursor.acknowledgedExternalSequence;
      const nextClaims = await signed(next);
      const fact = {
        type: "AGENT_RUN_MANAGED_RECOVERY_CONTINUATION_SEALED",
        version: 1,
        dispatchFactEventId: 1,
        generation: value.generation,
        source: { sourceHash: value.identity.sourceHash, sourceBinding: value.sourceBinding },
        snapshotEventId: 10,
        snapshotExternalSequence: 1,
        snapshot: sealed,
      };
      let corruption: "generation" | "dispatch" | "hash" | undefined;
      let readPage!: NonNullable<
        Parameters<typeof createManagedRecoveryHostFactory>[0]["readRecoverySuffixPage"]
      >;
      const factory = createManagedRecoveryHostFactory({
        sourceBinding: value.sourceBinding,
        durableDirectory: directory,
        listImmutableReleaseFiles: async () => ({ sourceBinding: value.sourceBinding, files: [] }),
        validateCurrentOwnership: async () => ({ ...receipt(next), ...cursor }),
        loadAcknowledgedSnapshot: async () => undefined,
        readRecoverySuffixPage: readPage = async (_claims, request) => {
          assertEquals([0, 10].includes(request.afterEventId), true);
          const firstPage = request.afterEventId === 0;
          return {
            version: 1,
            identity: receipt(next).identity,
            generation: next.generation,
            leaseRemainingMs: 10000,
            source: fact.source,
            target: cursor,
            events: firstPage
              ? [{
                eventId: 10,
                externalSequence: 1,
                eventType: "MESSAGES_SNAPSHOT",
                payload: acceptedEvent!,
                appendGeneration: corruption === "generation"
                  ? { ...value.generation, workerId: "foreign" }
                  : value.generation,
                dispatchFactEventId: corruption === "dispatch" ? 2 : 1,
                payloadHash: recoverySuffixPayloadHash(acceptedEvent!),
              }]
              : exposureEvent
              ? [{
                eventId: 13,
                externalSequence: 2,
                eventType: "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED",
                payload: exposureEvent,
                appendGeneration: value.generation,
                dispatchFactEventId: 1,
                payloadHash: recoverySuffixPayloadHash(exposureEvent),
              }]
              : [],
            continuations: firstPage ? [] : [{
              checkpointEventId: 12,
              fact,
              payloadHash: corruption === "hash" ? "f".repeat(64) : recoverySuffixPayloadHash(fact),
            }],
            nextAfterEventId: firstPage ? 10 : null,
          };
        },
      });
      const restored = await factory({
        claims: nextClaims,
        awaitRetiredPreviousOwner: async () => {},
      });
      assertEquals(restored.snapshot !== undefined, true);
      assertEquals(restored.owner.requiresRestoredSnapshot, true);
      const parsed = await restored.owner.validateRestoredSnapshot(restored.snapshot);
      assertEquals(parsed.runtimeContinuation?.nextStep, 0);
      assertEquals(parsed.acknowledgedExternalSequence, cursor.acknowledgedExternalSequence);
      for (const failure of ["generation", "dispatch", "hash"] as const) {
        corruption = failure;
        await assertRejects(
          () =>
            readAuthenticatedRecoverySuffix({
              claims: nextClaims,
              readPage: (request) => readPage(nextClaims, request),
              assertCurrentOwnership: () => restored.owner.assertCurrentOwnership(),
            }),
          Error,
          "suffix is incomplete or untrusted",
        );
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
      if (previous === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, previous);
    }
  });
}

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function boundary() {
  return {
    messages: [],
    providerReplayCheckpoints: [],
    toolExposureCheckpoint: { version: 2 as const, loadedToolNames: [] },
    runtimeContinuation: {
      version: 1 as const,
      nextStep: 0,
      messages: [],
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latestAssistantText: "",
      completed: false,
      recoveredEmptyResponse: false,
      recoveredInterruptedLocalToolBatch: false,
    },
  };
}
it("current owner skips a late admitted predecessor journal slot and fences the stale writer", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  const originalAppend = DurableRunHome.prototype.append;
  const oldEntered = barrier();
  const oldRelease = barrier();
  const oldPublished = barrier();
  try {
    const oldValue = admission();
    const oldClaims = await signed(oldValue);
    let current = oldValue;
    let sequence = 0;
    const ownership = async () => ({
      ...receipt(current),
      acknowledgedEventId: sequence + 1000,
      acknowledgedExternalSequence: sequence,
    });
    const oldOwner = await RecoverySessionOwner.acquire({
      claims: oldClaims,
      directory: `${directory}/${identity.canonicalRunId}`,
      validateCurrentOwnership: ownership,
      awaitRetiredPreviousOwner: async () => {},
    });
    const append = async (
      _event: Record<string, unknown>,
      _occurrence?: string,
      checkpoint?:
        import("#veryfront/internal-agents/recovery-checkpoint-contract.ts").RecoveryCheckpointSidecar,
    ) => {
      const seq = ++sequence;
      return {
        eventId: seq + 100,
        externalSequence: seq,
        toolAdmissions: [],
        ...(checkpoint
          ? {
            recoveryCheckpoint: {
              snapshot_event_id: seq + 100,
              snapshot_external_sequence: seq,
              checkpoint_event_id: seq + 1000,
            },
          }
          : {}),
      };
    };
    const oldWriter = await createManagedRecoveryWriter({
      claims: oldClaims,
      owner: oldOwner,
      directory,
      append,
      bindAdmissionWriter: () => {},
    });
    oldWriter.bindSignal(new AbortController().signal);
    DurableRunHome.prototype.append = async function (record) {
      const value = getRecoverySnapshotSchema().safeParse(record.value);
      if (
        value.success && value.data.binding.generation.workerId === oldValue.generation.workerId
      ) {
        oldEntered.resolve();
        await oldRelease.promise;
        await originalAppend.call(this, record);
        oldPublished.resolve();
        return;
      }
      if (value.success && record.sequence === 1) {
        oldRelease.resolve();
        await oldPublished.promise;
      }
      return await originalAppend.call(this, record);
    };
    const oldPending = oldWriter.persistBoundary(boundary());
    const oldRejected = assertRejects(() => oldPending, Error, "ownership is no longer current");
    await oldEntered.promise;
    current = admission(1);
    current.acknowledgedExternalSequence = sequence;
    const nextClaims = await signed(current);
    const nextOwner = await RecoverySessionOwner.acquire({
      claims: nextClaims,
      directory: `${directory}/${identity.canonicalRunId}`,
      validateCurrentOwnership: ownership,
      awaitRetiredPreviousOwner: async () => {},
    });
    const nextWriter = await createManagedRecoveryWriter({
      claims: nextClaims,
      owner: nextOwner,
      directory,
      append,
      bindAdmissionWriter: () => {},
    });
    nextWriter.bindSignal(new AbortController().signal);
    await nextWriter.persistBoundary(boundary());
    await oldRejected;
    const home = await DurableRunHome.open({
      directory: `${directory}/${identity.canonicalRunId}.snapshot`,
      identity,
    });
    const records = await home.read();
    assertEquals(records.length, 2);
    assertEquals(
      parseRecoverySnapshot(records[0]!.value).binding.generation,
      oldValue.generation,
    );
    assertEquals(
      parseRecoverySnapshot(records[1]!.value).binding.generation,
      current.generation,
    );
  } finally {
    oldRelease.resolve();
    DurableRunHome.prototype.append = originalAppend;
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

import type { RecoverySuffixPage } from "#veryfront/internal-agents/recovery-suffix.ts";
for (const keepOlderLocalSnapshot of [false, true]) {
  it(`successive canonical checkpoint crashes restore latest admitted generation (older local snapshot: ${keepOlderLocalSnapshot})`, async () => {
    const previous = Deno.env.get(envKey);
    const directory = await makeTempDir();
    try {
      const events: RecoverySuffixPage["events"] = [];
      const continuations: RecoverySuffixPage["continuations"] = [];
      let eventId = 0;
      let externalSequence = 0;
      let current = admission();
      current.identity = { ...identity, sourceHash: createRecoverySourceManifest([]).hash };
      let dispatchFactEventId = 0;
      let crashAfterCommit = true;
      const factory = createManagedRecoveryHostFactory({
        sourceBinding: current.sourceBinding,
        durableDirectory: directory,
        listImmutableReleaseFiles: async () => ({
          sourceBinding: current.sourceBinding,
          files: [],
        }),
        validateCurrentOwnership: async () => ({
          ...receipt(current),
          acknowledgedEventId: eventId,
          acknowledgedExternalSequence: externalSequence,
        }),
        loadAcknowledgedSnapshot: async () => {
          const home = await DurableRunHome.open({
            directory: `${directory}/${identity.canonicalRunId}.snapshot`,
            identity: current.identity,
          });
          return (await home.read()).at(-1)?.value;
        },
        readRecoverySuffixPage: async (_claims, request) => ({
          version: 1,
          identity: receipt(current).identity,
          generation: current.generation,
          leaseRemainingMs: 10000,
          source: { sourceHash: current.identity.sourceHash, sourceBinding: current.sourceBinding },
          target: { acknowledgedEventId: eventId, acknowledgedExternalSequence: externalSequence },
          events: events.filter((event) => event.eventId > request.afterEventId),
          continuations: continuations.filter((checkpoint) =>
            checkpoint.checkpointEventId > request.afterEventId
          ),
          nextAfterEventId: null,
        }),
        createToolAdmissionBinder: () => () => {},
        createEventAppender: async () => async (event, _occurrence, checkpoint) => {
          const id = ++eventId;
          const sequence = ++externalSequence;
          events.push({
            eventId: id,
            externalSequence: sequence,
            eventType: String(event.type),
            payload: JSON.parse(JSON.stringify(event)),
            appendGeneration: current.generation,
            dispatchFactEventId,
            payloadHash: recoverySuffixPayloadHash(event),
          });
          let checkpointId: number | undefined;
          if (checkpoint) {
            const snapshot = parseRecoverySnapshot({
              ...checkpoint.snapshot,
              acknowledgedEventId: id,
              acknowledgedExternalSequence: sequence,
            });
            const fact = {
              type: "AGENT_RUN_MANAGED_RECOVERY_CONTINUATION_SEALED" as const,
              version: 1 as const,
              dispatchFactEventId,
              generation: current.generation,
              source: {
                sourceHash: current.identity.sourceHash,
                sourceBinding: current.sourceBinding,
              },
              snapshotEventId: id,
              snapshotExternalSequence: sequence,
              snapshot,
            };
            checkpointId = ++eventId;
            continuations.push({
              checkpointEventId: checkpointId,
              fact,
              payloadHash: recoverySuffixPayloadHash(fact),
            });
            if (crashAfterCommit) throw new Error("simulated committed checkpoint crash");
          }
          return {
            eventId: id,
            externalSequence: sequence,
            toolAdmissions: [],
            ...(checkpointId
              ? {
                recoveryCheckpoint: {
                  snapshot_event_id: id,
                  snapshot_external_sequence: sequence,
                  checkpoint_event_id: checkpointId,
                },
              }
              : {}),
          };
        },
      });
      for (let generation = 0; generation < 3; generation++) {
        const next = admission(generation);
        next.identity = current.identity;
        next.acknowledgedExternalSequence = externalSequence;
        current = next;
        dispatchFactEventId = ++eventId;
        const claims = await signed(current);
        const hosted = await factory({ claims, awaitRetiredPreviousOwner: async () => {} });
        if (generation === 2) {
          const restored = await hosted.owner.validateRestoredSnapshot(hosted.snapshot);
          assertEquals(restored.binding.generation, admission(1).generation);
          assertEquals(restored.acknowledgedExternalSequence, externalSequence);
          break;
        }
        const writer = hosted.writer!;
        writer.bindSignal(new AbortController().signal);
        crashAfterCommit = !(keepOlderLocalSnapshot && generation === 0);
        const model = scriptedModel([{ text: "must not run" }], { only: "stream" });
        const runtime = createEphemeralAgentWithRuntimeOptions({
          model: "veryfront-cloud/openai/gpt-5.4",
          system: "Synthetic",
          maxSteps: 1,
        }, {
          resolveModelRuntime: () => model,
          persistRecoveryBoundary: async (boundary) => {
            await writer.persistBoundary(boundary);
            throw new Error("stop after durable native initial boundary");
          },
        });
        const result = await runtime.stream({
          messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "test" }] }],
        });
        await result.toDataStreamResponse().text();
        assertEquals(model.callCount, 0);
        const home = await DurableRunHome.open({
          directory: `${directory}/${identity.canonicalRunId}.snapshot`,
          identity: current.identity,
        });
        assertEquals((await home.read()).length, keepOlderLocalSnapshot ? 1 : 0);
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
      if (previous === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, previous);
    }
  });
}
