import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  introduceToolCallOccurrence,
  runWithToolCallOccurrenceDispatch,
  runWithToolCallOccurrences,
} from "#veryfront/runtime/tool-call-occurrence.ts";
import { createProjectEventWriter } from "#veryfront/internal-agents/project-event-writer.ts";
import { bindProjectEventWriter } from "#veryfront/internal-agents/project-event-writer.ts";
import { createRuntimeAgentStreamResponse } from "#veryfront/internal-agents/run-stream.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import type { Agent } from "#veryfront/agent";

const id = "11111111-1111-4111-8111-111111111111";
function writer(bind = true) {
  const result = createProjectEventWriter({
    apiUrl: "https://api.example.test",
    runId: id,
    canonicalRunId: id,
    projectId: id,
    threadId: id,
    token: "test-writer",
    latestEventId: 0,
    latestExternalEventSequence: 0,
  });
  const controller = new AbortController();
  if (bind) result.bindSignal(controller.signal);
  return { result, controller };
}
const delta = (text: string) => ({
  event: "TextMessageContent",
  payload: {
    type: "TEXT_MESSAGE_CONTENT",
    messageId: "message",
    delta: text,
  },
});

it("buffers ordinary deltas and drains them together at a terminal barrier", async () => {
  const batches: unknown[][] = [];
  await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    batches.push(body.events);
    return Response.json({
      run_id: id,
      latest_event_id: body.events.length,
      latest_external_event_sequence: body.events.length,
      appended_count: body.events.length,
    });
  }, async () => {
    const { result } = writer();
    try {
      await result.appendMappedEvent(delta("one"));
      await result.appendMappedEvent(delta("two"));
      assertEquals(batches.length, 0);
      await result.appendMappedEvent({ event: "RunFinished", payload: { type: "RUN_FINISHED" } });
      assertEquals(batches.map((batch) => batch.length), [2]);
    } finally {
      result.close();
    }
  });
});

for (const producerOutcome of ["fulfilled", "rejected", "missing"] as const) {
  it(
    `flushes buffered events before a failed runtime closes after producer ${producerOutcome}`,
    async () => {
      const batches: unknown[][] = [];
      await withMockFetch(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        batches.push(body.events);
        return Response.json({
          run_id: id,
          latest_event_id: body.events.length,
          latest_external_event_sequence: body.events.length,
          appended_count: body.events.length,
        });
      }, async () => {
        const input = {
          agentId: "writer-agent",
          threadId: id,
          runId: id,
          messages: [],
          tools: [],
          context: [],
        } as Parameters<typeof createRuntimeAgentStreamResponse>[0];
        const { result } = writer(false);
        bindProjectEventWriter(input, result);
        const response = await createRuntimeAgentStreamResponse(
          input,
          {
            id: "writer-agent",
            config: { id: "writer-agent", model: "anthropic/claude-opus-4-6", system: "test" },
          } as unknown as Agent,
          {
            sessionManager: new AgentRunSessionManager(),
            createRuntime: () => ({
              stream: async (_messages, _context, callbacks) => {
                if (producerOutcome !== "missing") {
                  callbacks?.onStreamCompletion?.(
                    producerOutcome === "rejected"
                      ? Promise.reject(new Error("producer cleanup failed"))
                      : Promise.resolve(),
                  );
                }
                let emitted = false;
                return new ReadableStream<Uint8Array>({
                  pull(controller) {
                    if (emitted) {
                      if (producerOutcome === "missing") {
                        controller.enqueue(
                          new TextEncoder().encode(
                            'data: {"type":"tool-input-start","toolCallId":"tool-1","toolName":"bash"}\n\n',
                          ),
                        );
                      } else {
                        controller.error(new Error("provider failed"));
                      }
                    } else {
                      emitted = true;
                      controller.enqueue(
                        new TextEncoder().encode(
                          'data: {"type":"text-delta","id":"text","delta":"before failure"}\n\n',
                        ),
                      );
                    }
                  },
                });
              },
            }),
          },
        );
        await response.text();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assertEquals(batches.length, 1);
        assertEquals(
          JSON.stringify(batches[0]).includes("before failure"),
          true,
        );
      });
    },
  );
}

it("retries a recoverable append while draining a terminal barrier", async () => {
  let attempts = 0;
  await withMockFetch(async (_url, init) => {
    attempts++;
    if (attempts === 1) return new Response("temporary", { status: 503 });
    const body = JSON.parse(String(init?.body));
    return Response.json({
      run_id: id,
      latest_event_id: body.events.length,
      latest_external_event_sequence: body.events.length,
      appended_count: body.events.length,
    });
  }, async () => {
    const { result } = writer();
    try {
      await result.appendMappedEvent(delta("one"));
      await result.appendMappedEvent({ event: "RunFinished", payload: { type: "RUN_FINISHED" } });
      assertEquals(attempts, 2);
    } finally {
      result.close();
    }
  });
});

it("revokes the writer when project code replaces abort prototype methods", async () => {
  const originalThrow = AbortSignal.prototype.throwIfAborted;
  const originalListen = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "addEventListener");
  const originalReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")!;
  const { result, controller } = writer(false);
  try {
    AbortSignal.prototype.throwIfAborted = () => {};
    AbortSignal.prototype.addEventListener = () => {};
    Object.defineProperty(AbortSignal.prototype, "reason", {
      configurable: true,
      get() {
        throw new Error("poisoned reason");
      },
    });
    result.bindSignal(controller.signal);
    controller.abort(new Error("cancelled"));
    await assertRejects(() =>
      result.appendMappedEvent({ event: "RunFinished", payload: { type: "RUN_FINISHED" } })
    );
  } finally {
    AbortSignal.prototype.throwIfAborted = originalThrow;
    if (originalListen) {
      Object.defineProperty(AbortSignal.prototype, "addEventListener", originalListen);
    } else Reflect.deleteProperty(AbortSignal.prototype, "addEventListener");
    Object.defineProperty(AbortSignal.prototype, "reason", originalReason);
    result.close();
  }
});

it("cancellation revokes an already resolved tool admission even with poisoned abort checks", async () => {
  await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const start = body.tool_call_starts[0];
    return Response.json({
      run: {
        run_id: id,
        conversation_id: id,
        latest_event_id: 2,
        latest_external_event_sequence: 1,
      },
      latestEventId: 2,
      latestExternalEventSequence: 1,
      appendedCount: 1,
      latest_event_id: 2,
      latest_external_event_sequence: 1,
      appended_count: 1,
      tool_call_admissions: [{
        occurrence_id: start.occurrence_id,
        admission_event_id: "2",
        start_event_id: "1",
        tool_call_id: "call-one",
        public_tool_call_id: "call-one",
        run_id: id,
        project_id: id,
      }],
    });
  }, async () => {
    const { result, controller } = writer();
    const original = AbortSignal.prototype.throwIfAborted;
    let effects = 0;
    try {
      await runWithToolCallOccurrences(async () => {
        const call = { id: "call-one" };
        const occurrence = introduceToolCallOccurrence(call)!;
        await result.appendMappedEvent({
          event: "ToolCallStart",
          payload: {
            toolCallId: call.id,
            toolCallName: "example",
          },
        }, occurrence);
        AbortSignal.prototype.throwIfAborted = () => {};
        controller.abort(new Error("cancelled"));
        await assertRejects(() =>
          runWithToolCallOccurrenceDispatch(
            call,
            () =>
              result.executeTool({} as never, async () => {
                effects++;
              }),
          )
        );
      });
      assertEquals(effects, 0);
    } finally {
      AbortSignal.prototype.throwIfAborted = original;
      result.close();
    }
  });
});
