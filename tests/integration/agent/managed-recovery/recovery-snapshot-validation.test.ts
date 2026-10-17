import { createRuntimeLoadSkillTool } from "#veryfront/agent/runtime/load-skill-tool.ts";
import { createToolsFromHostDefinitions, type HostToolSet } from "#veryfront/tool";
import { markTrustedHostToolSet } from "#veryfront/tool/host-tool-provenance.ts";
import { getToolResultPartSchema } from "#veryfront/agent/schemas/agent.schema.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { parseAgentPauseCheckpoint } from "#veryfront/agent/runtime/manual-pause.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  parseRecoverySnapshot,
  validateRecoverySnapshotForRestore,
} from "#veryfront/internal-agents/recovery-snapshot.ts";

import { convertAgentRuntimeMessagesToProviderMessages } from "#veryfront/agent/runtime/message-adapter.ts";

import { recoveryHistoryMessageDigest } from "#veryfront/internal-agents/recovery-history.ts";

function fixture() {
  const identity = {
    projectId: "11111111-1111-4111-8111-111111111111",
    canonicalRunId: "22222222-2222-4222-8222-222222222222",
    publicRunId: "snapshot-proof",
    sourceHash: "a".repeat(64),
  };
  const result = {
    type: "tool-result",
    toolCallId: "call-1",
    toolName: "ledger",
    result: { receiptId: "effect-1" },
  };
  return {
    version: 1,
    binding: {
      identity,
      generation: {
        workerId: "worker-a",
        dispatchNonce: "66666666-6666-4666-8666-666666666666",
        transportRecoveryAttempt: 0,
      },
      sourceBinding: {
        projectId: identity.projectId,
        environmentId: "33333333-3333-4333-8333-333333333333",
        releaseId: "44444444-4444-4444-8444-444444444444",
      },
    },
    acknowledgedEventId: 42,
    acknowledgedExternalSequence: 2,
    messages: [
      {
        id: "model-1",
        role: "assistant",
        parts: [{
          type: "tool-ledger",
          toolCallId: "call-1",
          toolName: "ledger",
          args: { value: "synthetic" },
        }],
      },
      { id: "result-1", role: "tool", parts: [result] },
    ],
    modelTurns: [{
      messageId: "model-1",
      acknowledgedExternalSequence: 1,
      providerReplayCheckpoint: {
        version: 1,
        messageId: "model-1",
        provider: "anthropic",
        providerBlocks: [{
          type: "provider-block",
          provider: "anthropic",
          block: { type: "tool_use", id: "call-1", name: "ledger", input: { value: "synthetic" } },
        }],
        providerBlockPositions: [0],
        totalPartCount: 1,
      },
    }],
    toolExposureCheckpoint: { version: 2, loadedToolNames: ["ledger"] },
    toolBoundaries: [{
      kind: "acknowledged-receipt",
      modelMessageId: "model-1",
      toolName: "ledger",
      admissionReceipt: {
        occurrenceId: "55555555-5555-4555-8555-555555555555",
        admissionEventId: "admit-1",
        startEventId: "start-1",
        toolCallId: "call-1",
        publicToolCallId: "canonical-call-1",
        projectId: identity.projectId,
        runId: identity.canonicalRunId,
      },
      input: { value: "synthetic" },
      result,
      resultEventId: "result-event-1",
      acknowledgedExternalSequence: 2,
    }],
  };
}

it("admission proof is distinct from an acknowledged effect and ambiguous intent cannot restore", () => {
  const value = fixture();
  const original = value.toolBoundaries[0]!;
  const pending = {
    ...value,
    messages: [value.messages[0]],
    toolBoundaries: [{
      kind: "admitted-intent",
      modelMessageId: original.modelMessageId,
      toolName: original.toolName,
      admissionReceipt: original.admissionReceipt,
      input: original.input,
    }],
  };
  const parsed = parseRecoverySnapshot(pending);
  assertEquals(parsed.toolBoundaries[0]?.kind, "admitted-intent");
  assertThrows(() => validateRecoverySnapshotForRestore(pending, parsed.binding));
});

it("source release and full generation must match the expected snapshot binding", () => {
  const value = fixture();
  const binding = parseRecoverySnapshot(value).binding;
  for (
    const expected of [
      { ...binding, identity: { ...binding.identity, sourceHash: "b".repeat(64) } },
      {
        ...binding,
        sourceBinding: {
          ...binding.sourceBinding,
          releaseId: "77777777-7777-4777-8777-777777777777",
        },
      },
      {
        ...binding,
        generation: {
          ...binding.generation,
          dispatchNonce: "77777777-7777-4777-8777-777777777777",
        },
      },
    ]
  ) assertThrows(() => validateRecoverySnapshotForRestore(value, expected));
});

it("real provider semantic validation and transcript reconstruction fail closed", () => {
  const mismatchedProvider = fixture();
  mismatchedProvider.modelTurns[0]!.providerReplayCheckpoint.providerBlocks[0]!.provider =
    "openai-responses";
  assertThrows(() => parseRecoverySnapshot(mismatchedProvider));
  const sparse = fixture();
  sparse.modelTurns[0]!.providerReplayCheckpoint.totalPartCount = 2;
  const sparseParsed = parseRecoverySnapshot(sparse);
  assertThrows(() => validateRecoverySnapshotForRestore(sparse, sparseParsed.binding));
  const alteredTranscript = fixture();
  alteredTranscript.modelTurns[0]!.providerReplayCheckpoint.providerBlocks[0]!.block.input.value =
    "different";
  const alteredParsed = parseRecoverySnapshot(alteredTranscript);
  assertThrows(() => validateRecoverySnapshotForRestore(alteredTranscript, alteredParsed.binding));
  const duplicateTools = fixture();
  duplicateTools.toolExposureCheckpoint.loadedToolNames.push("ledger");
  assertThrows(() => parseRecoverySnapshot(duplicateTools));
});

it("untracked calls, duplicate occurrences, mismatched receipts and unacknowledged sequence fail closed", () => {
  const missing = fixture();
  missing.toolBoundaries = [];
  assertThrows(() => parseRecoverySnapshot(missing));
  const duplicate = fixture();
  duplicate.toolBoundaries.push(duplicate.toolBoundaries[0]!);
  assertThrows(() => parseRecoverySnapshot(duplicate));
  const foreign = fixture();
  foreign.toolBoundaries[0]!.admissionReceipt.runId = "77777777-7777-4777-8777-777777777777";
  assertThrows(() => parseRecoverySnapshot(foreign));
  const future = fixture();
  future.toolBoundaries[0]!.acknowledgedExternalSequence = 3;
  assertThrows(() => parseRecoverySnapshot(future));
  const reusedAdmission = fixture();
  reusedAdmission.toolBoundaries[0]!.resultEventId =
    reusedAdmission.toolBoundaries[0]!.admissionReceipt.admissionEventId;
  assertThrows(() => parseRecoverySnapshot(reusedAdmission));
  const prematureResult = fixture();
  prematureResult.toolBoundaries[0]!.acknowledgedExternalSequence = 1;
  assertThrows(() => parseRecoverySnapshot(prematureResult));
  const wrongInput = fixture();
  wrongInput.toolBoundaries[0]!.input.value = "different";
  assertThrows(() => parseRecoverySnapshot(wrongInput));
  const wrongResult = fixture();
  wrongResult.toolBoundaries[0]!.result = {
    ...wrongResult.toolBoundaries[0]!.result,
    result: { receiptId: "different" },
  };
  assertThrows(() => parseRecoverySnapshot(wrongResult));
});

it("snapshots reject credential envelopes, executable values and oversized data", () => {
  assertThrows(() =>
    parseRecoverySnapshot({ ...fixture(), credentials: { authToken: "synthetic" } })
  );
  assertThrows(() => parseRecoverySnapshot({ ...fixture(), resume: () => {} }));
  const oversized = fixture();
  oversized.toolBoundaries[0]!.input.value = "x".repeat(1024 * 1024);
  assertThrows(() => parseRecoverySnapshot(oversized));
});

it("snapshots require an actual positive safe database acknowledgement independent of external sequence", () => {
  const value = fixture();
  assertEquals(parseRecoverySnapshot(value).acknowledgedEventId, 42);
  assertEquals(parseRecoverySnapshot(value).acknowledgedExternalSequence, 2);
  for (const acknowledgedEventId of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assertThrows(() => parseRecoverySnapshot({ ...value, acknowledgedEventId }));
  }
  const { acknowledgedEventId: _omitted, ...missing } = value;
  assertThrows(() => parseRecoverySnapshot(missing));
});

it("snapshot source project must match its canonical execution project", () => {
  const value = fixture();
  assertThrows(() =>
    parseRecoverySnapshot({
      ...value,
      binding: {
        ...value.binding,
        sourceBinding: {
          ...value.binding.sourceBinding,
          projectId: "99999999-9999-4999-8999-999999999999",
        },
      },
    })
  );
});

it("sealed historical assistant messages need no current execution model acknowledgement", () => {
  const value = fixture();
  const history = {
    id: "prior-assistant",
    role: "assistant" as const,
    parts: [{ text: "Earlier answer", type: "text" as const }],
  };
  const parsed = parseRecoverySnapshot({
    ...value,
    messages: [history, ...value.messages],
    initialHistoryMessageIds: [history.id],
    initialHistoryMessageDigests: [recoveryHistoryMessageDigest(history)],
  });
  assertEquals(parsed.messages[0]?.id, history.id);
  assertEquals(parsed.modelTurns.length, 1);
});

it("tool inputs and results use structural JSON equality", () => {
  const value = fixture();
  const call = value.messages[0]!;
  const boundary = value.toolBoundaries[0]!;
  const reordered = {
    ...value,
    messages: [{
      ...call,
      parts: [{
        type: "tool-ledger",
        toolCallId: "call-1",
        toolName: "ledger",
        args: { a: 1, b: 2 },
      }],
    }, value.messages[1]],
    toolBoundaries: [{ ...boundary, input: { b: 2, a: 1 } }],
  };
  assertEquals(parseRecoverySnapshot(reordered).toolBoundaries.length, 1);
  assertThrows(() =>
    parseRecoverySnapshot({
      ...reordered,
      toolBoundaries: [{ ...boundary, input: { a: 2, b: 1 } }],
    })
  );
});

it("provider-owned tools require exact reconstructible provider replay rather than local admission", () => {
  const value = fixture();
  const call = {
    type: "tool-call",
    toolCallId: "provider-search",
    toolName: "web_search",
    args: { query: "synthetic" },
    providerExecuted: true,
  };
  const result = {
    type: "tool-result",
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    result: [],
    providerExecuted: true,
  };
  const provider = {
    ...value,
    messages: [{ id: "model-1", role: "assistant", parts: [call, result] }],
    toolBoundaries: [],
    toolExposureCheckpoint: { version: 2, loadedToolNames: [] },
    modelTurns: [{
      messageId: "model-1",
      acknowledgedExternalSequence: 1,
      providerReplayCheckpoint: {
        version: 1,
        messageId: "model-1",
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
      },
    }],
  };
  const parsed = parseRecoverySnapshot(provider);
  assertEquals(parsed.toolBoundaries.length, 0);
  validateRecoverySnapshotForRestore(provider, parsed.binding);
  const continuation = {
    version: 1,
    nextStep: 1,
    messages: provider.messages,
    toolCalls: [],
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    latestAssistantText: "",
    completed: false,
    recoveredEmptyResponse: false,
    recoveredInterruptedLocalToolBatch: false,
    providerMetadata: [{
      messageId: "model-1",
      metadata: {
        anthropic: {
          rawAssistantMessages: [
            provider.modelTurns[0]!.providerReplayCheckpoint.providerBlocks.map((part) =>
              part.block
            ),
          ],
        },
      },
    }],
  };
  assertEquals(
    parseRecoverySnapshot({ ...provider, runtimeContinuation: continuation }).runtimeContinuation
      ?.providerMetadata?.length,
    1,
  );
  const responseEntry = {
    id: call.toolCallId,
    name: call.toolName,
    args: call.args,
    status: "completed",
    result: result.result,
  };
  assertEquals(
    parseRecoverySnapshot({
      ...provider,
      runtimeContinuation: { ...continuation, toolCalls: [responseEntry] },
    }).runtimeContinuation?.toolCalls[0]?.id,
    call.toolCallId,
  );
  assertThrows(() =>
    parseRecoverySnapshot({
      ...provider,
      runtimeContinuation: {
        ...continuation,
        toolCalls: [{ ...responseEntry, result: ["foreign"] }],
      },
    })
  );
  assertThrows(() =>
    parseRecoverySnapshot({
      ...provider,
      runtimeContinuation: {
        ...continuation,
        toolExposureCheckpoint: { version: 2, loadedToolNames: ["foreign-tool"] },
      },
    })
  );
  assertThrows(() =>
    parseRecoverySnapshot({
      ...provider,
      modelTurns: [{ messageId: "model-1", acknowledgedExternalSequence: 1 }],
    })
  );
  assertThrows(() =>
    parseRecoverySnapshot({
      ...provider,
      messages: [{
        id: "model-1",
        role: "assistant",
        parts: [call, { ...result, result: ["forged"] }],
      }],
    })
  );
  assertThrows(() =>
    parseRecoverySnapshot({
      ...provider,
      messages: [{
        id: "model-1",
        role: "assistant",
        parts: [{ ...call, providerExecuted: false }, result],
      }],
    })
  );
});

it("continuation cannot introduce unverified provider replay metadata", () => {
  const value = fixture();
  const messages = [{
    id: "model-1",
    role: "assistant",
    parts: [{ type: "text", text: "Canonical" }],
  }];
  assertThrows(() =>
    parseRecoverySnapshot({
      ...value,
      messages,
      modelTurns: [{ messageId: "model-1", acknowledgedExternalSequence: 1 }],
      toolBoundaries: [],
      runtimeContinuation: {
        version: 1,
        nextStep: 1,
        messages,
        toolCalls: [],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        latestAssistantText: "Canonical",
        completed: false,
        recoveredEmptyResponse: false,
        recoveredInterruptedLocalToolBatch: false,
        providerMetadata: [{
          messageId: "model-1",
          metadata: { anthropic: { rawAssistantMessages: [[{ type: "text", text: "Foreign" }]] } },
        }],
      },
    })
  );
});

it("sealed historical provider calls do not require current execution replay", () => {
  const value = fixture();
  const messages = [{
    id: "history-provider",
    role: "assistant",
    parts: [
      {
        type: "tool-call",
        toolCallId: "history-call",
        toolName: "web_search",
        args: { query: "Earlier" },
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "history-call",
        toolName: "web_search",
        result: [],
        providerExecuted: true,
      },
    ],
  }];
  const parsed = parseRecoverySnapshot({
    ...value,
    messages,
    modelTurns: [],
    toolBoundaries: [],
    initialHistoryMessageIds: [messages[0]!.id],
    initialHistoryMessageDigests: [recoveryHistoryMessageDigest(messages[0]!)],
  });
  assertEquals(parsed.modelTurns.length, 0);
});

it("continuation and restore bindings use structural JSON equality", () => {
  const value = fixture();
  const messages = [{ id: "model-1", role: "assistant", parts: [{ type: "text", text: "hello" }] }];
  const snapshot = {
    ...value,
    messages,
    toolBoundaries: [],
    modelTurns: [{ messageId: "model-1", acknowledgedExternalSequence: 1 }],
    runtimeContinuation: {
      version: 1,
      nextStep: 1,
      messages: [{ id: "model-1", role: "assistant", parts: [{ text: "hello", type: "text" }] }],
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latestAssistantText: "hello",
      completed: false,
      recoveredEmptyResponse: false,
      recoveredInterruptedLocalToolBatch: false,
    },
  };
  for (const extra of [{ metadata: { syntheticCredential: "test-only" } }, { foreign: true }]) {
    assertThrows(() =>
      parseRecoverySnapshot({
        ...snapshot,
        runtimeContinuation: {
          ...snapshot.runtimeContinuation,
          messages: snapshot.runtimeContinuation.messages.map((message) => ({
            ...message,
            ...extra,
          })),
        },
      })
    );
  }
  const parsed = parseRecoverySnapshot(snapshot);
  validateRecoverySnapshotForRestore(snapshot, {
    sourceBinding: parsed.binding.sourceBinding,
    generation: parsed.binding.generation,
    identity: parsed.binding.identity,
  });
  assertThrows(() =>
    parseRecoverySnapshot({
      ...snapshot,
      runtimeContinuation: {
        ...snapshot.runtimeContinuation,
        messages: [{ ...messages[0], parts: [{ type: "text", text: "foreign" }] }],
      },
    })
  );
});

it("tool result roles agree with the native provider transcript for current and historical messages", () => {
  for (const role of ["user", "system", "assistant", "tool"] as const) {
    const value = fixture();
    const current = {
      ...value,
      messages: [value.messages[0], { ...value.messages[1], role }],
      modelTurns: [
        { messageId: "model-1", acknowledgedExternalSequence: 1 },
        ...(role === "assistant"
          ? [{ messageId: "result-1", acknowledgedExternalSequence: 1 }]
          : []),
      ],
    };
    const historical = {
      ...current,
      initialHistoryMessageIds: current.messages.map((message) => message!.id),
      initialHistoryMessageDigests: current.messages.map((message) =>
        recoveryHistoryMessageDigest(message!)
      ),
      modelTurns: [],
      toolBoundaries: [],
    };
    if (role === "user" || role === "system") {
      assertThrows(() => parseRecoverySnapshot(current));
      assertThrows(() => parseRecoverySnapshot(historical));
    } else {
      for (const snapshot of [current, historical]) {
        const restored = validateRecoverySnapshotForRestore(
          snapshot,
          parseRecoverySnapshot(snapshot).binding,
        );
        const transcript = convertAgentRuntimeMessagesToProviderMessages(restored.messages);
        assertEquals(transcript.filter((message) => message.role === "tool").length, 1);
      }
    }
  }
});

function continuationFixture() {
  const value = fixture();
  return {
    ...value,
    runtimeContinuation: {
      version: 1,
      nextStep: 1,
      messages: value.messages,
      toolCalls: [{
        id: "call-1",
        name: "ledger",
        args: { value: "synthetic" },
        status: "completed",
        result: { receiptId: "effect-1" },
      }],
      usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
      latestAssistantText: "",
      completed: false,
      recoveredEmptyResponse: false,
      recoveredInterruptedLocalToolBatch: false,
    },
  };
}

it("continuation cannot invent delegation policy without a current trusted activation", () => {
  const value = continuationFixture();
  for (const activeSkillDelegationOverrides of [{}, { model: "openai/gpt-5.4", maxSteps: 20 }]) {
    assertThrows(() =>
      parseRecoverySnapshot({
        ...value,
        runtimeContinuation: { ...value.runtimeContinuation, activeSkillDelegationOverrides },
      })
    );
  }
});

it("continuation response bookkeeping cannot contradict acknowledged tool facts", () => {
  const value = continuationFixture();
  assertEquals(parseRecoverySnapshot(value).runtimeContinuation?.toolCalls.length, 1);
  for (
    const change of [
      { id: "untracked" },
      { name: "foreign" },
      { args: { value: "different" } },
      { status: "pending" },
      { status: "executing" },
      { status: "error", error: "forged" },
      { result: { receiptId: "FORGED" } },
      { error: "forged" },
      { inputText: "foreign input" },
    ]
  ) {
    assertThrows(() =>
      parseRecoverySnapshot({
        ...value,
        runtimeContinuation: {
          ...value.runtimeContinuation,
          toolCalls: [{ ...value.runtimeContinuation.toolCalls[0], ...change }],
        },
      })
    );
  }
  assertThrows(() =>
    parseRecoverySnapshot({
      ...value,
      runtimeContinuation: {
        ...value.runtimeContinuation,
        toolCalls: [...value.runtimeContinuation.toolCalls, ...value.runtimeContinuation.toolCalls],
      },
    })
  );
  // Runtime response bookkeeping is a subset: history and omitted interrupted
  // calls can be in the transcript without being returned as ToolCall entries.
  assertEquals(
    parseRecoverySnapshot({
      ...value,
      runtimeContinuation: { ...value.runtimeContinuation, toolCalls: [] },
    }).runtimeContinuation?.toolCalls,
    [],
  );
});

it("continuation reference lists reject duplicate, unknown and wrong-role messages", () => {
  const value = continuationFixture();
  for (
    const runtimeGeneratedMessageIds of [
      ["missing"],
      ["model-1"],
      ["result-1"],
      ["missing", "missing"],
    ]
  ) {
    assertThrows(() =>
      parseRecoverySnapshot({
        ...value,
        runtimeContinuation: { ...value.runtimeContinuation, runtimeGeneratedMessageIds },
      })
    );
  }
  for (const trustedSkillLoadResultIds of [["missing"], ["call-1"], ["call-1", "call-1"]]) {
    assertThrows(() =>
      parseRecoverySnapshot({
        ...value,
        runtimeContinuation: { ...value.runtimeContinuation, trustedSkillLoadResultIds },
      })
    );
  }
});

it("continuation summaries retain native error outcomes without inventing results", () => {
  const value = continuationFixture();
  const result = { ...value.toolBoundaries[0]!.result, result: { error: "Synthetic failure" } };
  const failed = {
    ...value,
    messages: [value.messages[0], { id: "result-1", role: "tool", parts: [result] }],
    toolBoundaries: [{ ...value.toolBoundaries[0], result }],
  };
  for (const output of [{}, { result: result.result }]) {
    const entry = {
      id: "call-1",
      name: "ledger",
      args: { value: "synthetic" },
      status: "error",
      error: "Synthetic failure",
      ...output,
    };
    const snapshot = {
      ...failed,
      runtimeContinuation: {
        ...value.runtimeContinuation,
        messages: failed.messages,
        toolCalls: [entry],
      },
    };
    assertEquals(
      parseRecoverySnapshot(snapshot).runtimeContinuation?.toolCalls[0]?.status,
      "error",
    );
    for (
      const change of [{ status: "completed" }, { error: "foreign" }, {
        result: { receiptId: "foreign" },
      }]
    ) {
      assertThrows(() =>
        parseRecoverySnapshot({
          ...snapshot,
          runtimeContinuation: {
            ...snapshot.runtimeContinuation,
            toolCalls: [{ ...entry, ...change }],
          },
        })
      );
    }
  }
});

it("continuation presentation text matches native assistant and interrupted recovery text", () => {
  const value = continuationFixture();
  const messages = [
    { id: "text-1", role: "assistant", parts: [{ type: "text", text: "Before " }] },
    ...value.messages,
    { id: "text-2", role: "assistant", parts: [{ type: "text", text: "after" }] },
  ];
  const modelTurns = [
    { messageId: "text-1", acknowledgedExternalSequence: 1 },
    ...value.modelTurns,
    { messageId: "text-2", acknowledgedExternalSequence: 2 },
  ];
  const ordinary = {
    ...value,
    messages,
    modelTurns,
    runtimeContinuation: { ...value.runtimeContinuation, messages, latestAssistantText: "after" },
  };
  parseRecoverySnapshot(ordinary);
  assertThrows(() =>
    parseRecoverySnapshot({
      ...ordinary,
      runtimeContinuation: { ...ordinary.runtimeContinuation, latestAssistantText: "FORGED" },
    })
  );
  const recovery = {
    ...ordinary,
    runtimeContinuation: {
      ...ordinary.runtimeContinuation,
      recoveredInterruptedLocalToolBatch: true,
      interruptedLocalToolBatchRecoveryText: "Before ",
      latestAssistantText: "Before after",
    },
  };
  parseRecoverySnapshot(recovery);
  assertThrows(() =>
    parseRecoverySnapshot({
      ...recovery,
      runtimeContinuation: {
        ...recovery.runtimeContinuation,
        interruptedLocalToolBatchRecoveryText: "FOREIGN ",
        latestAssistantText: "FOREIGN after",
      },
    })
  );
});

it("continuation bookkeeping supports sealed history and native skill reference lists", () => {
  const value = continuationFixture();
  const result = {
    skillId: "synthetic",
    instructions: "Use the synthetic checklist.",
    model: "openai/gpt-5.4",
    maxSteps: 20,
  };
  const messages = [
    {
      id: "history-call",
      role: "assistant",
      parts: [{
        type: "tool-load_skill",
        toolName: "load_skill",
        toolCallId: "skill-call",
        args: { skillId: "synthetic" },
      }],
    },
    {
      id: "history-result",
      role: "tool",
      parts: [{
        type: "tool-result",
        toolName: "load_skill",
        toolCallId: "skill-call",
        result,
      }],
    },
    { id: "runtime-note", role: "user", parts: [{ type: "text", text: "Synthetic runtime note" }] },
  ];
  const history = {
    ...value,
    messages,
    modelTurns: [],
    toolBoundaries: [],
    initialHistoryMessageIds: messages.slice(0, 2).map((message) => message.id),
    initialHistoryMessageDigests: messages.slice(0, 2).map(recoveryHistoryMessageDigest),
    runtimeContinuation: {
      ...value.runtimeContinuation,
      messages,
      toolCalls: [{
        id: "skill-call",
        name: "load_skill",
        args: { skillId: "synthetic" },
        status: "completed",
        result,
      }],
      trustedSkillLoadResultIds: ["skill-call"],
      runtimeGeneratedMessageIds: ["runtime-note"],
    },
  };
  assertEquals(parseRecoverySnapshot(history).runtimeContinuation?.trustedSkillLoadResultIds, [
    "skill-call",
  ]);
  assertThrows(() =>
    parseRecoverySnapshot({
      ...history,
      runtimeContinuation: {
        ...history.runtimeContinuation,
        activeSkillDelegationOverrides: { model: "openai/gpt-5.4", maxSteps: 20 },
      },
    })
  );
  for (const field of ["trustedSkillLoadResultIds", "runtimeGeneratedMessageIds"]) {
    assertThrows(() =>
      parseRecoverySnapshot({
        ...history,
        runtimeContinuation: {
          ...history.runtimeContinuation,
          [field]: field === "trustedSkillLoadResultIds"
            ? ["skill-call", "skill-call"]
            : ["runtime-note", "runtime-note"],
        },
      })
    );
  }
});

it("real native pause writer retains consistent optimized and failed tool summaries", async () => {
  for (const outcome of ["large-success", "returned-error", "thrown-error"]) {
    const model = scriptedModel([
      { toolCalls: [{ id: "call-1", name: "ledger", input: { value: "synthetic" } }] },
      { text: "Complete" },
    ], { only: "stream" });
    let saved: unknown;
    const runtime = new AgentRuntime("snapshot-bookkeeping-proof", {
      model: "veryfront-cloud/openai/gpt-5.4",
      system: "Synthetic bookkeeping proof",
      skills: false,
      maxSteps: 2,
      toolResultContext: { maxInlineBytes: 32, previewBytes: 16, maxSectionBytes: 1024 },
      tools: {
        ledger: tool({
          id: "ledger",
          description: "Synthetic result",
          inputSchema: defineSchema((v) => v.object({ value: v.string() }))(),
          execute: () => {
            if (outcome === "thrown-error") throw new Error("Synthetic failure");
            return outcome === "returned-error"
              ? { error: "Synthetic failure" }
              : { receiptId: "effect-1", payload: "synthetic".repeat(1024) };
          },
        }),
      },
    }, {
      resolveModelRuntime: () => model,
      manualPause: {
        load: () => Promise.resolve(null),
        acknowledge: (checkpoint) => {
          if (checkpoint.nextStep !== 1) return Promise.resolve(false);
          saved = structuredClone(checkpoint);
          return Promise.resolve(true);
        },
      },
    });
    await new Response(
      await runtime.stream([{
        id: "request",
        role: "user",
        parts: [{ type: "text", text: "Synthetic request" }],
      }]),
    ).text();
    const continuation = parseAgentPauseCheckpoint(saved);
    const modelMessage = continuation.messages.find((message) => message.role === "assistant");
    const result = continuation.messages.flatMap((message) => message.parts).find((part) =>
      part.type === "tool-result" && "toolCallId" in part && part.toolCallId === "call-1"
    );
    assertEquals(model.callCount, 1);
    if (!modelMessage || !result) throw new Error("Native writer omitted the settled tool facts");
    const value = fixture();
    const snapshot = {
      ...value,
      runtimeContinuation: continuation,
      toolExposureCheckpoint: continuation.toolExposureCheckpoint ?? value.toolExposureCheckpoint,
      messages: continuation.messages,
      modelTurns: [{ messageId: modelMessage.id, acknowledgedExternalSequence: 1 }],
      toolBoundaries: [{ ...value.toolBoundaries[0], modelMessageId: modelMessage.id, result }],
    };
    assertEquals(
      parseRecoverySnapshot(snapshot).runtimeContinuation?.toolCalls[0]?.status,
      outcome === "large-success" ? "completed" : "error",
    );
  }
});

for (const resetPolicy of [false, true]) {
  it(`real native skill delegation preserves effective inputs and ${resetPolicy ? "resets" : "retains"} active policy`, async () => {
    const delegatedInputs: unknown[] = [];
    const hostTools = createToolsFromHostDefinitions(markTrustedHostToolSet(
      {
        load_skill: createRuntimeLoadSkillTool({
          context: { projectId: "synthetic", authToken: "synthetic", branchId: "synthetic" },
          skillsDir: "/skills",
          projectSkillLoader: {
            listProjectSkillReferences: () => Promise.resolve([]),
            loadProjectSkill: ({ skillId }) =>
              Promise.resolve({
                instructions: skillId === "plain"
                  ? "Use the plain policy."
                  : "---\nname: review\ndescription: Synthetic delegation policy\nmodel: openai/gpt-5.4\nthinking: false\nmax-steps: 20\n---\nUse the synthetic delegation policy.",
              }),
            loadProjectSkillReference: () => Promise.resolve(null),
          },
          builtinStore: {
            readSkill: () => Promise.resolve(null),
            readReferenceFile: () => Promise.resolve(null),
            listReferences: () => Promise.resolve([]),
          },
        }),
      } satisfies HostToolSet,
    ));
    const model = scriptedModel([
      { toolCalls: [{ id: "load-1", name: "load_skill", input: { load: { skillId: "review" } } }] },
      { toolCalls: [{ id: "invoke-1", name: "invoke_agent", input: { prompt: "synthetic" } }] },
      ...(resetPolicy
        ? [{
          toolCalls: [{ id: "load-2", name: "load_skill", input: { load: { skillId: "plain" } } }],
        }]
        : []),
      { text: "Complete" },
    ], { only: "stream" });
    let saved: unknown;
    const runtime = new AgentRuntime("snapshot-skill-delegation", {
      model: "veryfront-cloud/openai/gpt-5.4",
      system: "Synthetic delegation proof",
      skills: false,
      maxSteps: 4,
      tools: {
        ...hostTools,
        invoke_agent: tool({
          id: "invoke_agent",
          description: "Synthetic delegation sink",
          inputSchema: defineSchema((v) =>
            v.object({
              prompt: v.string(),
              model: v.string().optional(),
              thinking: v.number().optional(),
              max_steps: v.number().optional(),
            })
          )(),
          execute: (input) => {
            delegatedInputs.push(input);
            return { ok: true };
          },
        }),
      },
    }, {
      resolveModelRuntime: () => model,
      manualPause: {
        load: () => Promise.resolve(null),
        acknowledge: (checkpoint) => {
          if (checkpoint.nextStep !== (resetPolicy ? 3 : 2)) return Promise.resolve(false);
          saved = structuredClone(checkpoint);
          return Promise.resolve(true);
        },
      },
    });
    await new Response(
      await runtime.stream([{
        id: "request",
        role: "user",
        parts: [{ type: "text", text: "Synthetic delegation request" }],
      }]),
    ).text();
    const continuation = parseAgentPauseCheckpoint(saved);
    const value = fixture();
    const assistants = continuation.messages.filter((message) => message.role === "assistant");
    const boundaries = assistants.flatMap((message, turnIndex) =>
      message.parts.flatMap((part) => {
        if (!("args" in part) || !("toolCallId" in part) || !("toolName" in part)) return [];
        const result = continuation.messages.flatMap((entry) => entry.parts).find((entry) =>
          entry.type === "tool-result" && "toolCallId" in entry &&
          entry.toolCallId === part.toolCallId
        );
        if (!result) throw new Error("Native writer omitted delegation result");
        const base = value.toolBoundaries[0]!;
        return [{
          ...base,
          modelMessageId: message.id,
          toolName: part.toolName,
          input: part.args,
          admissionReceipt: {
            ...base.admissionReceipt,
            occurrenceId: `55555555-5555-4555-8555-55555555555${turnIndex}`,
            toolCallId: part.toolCallId,
            publicToolCallId: `public-${part.toolCallId}`,
            admissionEventId: `admit-${part.toolCallId}`,
            startEventId: `start-${part.toolCallId}`,
          },
          result: getToolResultPartSchema().parse(result),
          resultEventId: `result-${part.toolCallId}`,
          acknowledgedExternalSequence: (turnIndex + 1) * 2,
        }];
      })
    );
    const snapshot = {
      ...value,
      messages: continuation.messages,
      runtimeContinuation: continuation,
      modelTurns: assistants.map((message, index) => ({
        messageId: message.id,
        acknowledgedExternalSequence: index * 2 + 1,
      })),
      acknowledgedExternalSequence: assistants.length * 2,
      toolExposureCheckpoint: continuation.toolExposureCheckpoint ?? value.toolExposureCheckpoint,
      toolBoundaries: boundaries,
    };
    assertEquals(delegatedInputs, [{
      prompt: "synthetic",
      model: "openai/gpt-5.4",
      thinking: 0,
      max_steps: 20,
    }]);
    assertEquals(boundaries[1]?.input, { prompt: "synthetic" });
    const parsed = parseRecoverySnapshot(snapshot);
    assertEquals(parsed.runtimeContinuation?.toolCalls[1]?.args, delegatedInputs[0]);
    for (
      const activeSkillDelegationOverrides of [undefined, {}, { model: "foreign" }, {
        ...continuation.activeSkillDelegationOverrides,
        maxSteps: 21,
      }]
    ) {
      assertThrows(() =>
        parseRecoverySnapshot({
          ...snapshot,
          runtimeContinuation: { ...continuation, activeSkillDelegationOverrides },
        })
      );
    }
    const originalEntry = continuation.toolCalls[1]!;
    for (
      const change of [{ prompt: "foreign" }, { model: "foreign" }, { thinking: 42 }, {
        max_steps: 21,
      }]
    ) {
      assertThrows(() =>
        parseRecoverySnapshot({
          ...snapshot,
          runtimeContinuation: {
            ...continuation,
            toolCalls: [continuation.toolCalls[0], {
              ...originalEntry,
              args: { ...originalEntry.args, ...change },
            }],
          },
        })
      );
    }
  });
}
