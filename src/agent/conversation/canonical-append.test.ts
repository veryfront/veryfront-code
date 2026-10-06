import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  appendConversationRunEvents,
  createConversationRunEventQueueController,
  flushConversationRunEventQueue,
} from "./durable.ts";

const canonicalRunId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const modelCallId = "44444444-4444-4444-8444-444444444444";
const otherModelCallId = "55555555-5555-4555-8555-555555555555";
const exactReceiptEventId = "9007199254740993";

function modelCallCaptureEvent(id = modelCallId) {
  return {
    type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED",
    modelCallId: id,
    messages: [],
  };
}

function wireReceipt(id = modelCallId, runId = canonicalRunId, eventId = exactReceiptEventId) {
  return {
    event_id: eventId,
    model_call_id: id,
    run_id: runId,
    project_id: projectId,
  };
}

function casedWireReceipt(options: {
  modelCallId?: string;
  runId?: string;
  projectId?: string;
  eventId?: string;
}) {
  return {
    event_id: options.eventId ?? exactReceiptEventId,
    model_call_id: options.modelCallId ?? modelCallId,
    run_id: options.runId ?? canonicalRunId,
    project_id: options.projectId ?? projectId,
  };
}

function appendResponse(options: {
  appendedCount?: number;
  latestEventId?: number;
  modelCallCaptures?: unknown;
} = {}) {
  return {
    run_id: canonicalRunId,
    latest_event_id: options.latestEventId ?? 7,
    latest_external_event_sequence: 5,
    appended_count: options.appendedCount ?? 1,
    ...(Object.hasOwn(options, "modelCallCaptures")
      ? { model_call_captures: options.modelCallCaptures }
      : {}),
  };
}

it("adapts canonical append receipts while retaining original runtime payload identifiers", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  let request: Request | undefined;
  const event = { type: "STATE_SNAPSHOT", snapshot: { runId: "original-runtime-id" } };
  const receipt = await appendConversationRunEvents({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "original-runtime-id",
    canonicalRunId: id,
    conversationId: id,
    events: [event],
    fetch: (_input, init) => {
      request = new Request(_input, init);
      return Promise.resolve(
        Response.json({
          run_id: id,
          latest_event_id: 7,
          latest_external_event_sequence: 5,
          appended_count: 1,
        }),
      );
    },
  });
  assertEquals(request!.url, `https://api.example.test/runs/${id}/events`);
  assertEquals((await request!.json()).events, [event]);
  assertEquals(receipt.latestEventId, 7);
  assertEquals(receipt.latestExternalEventSequence, 5);
  assertEquals(receipt.run.runId, "original-runtime-id");
});

it("recovers authenticated cursor mismatch by append hints without any event read", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const methods: string[] = [];
  const result = await flushConversationRunEventQueue({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "original",
    canonicalRunId: id,
    conversationId: id,
    latestEventId: 1,
    latestExternalEventSequence: 1,
    maxEventsPerBatch: 100,
    maxCursorResyncsPerFlush: 2,
    events: [{ type: "STATE_SNAPSHOT", snapshot: {} }],
    fetch: (_input, init) => {
      methods.push(init?.method ?? "GET");
      if (methods.length === 1) {
        return Promise.resolve(
          Response.json({ detail: "External run event cursor mismatch" }, {
            status: 400,
            headers: { "X-Run-Latest-Event-Id": "5", "X-Run-Latest-External-Sequence": "3" },
          }),
        );
      }
      return Promise.resolve(
        Response.json({
          run_id: id,
          latest_event_id: 6,
          latest_external_event_sequence: 4,
          appended_count: 1,
        }),
      );
    },
  });
  assertEquals(methods, ["POST", "POST"]);
  assertEquals(result, { outcome: "flushed", latestEventId: 6, latestExternalEventSequence: 4 });
});

const ambiguousCursorHeaders: Record<string, string>[] = [{}, {
  "X-Run-Latest-Event-Id": "0",
  "X-Run-Latest-External-Sequence": "0",
}, {
  "X-Run-Latest-Event-Id": "5",
  "X-Run-Latest-External-Sequence": "invalid",
}];
for (const headers of ambiguousCursorHeaders) {
  it(`stops ambiguous append recovery without reading events: ${JSON.stringify(headers)}`, async () => {
    let calls = 0;
    const result = await flushConversationRunEventQueue({
      authToken: "writer",
      apiUrl: "https://api.example.test",
      runId: "original",
      canonicalRunId: "11111111-1111-4111-8111-111111111111",
      conversationId: "11111111-1111-4111-8111-111111111111",
      latestEventId: 1,
      latestExternalEventSequence: 1,
      maxEventsPerBatch: 100,
      maxCursorResyncsPerFlush: 2,
      events: [{ type: "STATE_SNAPSHOT", snapshot: {} }],
      fetch: () => {
        calls++;
        return Promise.resolve(
          Response.json({ detail: "External run event cursor mismatch" }, { status: 400, headers }),
        );
      },
    });
    assertEquals(calls, 1);
    assertEquals(result.outcome, "stopped");
  });
}

it("maps exact model call capture acknowledgements without numeric cursor coercion", async () => {
  const response = await appendConversationRunEvents({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    expectedPreviousEventId: 1,
    expectedPreviousExternalEventSequence: 4,
    events: [modelCallCaptureEvent()],
    fetch: () =>
      Promise.resolve(
        Response.json(appendResponse({ modelCallCaptures: [wireReceipt()], latestEventId: 12 })),
      ),
  });

  assertEquals(response.latestEventId, 12);
  assertEquals(response.modelCallCaptures, [{
    eventId: exactReceiptEventId,
    modelCallId,
    runId: canonicalRunId,
    projectId,
  }]);
});

it("accepts canonical append response run id casing variants with exact capture receipts", async () => {
  const response = await appendConversationRunEvents({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    expectedPreviousEventId: 1,
    expectedPreviousExternalEventSequence: 4,
    events: [modelCallCaptureEvent()],
    fetch: () =>
      Promise.resolve(
        Response.json({
          ...appendResponse({ modelCallCaptures: [wireReceipt()] }),
          run_id: canonicalRunId.toUpperCase(),
        }),
      ),
  });

  assertEquals(response.modelCallCaptures?.[0]?.eventId, exactReceiptEventId);
});

it("requires exact capture acknowledgements even when replay appends no new events", async () => {
  const response = await appendConversationRunEvents({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    expectedPreviousEventId: 1,
    expectedPreviousExternalEventSequence: 4,
    events: [modelCallCaptureEvent()],
    fetch: () =>
      Promise.resolve(
        Response.json(appendResponse({ appendedCount: 0, modelCallCaptures: [wireReceipt()] })),
      ),
  });

  assertEquals(response.appendedCount, 0);
  assertEquals(response.modelCallCaptures?.[0]?.eventId, exactReceiptEventId);
});

it("stores queue capture acknowledgements by model call id instead of latest cursor", async () => {
  const queue = createConversationRunEventQueueController({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    latestEventId: 1,
    latestExternalEventSequence: 4,
    maxEventsPerBatch: 100,
    fetch: () =>
      Promise.resolve(
        Response.json(appendResponse({ modelCallCaptures: [wireReceipt()], latestEventId: 42 })),
      ),
  });

  queue.enqueue([modelCallCaptureEvent(), { type: "STATE_SNAPSHOT", snapshot: {} }]);
  assertEquals(await queue.flush(), {
    outcome: "flushed",
    latestEventId: 42,
    latestExternalEventSequence: 5,
    pendingEventCount: 0,
    consecutiveFailures: 0,
    disabled: false,
  });
  assertEquals(queue.takeModelCallCaptureReceipt?.(modelCallId), {
    eventId: exactReceiptEventId,
    modelCallId,
    runId: canonicalRunId,
    projectId,
  });
  assertEquals(queue.takeModelCallCaptureReceipt?.(modelCallId), undefined);
});

it("uses normalized UUID keys for queued capture receipt storage and consumption", async () => {
  const uppercaseModelCallId = modelCallId.toUpperCase();
  const queue = createConversationRunEventQueueController({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    latestEventId: 1,
    latestExternalEventSequence: 4,
    maxEventsPerBatch: 100,
    fetch: () =>
      Promise.resolve(
        Response.json(
          appendResponse({ modelCallCaptures: [wireReceipt(uppercaseModelCallId)] }),
        ),
      ),
  });

  queue.enqueue([modelCallCaptureEvent(modelCallId)]);
  await queue.flush();
  assertEquals(queue.takeModelCallCaptureReceipt?.(modelCallId), {
    eventId: exactReceiptEventId,
    modelCallId: uppercaseModelCallId,
    runId: canonicalRunId,
    projectId,
  });
});

it("detects conflicting replay receipts for the same model call UUID with different casing", async () => {
  const uppercaseModelCallId = modelCallId.toUpperCase();
  let calls = 0;
  const queue = createConversationRunEventQueueController({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    latestEventId: 1,
    latestExternalEventSequence: 4,
    maxEventsPerBatch: 100,
    fetch: () => {
      calls += 1;
      return Promise.resolve(
        Response.json(
          appendResponse({
            latestEventId: calls + 1,
            modelCallCaptures: [
              calls === 1
                ? wireReceipt(uppercaseModelCallId, canonicalRunId, exactReceiptEventId)
                : wireReceipt(modelCallId, canonicalRunId, "9007199254740995"),
            ],
          }),
        ),
      );
    },
  });

  queue.enqueue([modelCallCaptureEvent(modelCallId)]);
  await queue.flush();
  queue.enqueue([modelCallCaptureEvent(modelCallId)]);
  const conflict = await queue.flush();
  assertEquals(conflict.outcome, "retry_scheduled");
  assertEquals(conflict.pendingEventCount, 1);
  assertEquals(
    "errorMessage" in conflict &&
      conflict.errorMessage.includes("Conflicting model call capture acknowledgement"),
    true,
  );
  assertEquals(queue.takeModelCallCaptureReceipt?.(modelCallId), {
    eventId: exactReceiptEventId,
    modelCallId: uppercaseModelCallId,
    runId: canonicalRunId,
    projectId,
  });
});

it("accepts idempotent replay receipts when only UUID casing changes", async () => {
  const uppercaseModelCallId = modelCallId.toUpperCase();
  const uppercaseRunId = canonicalRunId.toUpperCase();
  const uppercaseProjectId = projectId.toUpperCase();
  let calls = 0;
  const queue = createConversationRunEventQueueController({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    latestEventId: 1,
    latestExternalEventSequence: 4,
    maxEventsPerBatch: 100,
    fetch: () => {
      calls += 1;
      return Promise.resolve(
        Response.json(
          appendResponse({
            latestEventId: calls + 1,
            modelCallCaptures: [
              calls === 1
                ? casedWireReceipt({
                  modelCallId: uppercaseModelCallId,
                  runId: uppercaseRunId,
                  projectId: uppercaseProjectId,
                })
                : casedWireReceipt({ modelCallId, runId: canonicalRunId, projectId }),
            ],
          }),
        ),
      );
    },
  });

  queue.enqueue([modelCallCaptureEvent(modelCallId)]);
  await queue.flush();
  queue.enqueue([modelCallCaptureEvent(modelCallId)]);
  await queue.flush();
  assertEquals(queue.takeModelCallCaptureReceipt?.(modelCallId), {
    eventId: exactReceiptEventId,
    modelCallId: uppercaseModelCallId,
    runId: uppercaseRunId,
    projectId: uppercaseProjectId,
  });
});

it("rejects missing, forged, duplicate, wrong-run, and malformed capture acknowledgements", async () => {
  const badBodies = [
    appendResponse(),
    appendResponse({ modelCallCaptures: [wireReceipt(otherModelCallId)] }),
    appendResponse({ modelCallCaptures: [wireReceipt(), wireReceipt()] }),
    appendResponse({
      modelCallCaptures: [wireReceipt(modelCallId, "66666666-6666-4666-8666-666666666666")],
    }),
    appendResponse({ modelCallCaptures: [{ ...wireReceipt(), event_id: "" }] }),
    appendResponse({ modelCallCaptures: "malformed" }),
  ];

  for (const body of badBodies) {
    await assertRejects(() =>
      appendConversationRunEvents({
        authToken: "writer",
        apiUrl: "https://api.example.test",
        runId: "runtime-run-id",
        canonicalRunId,
        conversationId,
        expectedPreviousEventId: 1,
        expectedPreviousExternalEventSequence: 4,
        events: [modelCallCaptureEvent()],
        fetch: () => Promise.resolve(Response.json(body)),
      })
    );
  }
});

it("rejects duplicate opaque capture event identifiers across distinct submitted calls", async () => {
  await assertRejects(() =>
    appendConversationRunEvents({
      authToken: "writer",
      apiUrl: "https://api.example.test",
      runId: "runtime-run-id",
      canonicalRunId,
      conversationId,
      expectedPreviousEventId: 1,
      expectedPreviousExternalEventSequence: 4,
      events: [modelCallCaptureEvent(modelCallId), modelCallCaptureEvent(otherModelCallId)],
      fetch: () =>
        Promise.resolve(
          Response.json(
            appendResponse({
              modelCallCaptures: [wireReceipt(modelCallId), wireReceipt(otherModelCallId)],
            }),
          ),
        ),
    })
  );
});

it("rejects capture receipts for legacy appends without submitted captures", async () => {
  await assertRejects(() =>
    appendConversationRunEvents({
      authToken: "writer",
      apiUrl: "https://api.example.test",
      runId: "runtime-run-id",
      canonicalRunId,
      conversationId,
      events: [{ type: "STATE_SNAPSHOT", snapshot: {} }],
      fetch: () =>
        Promise.resolve(Response.json(appendResponse({ modelCallCaptures: [wireReceipt()] }))),
    })
  );
});
