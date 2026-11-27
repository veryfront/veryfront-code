import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createProjectToolApprovalReceiver,
  handleProjectToolApproval,
  PROJECT_TOOL_APPROVAL_DECISION,
  PROJECT_TOOL_APPROVAL_REQUEST,
} from "./project-tool-approval.ts";
import type { ToolExecutionDataEvent } from "#veryfront/tool/types.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import type { ToolApprovalDecision } from "#veryfront/tool/approval.ts";

const binding = {
  allocationId: "approval-allocation",
  invocationId: "approval-invocation",
  generation: 1,
};
const operationContext = () => ({
  binding,
  signal: new AbortController().signal,
  deadline: Date.now() + 30_000,
});
const request = {
  toolName: "project-transfer",
  toolCallId: "call-1",
  input: { amount: 12 },
  policy: {},
};
const approved: ToolApprovalDecision = {
  approved: true,
  outcome: "approved",
  approvalId: "approval-1",
};
function fixture() {
  const lifetime = new AbortController();
  const receiver = createProjectToolApprovalReceiver({
    binding,
    signal: lifetime.signal,
    assertActive() {},
  });
  const operation = receiver.operation;
  if (operation.mode !== "unary") throw new Error("Expected unary decision receiver");
  return {
    receiver,
    lifetime,
    reply: (value: unknown, context = operationContext()) =>
      operation.handle(value as JsonValue, context),
    read: (value: unknown, context = operationContext()) => {
      if (receiver.requestOperation.mode !== "unary") {
        throw new Error("Expected unary request reader");
      }
      return receiver.requestOperation.handle(value as JsonValue, context);
    },
  };
}
function eventValue(event: ToolExecutionDataEvent): Record<string, unknown> {
  return event as unknown as Record<string, unknown>;
}

it("project approval handles a decision arriving before its request stream acknowledgement", async () => {
  const f = fixture();
  let asked = 0;
  const call = f.receiver.forCall("project-transfer", {
    toolCallId: "call-1",
    publishDataEvent: async (event) => {
      assertEquals(
        await handleProjectToolApproval(event, {
          toolName: "project-transfer",
          toolCallId: "call-1",
          channel: {
            request: async (operation, value) => {
              if (operation === PROJECT_TOOL_APPROVAL_REQUEST) return await f.read(value);
              assertEquals(operation, PROJECT_TOOL_APPROVAL_DECISION);
              return await f.reply(value);
            },
          },
          gate: async (input) => {
            asked++;
            assertEquals(input, request);
            return { ...approved, checker: { type: "human", id: "private-checker" } };
          },
        }),
        true,
      );
    },
  });
  try {
    const decision = await call.gate(request);
    assertEquals(asked, 1);
    assertEquals(decision, approved);
    assertEquals("checker" in decision, false);
  } finally {
    call.close();
  }
});

it("project approval rejects wrong invocation/generation and stale replies without resolving its pending call", async () => {
  const f = fixture();
  const emitted = Promise.withResolvers<ToolExecutionDataEvent>();
  const call = f.receiver.forCall("project-transfer", {
    toolCallId: "call-1",
    publishDataEvent: (event) => {
      emitted.resolve(event);
    },
  });
  const waiting = call.gate(request);
  const event = eventValue(await emitted.promise);
  const reply = { approvalRequestId: event.approvalRequestId, decision: approved };
  try {
    for (const changed of [{ ...binding, generation: 2 }, { ...binding, invocationId: "other" }]) {
      assertThrows(() => f.reply(reply, { ...operationContext(), binding: changed }), TypeError);
    }
    assertThrows(() => f.reply({ ...reply, approvalRequestId: crypto.randomUUID() }), TypeError);
    await f.reply(reply);
    assertEquals(await waiting, approved);
    assertThrows(() => f.reply(reply), TypeError);
  } finally {
    call.close();
  }
});

it("project approval cancels a pending call when the source lifetime ends, even if the per-call signal stays live", async () => {
  const f = fixture();
  const emitted = Promise.withResolvers<ToolExecutionDataEvent>();
  const callSignal = new AbortController();
  const call = f.receiver.forCall("project-transfer", {
    toolCallId: "call-1",
    abortSignal: callSignal.signal,
    publishDataEvent: (event) => {
      emitted.resolve(event);
    },
  });
  const waiting = call.gate(request);
  const event = eventValue(await emitted.promise);
  f.lifetime.abort();
  await assertRejects(() => waiting);
  assertEquals(callSignal.signal.aborted, false);
  assertThrows(() => f.reply({ approvalRequestId: event.approvalRequestId, decision: approved }));
  call.close();
});

it("project approval refuses duplicate asks and conflicting decisions within one active tool call", async () => {
  const f = fixture();
  const emitted = Promise.withResolvers<ToolExecutionDataEvent>();
  const release = Promise.withResolvers<void>();
  const call = f.receiver.forCall("project-transfer", {
    toolCallId: "call-1",
    publishDataEvent: (event) => {
      emitted.resolve(event);
      return release.promise;
    },
  });
  const waiting = call.gate(request);
  const event = eventValue(await emitted.promise);
  try {
    await assertRejects(() => call.gate(request), TypeError);
    const value = { approvalRequestId: event.approvalRequestId, decision: approved };
    await f.reply(value);
    await f.reply(value);
    assertThrows(
      () => f.reply({ ...value, decision: { approved: false, outcome: "denied" } }),
      TypeError,
    );
    release.resolve();
    assertEquals(await waiting, approved);
  } finally {
    release.resolve();
    call.close();
  }
});

it("project approval sender refuses forged correlation, missing host channel and malformed decisions", async () => {
  const event = {
    type: "veryfront.tool-approval.request.v1",
    approvalRequestId: crypto.randomUUID(),
    toolName: "project-transfer",
    toolCallId: "call-1",
  } as unknown as ToolExecutionDataEvent;
  let asks = 0, replies = 0;
  const input = {
    toolName: "project-transfer",
    toolCallId: "call-1",
    channel: {
      request: (operation: string) => {
        if (operation === PROJECT_TOOL_APPROVAL_REQUEST) {
          return Promise.resolve({
            type: "veryfront.tool-approval.request.v1",
            approvalRequestId: String(eventValue(event).approvalRequestId),
            toolName: "project-transfer",
            toolCallId: "call-1",
            input: {},
            policy: {},
          });
        }
        replies++;
        return Promise.resolve({ ok: true });
      },
    },
    gate: () => {
      asks++;
      return Promise.resolve(approved);
    },
  };
  await assertRejects(() => handleProjectToolApproval(event, { ...input, toolName: "other" }));
  await assertRejects(() => handleProjectToolApproval(event, { ...input, toolCallId: "other" }));
  await assertRejects(() => handleProjectToolApproval(event, { ...input, gate: undefined }));
  assertEquals(asks, 0);
  assertEquals(replies, 0);
  await assertRejects(() =>
    handleProjectToolApproval(event, {
      ...input,
      gate: () => Promise.resolve({ approved: true, outcome: "denied" } as ToolApprovalDecision),
    })
  );
  assertEquals(replies, 0);
  assertEquals(
    await handleProjectToolApproval({ type: "ordinary" } as ToolExecutionDataEvent, input),
    false,
  );
});

it("project approval keeps large admitted arguments out of progress while delivering them intact to the host", async () => {
  const f = fixture();
  const document = "x".repeat(80 * 1024);
  const largeRequest = { ...request, input: { document } };
  const call = f.receiver.forCall("project-transfer", {
    toolCallId: "call-1",
    publishDataEvent: async (event) => {
      assertEquals(JSON.stringify(event).length < 1024, true);
      assertEquals("input" in event, false);
      await handleProjectToolApproval(event, {
        toolName: "project-transfer",
        toolCallId: "call-1",
        channel: {
          request: async (operation, value) =>
            await (operation === PROJECT_TOOL_APPROVAL_REQUEST ? f.read(value) : f.reply(value)),
        },
        gate: (input) => {
          assertEquals(input.input, { document });
          return Promise.resolve(approved);
        },
      });
    },
  });
  try {
    assertEquals(await call.gate(largeRequest), approved);
  } finally {
    call.close();
  }
});
