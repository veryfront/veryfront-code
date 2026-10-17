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

it("real cross-project runtime boundaries omit private message metadata while preserving signed bindings", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const value = admission();
    value.sourceBinding.projectId = "77777777-7777-4777-8777-777777777777";
    const claims = await signed(value);
    const owner = await RecoverySessionOwner.acquire({
      claims,
      directory: `${directory}/owner`,
      validateCurrentOwnership: async () => receipt(value),
      awaitRetiredPreviousOwner: async () => {},
    });
    let sequence = 0;
    const events: string[] = [];
    // Local authenticated-append fixture: this is not staging API evidence.
    const writer = await createManagedRecoveryWriter({
      claims,
      owner,
      directory,
      bindAdmissionWriter: () => {},
      append: async (event, _occurrenceId, checkpoint) => {
        events.push(String(event.type));
        sequence++;
        return {
          eventId: sequence + 100,
          externalSequence: sequence,
          toolAdmissions: [],
          ...(checkpoint
            ? {
              recoveryCheckpoint: {
                snapshot_event_id: sequence + 100,
                snapshot_external_sequence: sequence,
                checkpoint_event_id: sequence + 10000,
              },
            }
            : {}),
        };
      },
    });
    writer.bindSignal(new AbortController().signal);
    const model = scriptedModel([{ text: "Synthetic complete" }], { only: "stream" });
    let capturedMetadata = false;
    const metadataRuntime = createEphemeralAgentWithRuntimeOptions({
      model: "veryfront-cloud/openai/gpt-5.4",
      system: "Synthetic",
      maxSteps: 1,
    }, {
      resolveModelRuntime: () => model,
      persistRecoveryBoundary: async (boundary) => {
        capturedMetadata ||= boundary.runtimeContinuation?.messages.some((message) =>
          message.metadata !== undefined
        ) ?? false;
        await writer.persistBoundary(boundary);
      },
    });
    const result = await metadataRuntime.stream({
      messages: [{
        id: "synthetic-user",
        role: "user",
        parts: [{ type: "text", text: "Synthetic request" }],
        metadata: { privatePolicy: "NEVER_PERSIST_PRIVATE_POLICY" },
      }],
    });
    await result.toDataStreamResponse().text();
    const home = await DurableRunHome.open({
      directory: `${directory}/${identity.canonicalRunId}.snapshot`,
      identity,
    });
    const records = await home.read();
    assertEquals(records.length >= 2, true);
    const { parseRecoverySnapshot } = await import(
      "#veryfront/internal-agents/recovery-snapshot.ts"
    );
    const snapshot = parseRecoverySnapshot(records.at(-1)!.value);
    assertEquals(capturedMetadata, true);
    assertEquals(snapshot.runtimeContinuation !== undefined, true);
    assertEquals(JSON.stringify(records).includes("NEVER_PERSIST_PRIVATE_POLICY"), false);
    assertEquals(snapshot.messages.every((message) => !("metadata" in message)), true);
    assertEquals(
      snapshot.runtimeContinuation!.messages.every((message) => !("metadata" in message)),
      true,
    );
    const { getRecoveryContinuationSchema } = await import(
      "#veryfront/internal-agents/recovery-snapshot.ts"
    );
    assertEquals(
      getRecoveryContinuationSchema().safeParse({
        ...snapshot.runtimeContinuation,
        messages: snapshot.runtimeContinuation!.messages.map((message) => ({
          ...message,
          metadata: { privatePolicy: "NEVER_PERSIST_PRIVATE_POLICY" },
        })),
      }).success,
      false,
    );
    assertEquals(snapshot.binding.identity.projectId, identity.projectId);
    assertEquals(snapshot.binding.sourceBinding, value.sourceBinding);
    assertEquals(events.includes("MESSAGES_SNAPSHOT"), true);
    assertEquals(model.callCount, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("completed incoming tool history continues without inventing current-run admission and collisions fail closed", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const value = admission();
    const claims = await signed(value);
    const owner = await RecoverySessionOwner.acquire({
      claims,
      directory: `${directory}/owner`,
      validateCurrentOwnership: async () => receipt(value),
      awaitRetiredPreviousOwner: async () => {},
    });
    let sequence = 0;
    const writer = await createManagedRecoveryWriter({
      claims,
      owner,
      directory,
      bindAdmissionWriter: () => {},
      append: async (_event, _occurrenceId, checkpoint) => ({
        eventId: ++sequence,
        externalSequence: sequence,
        toolAdmissions: [],
        ...(checkpoint
          ? {
            recoveryCheckpoint: {
              snapshot_event_id: sequence,
              snapshot_external_sequence: sequence,
              checkpoint_event_id: sequence + 10000,
            },
          }
          : {}),
      }),
    });
    writer.bindSignal(new AbortController().signal);
    const { AgentRuntime } = await import("#veryfront/agent/runtime/index.ts");
    const model = scriptedModel([{ text: "Continued from history" }], { only: "stream" });
    const runtime = new AgentRuntime("history-proof", {
      model: "veryfront-cloud/openai/gpt-5.4",
      system: "Synthetic",
      maxSteps: 1,
      skills: false,
    }, {
      resolveModelRuntime: () => model,
      persistRecoveryBoundary: writer.persistBoundary,
    });
    const messages = [
      {
        id: "old-assistant",
        role: "assistant" as const,
        parts: [{
          type: "tool-call" as const,
          toolCallId: "old-call",
          toolName: "inspect",
          args: {},
        }],
      },
      {
        id: "old-result",
        role: "tool" as const,
        parts: [{
          type: "tool-result" as const,
          toolCallId: "old-call",
          toolName: "inspect",
          result: { ok: true },
        }],
      },
      {
        id: "new-user",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Continue" }],
      },
    ];
    await new Response(await runtime.stream(messages, { runId: identity.publicRunId })).text();
    assertEquals(model.callCount, 1);
    const home = await DurableRunHome.open({
      directory: `${directory}/${identity.canonicalRunId}.snapshot`,
      identity,
    });
    assertEquals((await home.read()).length >= 2, true);
    await Deno.mkdir(`${directory}/missing`);
    const missingWriter = await createManagedRecoveryWriter({
      claims,
      owner,
      directory: `${directory}/missing`,
      bindAdmissionWriter: () => {},
      append: async (_event, _occurrenceId, checkpoint) => ({
        eventId: ++sequence,
        externalSequence: sequence,
        toolAdmissions: [],
        ...(checkpoint
          ? {
            recoveryCheckpoint: {
              snapshot_event_id: sequence,
              snapshot_external_sequence: sequence,
              checkpoint_event_id: sequence + 10000,
            },
          }
          : {}),
      }),
    });
    missingWriter.bindSignal(new AbortController().signal);
    const missingModel = scriptedModel([{ text: "Must not run" }], { only: "stream" });
    const missingRuntime = new AgentRuntime("missing-history", {
      model: "veryfront-cloud/openai/gpt-5.4",
      system: "Synthetic",
      skills: false,
    }, {
      resolveModelRuntime: () => missingModel,
      persistRecoveryBoundary: missingWriter.persistBoundary,
    });
    await new Response(await missingRuntime.stream([messages[0]!, messages[2]!])).text();
    assertEquals(missingModel.callCount, 0);
    const { assertRejects } = await import("#veryfront/testing/assert.ts");
    await assertRejects(() =>
      writer.appendMappedEvent({
        event: "ToolCallStart",
        payload: { toolCallId: "old-call", toolCallName: "inspect" },
      }, crypto.randomUUID())
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("actual original tool frames admit intent before callback and acknowledge result before durable continuation", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const value = admission();
    const claims = await signed(value);
    const owner = await RecoverySessionOwner.acquire({
      claims,
      directory: `${directory}/owner`,
      validateCurrentOwnership: async () => receipt(value),
      awaitRetiredPreviousOwner: async () => {},
    });
    let cursor = 0;
    let effects = 0;
    const order: string[] = [];
    const writer = await createManagedRecoveryWriter({
      claims,
      owner,
      directory,
      bindAdmissionWriter: () => {},
      append: async (event, occurrenceId, checkpoint) => {
        cursor++;
        order.push(String(event.type));
        const eventId = cursor;
        return {
          eventId,
          externalSequence: cursor,
          ...(checkpoint
            ? {
              recoveryCheckpoint: {
                snapshot_event_id: eventId,
                snapshot_external_sequence: cursor,
                checkpoint_event_id: eventId + 10000,
              },
            }
            : {}),
          toolAdmissions: event.type === "TOOL_CALL_START"
            ? [{
              occurrenceId: occurrenceId!,
              admissionEventId: String(1000 + cursor),
              startEventId: String(eventId),
              toolCallId: String(event.toolCallId),
              publicToolCallId: String(event.toolCallId),
              projectId: identity.projectId,
              runId: identity.canonicalRunId,
            }]
            : [],
        };
      },
    });
    writer.bindSignal(new AbortController().signal);
    const { tool } = await import("#veryfront/tool");
    const { defineSchema } = await import("#veryfront/schemas/index.ts");
    const { runWithToolCallOccurrences } = await import(
      "#veryfront/runtime/tool-call-occurrence.ts"
    );
    const { runWithRecoveryToolExecutionPolicy } = await import(
      "#veryfront/runtime/execution-ownership-guard.ts"
    );
    const { parseSseJsonEvents, createStreamTransformState, mapRuntimeEventToAgUi } = await import(
      "#veryfront/internal-agents/ag-ui-sse.ts"
    );
    const model = scriptedModel([{
      toolCalls: [{ id: "current-call", name: "inspect", input: {} }],
    }, { text: "Complete" }], { only: "stream" });
    const runtime = createEphemeralAgentWithRuntimeOptions({
      model: "veryfront-cloud/openai/gpt-5.4",
      system: "Synthetic",
      maxSteps: 2,
      tools: {
        inspect: tool({
          id: "inspect",
          description: "Synthetic",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => {
            effects++;
            order.push("ACTUAL_EFFECT");
            return Promise.resolve({ ok: true });
          },
        }),
      },
    }, { resolveModelRuntime: () => model, persistRecoveryBoundary: writer.persistBoundary });
    const result = await runWithRecoveryToolExecutionPolicy(
      writer.executeTool,
      () => runWithToolCallOccurrences(() => runtime.stream({ input: "Synthetic" })),
    );
    const reader = result.toDataStreamResponse().body!.getReader();
    const decoder = new TextDecoder();
    const state = createStreamTransformState();
    let remainder = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const parsed = parseSseJsonEvents(remainder + decoder.decode(chunk.value, { stream: true }));
      remainder = parsed.remainder;
      for (const event of parsed.events) {
        for (const mapped of mapRuntimeEventToAgUi(state, event)) {
          await writer.appendMappedEvent(
            mapped,
            mapped.event === "ToolCallStart" &&
              typeof event.privateToolCallOccurrenceId === "string"
              ? event.privateToolCallOccurrenceId
              : undefined,
          );
        }
      }
    }
    reader.releaseLock();
    assertEquals(effects, 1);
    assertEquals(model.callCount, 2);
    assertEquals(order.indexOf("TOOL_CALL_START") < order.indexOf("ACTUAL_EFFECT"), true);
    assertEquals(order.indexOf("ACTUAL_EFFECT") < order.indexOf("TOOL_CALL_RESULT"), true);
    const home = await DurableRunHome.open({
      directory: `${directory}/${identity.canonicalRunId}.snapshot`,
      identity,
    });
    const { parseRecoverySnapshot } = await import(
      "#veryfront/internal-agents/recovery-snapshot.ts"
    );
    const snapshot = parseRecoverySnapshot((await home.read()).at(-1)!.value);
    assertEquals(snapshot.toolBoundaries[0]!.kind, "acknowledged-receipt");
    assertEquals(snapshot.runtimeContinuation?.nextStep, 2);
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("actual managed startup skill obtains original occurrence admission before loader execution", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const { registerSkill, skillRegistryInternal } = await import("#veryfront/skill/registry.ts");
    const { createSkillTestAdapter } = await import("#veryfront/skill/testing.ts");
    const { createLoadSkillTool } = await import("#veryfront/skill/tools.ts");
    await import("#veryfront/skill/_test-setup.ts");
    skillRegistryInternal.clearAll();
    registerSkill("recovery-plan", {
      id: "recovery-plan",
      rootPath: "/skills/recovery-plan",
      metadata: { name: "recovery-plan", description: "Synthetic" },
      fsAdapter: createSkillTestAdapter({
        "/skills/recovery-plan/SKILL.md": "# Recovery bootstrap",
      }),
    });
    const value = admission();
    const claims = await signed(value);
    const owner = await RecoverySessionOwner.acquire({
      claims,
      directory: `${directory}/owner`,
      validateCurrentOwnership: async () => receipt(value),
      awaitRetiredPreviousOwner: async () => {},
    });
    let cursor = 0;
    const order: string[] = [];
    const writer = await createManagedRecoveryWriter({
      claims,
      owner,
      directory,
      bindAdmissionWriter: () => {},
      append: async (event, occurrenceId, checkpoint) => {
        cursor++;
        order.push(String(event.type));
        const eventId = cursor;
        return {
          eventId,
          externalSequence: cursor,
          ...(checkpoint
            ? {
              recoveryCheckpoint: {
                snapshot_event_id: eventId,
                snapshot_external_sequence: cursor,
                checkpoint_event_id: eventId + 10000,
              },
            }
            : {}),
          toolAdmissions: event.type === "TOOL_CALL_START"
            ? [{
              occurrenceId: occurrenceId!,
              admissionEventId: String(1000 + cursor),
              startEventId: String(eventId),
              toolCallId: String(event.toolCallId),
              publicToolCallId: String(event.toolCallId),
              projectId: identity.projectId,
              runId: identity.canonicalRunId,
            }]
            : [],
        };
      },
    });
    writer.bindSignal(new AbortController().signal);
    const { runWithToolCallOccurrences } = await import(
      "#veryfront/runtime/tool-call-occurrence.ts"
    );
    const { runWithRecoveryToolExecutionPolicy } = await import(
      "#veryfront/runtime/execution-ownership-guard.ts"
    );
    const { parseSseJsonEvents, createStreamTransformState, mapRuntimeEventToAgUi } = await import(
      "#veryfront/internal-agents/ag-ui-sse.ts"
    );
    const model = scriptedModel([{ text: "Complete" }], { only: "stream" });
    const runtime = createEphemeralAgentWithRuntimeOptions({
      model: "veryfront-cloud/openai/gpt-5.4",
      system: "Synthetic",
      maxSteps: 1,
      bootstrapSkill: "recovery-plan",
      skills: ["recovery-plan"],
      tools: { load_skill: createLoadSkillTool() },
    }, { resolveModelRuntime: () => model, persistRecoveryBoundary: writer.persistBoundary });
    const result = await runWithRecoveryToolExecutionPolicy(
      writer.executeTool,
      () => runWithToolCallOccurrences(() => runtime.stream({ input: "Synthetic" })),
    );
    const reader = result.toDataStreamResponse().body!.getReader();
    const decoder = new TextDecoder();
    const state = createStreamTransformState();
    let remainder = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const parsed = parseSseJsonEvents(remainder + decoder.decode(chunk.value, { stream: true }));
      remainder = parsed.remainder;
      for (const event of parsed.events) {
        for (const mapped of mapRuntimeEventToAgUi(state, event)) {
          await writer.appendMappedEvent(
            mapped,
            mapped.event === "ToolCallStart" &&
              typeof event.privateToolCallOccurrenceId === "string"
              ? event.privateToolCallOccurrenceId
              : undefined,
          );
        }
      }
    }
    reader.releaseLock();
    assertEquals(model.callCount, 1);
    assertEquals(order.indexOf("TOOL_CALL_START") < order.indexOf("TOOL_CALL_RESULT"), true);
    const home = await DurableRunHome.open({
      directory: `${directory}/${identity.canonicalRunId}.snapshot`,
      identity,
    });
    const { parseRecoverySnapshot } = await import(
      "#veryfront/internal-agents/recovery-snapshot.ts"
    );
    const snapshot = parseRecoverySnapshot((await home.read()).at(-1)!.value);
    assertEquals(snapshot.toolBoundaries[0]!.kind, "acknowledged-receipt");
    assertEquals(snapshot.runtimeContinuation?.nextStep, 1);
  } finally {
    (await import("#veryfront/skill/registry.ts")).skillRegistryInternal.clearAll();
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("safe snapshot publication rejects an API that ignores the atomic checkpoint sidecar", async () => {
  const { assertRejects } = await import("#veryfront/testing/assert.ts");
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const value = admission();
    const claims = await signed(value);
    const owner = await RecoverySessionOwner.acquire({
      claims,
      directory: `${directory}/owner`,
      validateCurrentOwnership: async () => receipt(value),
      awaitRetiredPreviousOwner: async () => {},
    });
    let sequence = 0;
    let observedSidecar = false;
    const { createManagedRecoveryWriter } = await import(
      "#veryfront/internal-agents/managed-recovery-writer.ts"
    );
    const writer = await createManagedRecoveryWriter({
      claims,
      owner,
      directory,
      bindAdmissionWriter: () => {},
      append: async (_event, _occurrence, sidecar) => {
        if (sidecar) observedSidecar = true;
        return { eventId: ++sequence, externalSequence: sequence, toolAdmissions: [] };
      },
    });
    writer.bindSignal(new AbortController().signal);
    await assertRejects(() =>
      writer.persistBoundary({
        messages: [],
        providerReplayCheckpoints: [],
        toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
        runtimeContinuation: {
          version: 1,
          nextStep: 0,
          messages: [],
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          latestAssistantText: "",
          completed: false,
          recoveredEmptyResponse: false,
          recoveredInterruptedLocalToolBatch: false,
        },
      })
    );
    assertEquals(observedSidecar, true);
    const home = await DurableRunHome.open({
      directory: `${directory}/${identity.canonicalRunId}.snapshot`,
      identity,
    });
    assertEquals((await home.read()).length, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("provider-executed current calls persist replay without waiting for local admission", async () => {
  const previous = Deno.env.get(envKey);
  const directory = await makeTempDir();
  try {
    const value = admission();
    const claims = await signed(value);
    const owner = await RecoverySessionOwner.acquire({
      claims,
      directory: `${directory}/owner`,
      validateCurrentOwnership: async () => receipt(value),
      awaitRetiredPreviousOwner: async () => {},
    });
    let sequence = 0;
    const writer = await createManagedRecoveryWriter({
      claims,
      owner,
      directory,
      bindAdmissionWriter: () => {},
      append: async () => ({ eventId: ++sequence, externalSequence: sequence, toolAdmissions: [] }),
    });
    const controller = new AbortController();
    writer.bindSignal(controller.signal);
    const exposure = {
      version: 2,
      loadedToolNames: [],
    } satisfies import("#veryfront/agent/runtime/index.ts").AgentRuntimeRecoveryBoundary[
      "toolExposureCheckpoint"
    ];
    await writer.persistBoundary({
      messages: [],
      toolExposureCheckpoint: exposure,
      providerReplayCheckpoints: [],
    });
    const call = {
      type: "tool-call",
      toolCallId: "provider-search",
      toolName: "web_search",
      args: { query: "synthetic" },
      providerExecuted: true,
    } as const;
    const result = {
      type: "tool-result",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      result: [],
      providerExecuted: true,
    } as const;
    const timer = setTimeout(
      () => controller.abort(new Error("Provider call waited for local admission")),
      200,
    );
    try {
      await writer.persistBoundary({
        messages: [{
          id: "provider-turn",
          role: "assistant",
          parts: [call, { ...result, result: [] }],
        }],
        toolExposureCheckpoint: exposure,
        providerReplayCheckpoints: [{
          version: 1,
          messageId: "provider-turn",
          provider: "anthropic",
          providerBlocks: [
            {
              type: "provider-block",
              provider: "anthropic",
              block: {
                type: "server_tool_use",
                id: call.toolCallId,
                name: call.toolName,
                input: call.args,
                caller: { type: "direct" },
              },
            },
            {
              type: "provider-block",
              provider: "anthropic",
              block: {
                type: "web_search_tool_result",
                tool_use_id: call.toolCallId,
                caller: { type: "direct" },
                content: [],
              },
            },
          ],
          providerBlockPositions: [0, 1],
          totalPartCount: 2,
        }],
      });
    } finally {
      clearTimeout(timer);
    }
    const home = await DurableRunHome.open({
      directory: `${directory}/${identity.canonicalRunId}.snapshot`,
      identity,
    });
    const { parseRecoverySnapshot } = await import(
      "#veryfront/internal-agents/recovery-snapshot.ts"
    );
    const snapshot = parseRecoverySnapshot((await home.read()).at(-1)!.value);
    assertEquals(snapshot.toolBoundaries, []);
    assertEquals(snapshot.modelTurns[0]?.providerReplayCheckpoint?.messageId, "provider-turn");
  } finally {
    await Deno.remove(directory, { recursive: true });
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

for (
  const failureKind of ["admission", "result", "malformed-admission", "foreign-admission"] as const
) {
  it(`persistence failure retires pending ${failureKind} work without an external abort`, async () => {
    const previous = Deno.env.get(envKey);
    const directory = await makeTempDir();
    const controller = new AbortController();
    let pending: Promise<unknown> | undefined;
    try {
      const claims = await signed();
      const owner = await RecoverySessionOwner.acquire({
        claims,
        directory: `${directory}/owner`,
        validateCurrentOwnership: async () => receipt(),
        awaitRetiredPreviousOwner: async () => {},
      });
      let fail = false;
      let cursor = 0;
      let effects = 0;
      const outage = new Error("Synthetic durable append failure");
      const writer = await createManagedRecoveryWriter({
        claims,
        owner,
        directory,
        bindAdmissionWriter: () => {},
        append: async (event, occurrenceId) => {
          if (
            fail && failureKind !== "malformed-admission" && failureKind !== "foreign-admission"
          ) throw outage;
          return {
            eventId: ++cursor,
            externalSequence: cursor,
            toolAdmissions:
              event.type === "TOOL_CALL_START" && (!fail || failureKind === "foreign-admission")
                ? [{
                  occurrenceId: occurrenceId!,
                  admissionEventId: "admit",
                  startEventId: String(cursor),
                  toolCallId: "call",
                  publicToolCallId: "public-call",
                  projectId: fail && failureKind === "foreign-admission"
                    ? "77777777-7777-4777-8777-777777777777"
                    : identity.projectId,
                  runId: identity.canonicalRunId,
                }]
                : [],
          };
        },
      });
      writer.bindSignal(controller.signal);
      const {
        runWithToolCallOccurrences,
        introduceToolCallOccurrence,
        runWithToolCallOccurrenceDispatch,
      } = await import("#veryfront/runtime/tool-call-occurrence.ts");
      const { runWithRecoveryToolExecutionPolicy } = await import(
        "#veryfront/runtime/execution-ownership-guard.ts"
      );
      const { executeConfiguredTool } = await import("#veryfront/agent/runtime/tool-helpers.ts");
      const { tool } = await import("#veryfront/tool");
      const { defineSchema } = await import("#veryfront/schemas/index.ts");
      let occurrenceId = "";
      if (failureKind === "result") {
        await writer.persistBoundary({
          messages: [],
          toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
          providerReplayCheckpoints: [],
        });
        await writer.appendMappedEvent({
          event: "ToolCallStart",
          payload: { toolCallId: "call", toolCallName: "inspect" },
        }, "occurrence");
        pending = writer.persistBoundary({
          messages: [{
            id: "model",
            role: "assistant",
            parts: [{ type: "tool-call", toolCallId: "call", toolName: "inspect", args: {} }],
          }, {
            id: "result",
            role: "tool",
            parts: [{
              type: "tool-result",
              toolCallId: "call",
              toolName: "inspect",
              result: { ok: true },
            }],
          }],
          toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
          providerReplayCheckpoints: [],
        });
      } else {
        pending = runWithToolCallOccurrences(() => {
          const call = { id: "call" };
          occurrenceId = introduceToolCallOccurrence(call) ?? "";
          return runWithToolCallOccurrenceDispatch(
            call,
            () =>
              runWithRecoveryToolExecutionPolicy(
                writer.executeTool,
                () =>
                  executeConfiguredTool("inspect", {}, {
                    inspect: tool({
                      id: "inspect",
                      description: "Synthetic effect",
                      inputSchema: defineSchema((v) => v.object({}))(),
                      execute: () => {
                        effects++;
                        return Promise.resolve({ ok: true });
                      },
                    }),
                  }),
              ),
          );
        });
      }
      const retired = pending.then(() => "resolved", () => "rejected");
      fail = true;
      const { assertRejects } = await import("#veryfront/testing/assert.ts");
      await assertRejects(() =>
        writer.appendMappedEvent(
          failureKind === "result"
            ? { event: "ToolCallResult", payload: { toolCallId: "call", result: { ok: true } } }
            : { event: "ToolCallStart", payload: { toolCallId: "call", toolCallName: "inspect" } },
          occurrenceId,
        )
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        assertEquals(
          await Promise.race([
            retired,
            new Promise<string>((resolve) => {
              timer = setTimeout(() => resolve("pending"), 200);
            }),
          ]),
          "rejected",
        );
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      assertEquals(controller.signal.aborted, false);
      assertEquals(effects, 0);
      await assertRejects(() =>
        writer.persistBoundary({
          messages: [],
          toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
          providerReplayCheckpoints: [],
        })
      );
    } finally {
      controller.abort();
      await pending?.catch(() => {});
      await Deno.remove(directory, { recursive: true });
      if (previous === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, previous);
    }
  });
}
