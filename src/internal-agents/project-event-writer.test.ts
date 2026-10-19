import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  introduceToolCallOccurrence,
  runWithToolCallOccurrenceDispatch,
  runWithToolCallOccurrences,
} from "#veryfront/runtime/tool-call-occurrence.ts";
import { createProjectEventWriter } from "./project-event-writer.ts";

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
