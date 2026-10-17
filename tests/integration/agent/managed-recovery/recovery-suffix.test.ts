import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { getRecoverySuffixPageSchema } from "#veryfront/internal-agents/recovery-suffix.ts";

function page() {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const generation = {
    workerId: "worker-b",
    dispatchNonce: "66666666-6666-4666-8666-000000000002",
    transportRecoveryAttempt: 2,
  };
  return {
    version: 1,
    identity: {
      projectId,
      canonicalRunId: "22222222-2222-4222-8222-222222222222",
      publicRunId: "run-proof",
      agentId: "proof-agent",
      threadId: "77777777-7777-4777-8777-777777777777",
    },
    generation,
    leaseRemainingMs: 1000,
    source: {
      sourceHash: "a".repeat(64),
      sourceBinding: {
        projectId,
        environmentId: "33333333-3333-4333-8333-333333333333",
        releaseId: "44444444-4444-4444-8444-444444444444",
      },
    },
    target: { acknowledgedEventId: 102, acknowledgedExternalSequence: 7 },
    continuations: [],
    events: [{
      eventId: 101,
      externalSequence: 7,
      eventType: "STEP_FINISHED",
      payload: { stepName: "step-0" },
      appendGeneration: generation,
      dispatchFactEventId: 80,
      payloadHash: "b".repeat(64),
    }],
    nextAfterEventId: null,
  };
}

it("private suffix pages keep DB and external cursors separate and reject projected/unbounded input", () => {
  const schema = getRecoverySuffixPageSchema();
  assertEquals(schema.parse(page()).target.acknowledgedEventId, 102);
  assertEquals(schema.parse(page()).events[0]!.externalSequence, 7);
  assertThrows(() => schema.parse({ ...page(), credentials: { token: "synthetic" } }));
  assertThrows(() => schema.parse({ ...page(), events: Array(101).fill(page().events[0]) }));
  assertThrows(() => schema.parse({ ...page(), leaseRemainingMs: 0 }));
  const { appendGeneration: _omitted, ...projected } = page().events[0]!;
  assertThrows(() => schema.parse({ ...page(), events: [projected] }));
  assertThrows(() =>
    schema.parse({
      ...page(),
      target: { acknowledgedEventId: 0.5, acknowledgedExternalSequence: 7 },
    })
  );
});

import { assertRejects } from "#veryfront/testing/assert.ts";
import { parseRecoverySnapshot } from "#veryfront/internal-agents/recovery-snapshot.ts";
import {
  materializeAuthenticatedRecoverySuffix,
  readAuthenticatedRecoverySuffix,
  recoverySuffixPayloadHash,
} from "#veryfront/internal-agents/recovery-suffix.ts";

it("authenticated suffix preserves real continuation and rejects gaps, foreign provenance and ambiguous effects", async () => {
  const base = page();
  const snapshot = parseRecoverySnapshot({
    version: 1,
    binding: {
      identity: { ...base.identity, sourceHash: base.source.sourceHash },
      generation: { ...base.generation, workerId: "worker-a", transportRecoveryAttempt: 1 },
      sourceBinding: base.source.sourceBinding,
    },
    acknowledgedEventId: 90,
    acknowledgedExternalSequence: 6,
    messages: [],
    modelTurns: [],
    toolBoundaries: [],
    toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
    runtimeContinuation: {
      version: 1,
      nextStep: 3,
      messages: [],
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      latestAssistantText: "",
      completed: false,
      recoveredEmptyResponse: false,
      recoveredInterruptedLocalToolBatch: false,
    },
  });
  const admission = {
    version: 1 as const,
    identity: snapshot.binding.identity,
    generation: base.generation,
    sourceBinding: base.source.sourceBinding,
    acknowledgedExternalSequence: 7,
    eventPersistence: "runtime-owned-v1" as const,
    expiresAt: Math.floor(Date.now() / 1000) + 30,
    leaseRemainingMs: 1000,
  };
  const { createControlPlaneSignature, createCtx } = await import(
    "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts"
  );
  const { verifyControlPlaneRequest } = await import(
    "#veryfront/internal-agents/control-plane-auth.ts"
  );
  const body = JSON.stringify({ managedRecoveryAdmission: admission });
  const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
    projectId: admission.sourceBinding.projectId,
    requestId: admission.identity.publicRunId,
  });
  const previousKey = Deno.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
  Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);
  const ctx = createCtx(publicKeyPem);
  ctx.projectId = admission.sourceBinding.projectId;
  const claims = await verifyControlPlaneRequest(
    new Request(
      `https://veryfront.test/api/control-plane/runs/${admission.identity.publicRunId}/stream`,
      { method: "POST", headers: { "x-veryfront-control-plane-jws": jws } },
    ),
    ctx,
    body,
  );
  if (previousKey === undefined) Deno.env.delete("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
  else Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", previousKey);
  const receipt = {
    ...base.target,
    version: 1 as const,
    identity: base.identity,
    generation: base.generation,
    leaseRemainingMs: 1000,
  };
  const response = {
    ...base,
    events: base.events.map((event) => ({
      ...event,
      appendGeneration: snapshot.binding.generation,
      payloadHash: recoverySuffixPayloadHash(event.payload),
    })),
  };
  const read = (raw: unknown) =>
    readAuthenticatedRecoverySuffix({
      snapshot,
      claims,
      readPage: async () => raw,
      assertCurrentOwnership: async () => receipt,
    });
  const suffix = await read(response);
  const restored = materializeAuthenticatedRecoverySuffix({ snapshot, suffix });
  assertEquals(restored.acknowledgedEventId, 102);
  assertEquals(restored.acknowledgedExternalSequence, 7);
  assertEquals(restored.runtimeContinuation, snapshot.runtimeContinuation);
  assertThrows(() => materializeAuthenticatedRecoverySuffix({ snapshot, suffix: { ...suffix } }));
  for (
    const event of [
      { ...response.events[0]!, externalSequence: 8 },
      { ...response.events[0]!, appendGeneration: base.generation },
      { ...response.events[0]!, payloadHash: "0".repeat(64) },
    ]
  ) await assertRejects(() => read({ ...response, events: [event] }));
  const originalSome = Array.prototype.some;
  let foreignRejected = false;
  try {
    Array.prototype.some = () => false;
    try {
      await read({
        ...response,
        events: [{ ...response.events[0]!, appendGeneration: base.generation }],
      });
    } catch {
      foreignRejected = true;
    }
  } finally {
    Array.prototype.some = originalSome;
  }
  assertEquals(
    foreignRejected,
    true,
    "Project array hooks cannot waive suffix generation provenance",
  );
  for (
    const raw of [
      { ...response, events: [] },
      { ...response, events: [response.events[0], response.events[0]] },
      { ...response, nextAfterEventId: 90 },
      { ...response, target: { ...response.target, acknowledgedEventId: 103 } },
      { ...response, source: { ...response.source, sourceHash: "0".repeat(64) } },
    ]
  ) await assertRejects(() => read(raw));
  await assertRejects(() =>
    readAuthenticatedRecoverySuffix({
      snapshot,
      claims,
      readPage: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ...response, leaseRemainingMs: 1 };
      },
      assertCurrentOwnership: async () => receipt,
    })
  );
  let pageNumber = 0;
  const paged = await readAuthenticatedRecoverySuffix({
    snapshot,
    claims,
    readPage: async (request) => {
      pageNumber++;
      if (pageNumber === 1) return { ...response, events: [], nextAfterEventId: 100 };
      assertEquals(request.afterEventId, 100);
      assertEquals(request.throughEventId, 102);
      assertEquals(request.throughExternalSequence, 7);
      return response;
    },
    assertCurrentOwnership: async () => receipt,
  });
  assertEquals(
    materializeAuthenticatedRecoverySuffix({ snapshot, suffix: paged }).acknowledgedEventId,
    102,
  );
  const effect = { ...response.events[0]!, eventType: "TOOL_CALL_RESULT" };
  const ambiguous = await read({ ...response, events: [effect] });
  assertThrows(() => materializeAuthenticatedRecoverySuffix({ snapshot, suffix: ambiguous }));
  const stateful = {
    ...response.events[0]!,
    eventType: "MESSAGES_SNAPSHOT",
    payload: { messages: [] },
  };
  stateful.payloadHash = recoverySuffixPayloadHash(stateful.payload);
  const safeSnapshot = parseRecoverySnapshot({
    ...snapshot,
    acknowledgedEventId: 101,
    acknowledgedExternalSequence: 7,
    runtimeContinuation: {
      ...snapshot.runtimeContinuation,
      nextStep: 4,
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    },
  });
  const fact = {
    type: "AGENT_RUN_MANAGED_RECOVERY_CONTINUATION_SEALED",
    version: 1,
    dispatchFactEventId: 80,
    generation: snapshot.binding.generation,
    source: response.source,
    snapshotEventId: 101,
    snapshotExternalSequence: 7,
    snapshot: safeSnapshot,
  };
  const continuation = {
    checkpointEventId: 102,
    fact,
    payloadHash: recoverySuffixPayloadHash(fact),
  };
  const sealed = await read({ ...response, events: [stateful], continuations: [continuation] });
  const recovered = materializeAuthenticatedRecoverySuffix({ snapshot, suffix: sealed });
  assertEquals(recovered.runtimeContinuation?.nextStep, 4);
  assertEquals(recovered.runtimeContinuation?.usage.totalTokens, 30);
  await assertRejects(() =>
    read({
      ...response,
      events: [stateful],
      continuations: [{ ...continuation, payloadHash: "0".repeat(64) }],
    })
  );
  await assertRejects(() =>
    read({
      ...response,
      events: [stateful],
      continuations: [{ ...continuation, checkpointEventId: 101 }],
    })
  );
  suffix.events[0]!.eventType = "TOOL_CALL_RESULT";
  assertThrows(() => materializeAuthenticatedRecoverySuffix({ snapshot, suffix }));
});

it("suffix payload hashes match the shared API Unicode decoded-JSON vector", () => {
  assertEquals(
    recoverySuffixPayloadHash({ z: [2, 1], a: { "𐀀": "value", "é": "␀\u0000", A: -0 } }),
    "24defef7097dd5e5fa1923ddf121f2d88704d1239c23d0e6e028fc84b5f2a978",
  );
});
