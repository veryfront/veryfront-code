import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  appendConversationRunEvents,
  createConversationRunEventQueueController,
  flushConversationRunEventBatches,
  flushConversationRunEventQueue,
} from "./durable.ts";
import { prepareConversationRunExternalEvents } from "./run-event-preparation.ts";

const canonicalRunId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const modelCallId = "44444444-4444-4444-8444-444444444444";
const otherModelCallId = "55555555-5555-4555-8555-555555555555";
const exactReceiptEventId = "9007199254740993";
const toolOccurrenceId = "66666666-6666-4666-8666-666666666666";
const otherToolOccurrenceId = "77777777-7777-4777-8777-777777777777";
const runtimeOccurrenceId = "88888888-8888-4888-8888-888888888888";
const runtimeStepId = "99999999-9999-4999-8999-999999999999";
const runtimeMessageSpanId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const toolCallId = "toolu_exact_raw";
const admissionEventId = "9007199254740994";
const startEventId = "9007199254740995";

for (const density of ["dense", "sparse", "unobserved"] as const) {
  it(`bounds ${density} runtime observation batches while retaining exact indexes`, async () => {
    const events = Array.from({ length: 125 }, (_, index) => ({
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "message",
      delta: String(index),
    }));
    const observations = events.flatMap((_event, eventIndex) =>
      density === "unobserved" || (density === "sparse" && eventIndex !== 124) ? [] : [{
        observation: {
          version: 1 as const,
          kind: "step_message" as const,
          stepId: runtimeStepId,
          messageSpanId: runtimeMessageSpanId,
        },
        eventIndex,
      }]
    );
    const batches: number[] = [];
    const observedDeltas: string[] = [];
    let cursor = 0;
    const result = await flushConversationRunEventBatches({
      authToken: "writer",
      apiUrl: "https://api.example.test",
      runId: "runtime-run-id",
      canonicalRunId,
      conversationId,
      events,
      runtimeObservations: observations,
      latestEventId: 0,
      latestExternalEventSequence: 0,
      maxEventsPerBatch: 125,
      maxCursorResyncsPerFlush: 2,
      fetch: async (_input, init) => {
        const body = await new Request(_input, init).json();
        batches.push(body.events.length);
        for (const entry of body.runtime_observations?.observations ?? []) {
          assertEquals(entry.event_index < 100, true);
          observedDeltas.push(body.events[entry.event_index].delta);
        }
        cursor += body.events.length;
        return Response.json({
          run_id: canonicalRunId,
          latest_event_id: cursor,
          latest_external_event_sequence: cursor,
          appended_count: body.events.length,
        });
      },
    });
    assertEquals(result.outcome, "flushed");
    assertEquals(batches, density === "unobserved" ? [125] : [100, 25]);
    assertEquals(
      observedDeltas,
      density === "dense"
        ? events.map((event) => event.delta)
        : density === "sparse"
        ? ["124"]
        : [],
    );
  });
}

function modelCallCaptureEvent(id = modelCallId) {
  return {
    type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED",
    modelCallId: id,
    messages: [],
  };
}

function toolCallStartEvent(id = toolCallId) {
  return {
    type: "TOOL_CALL_START",
    toolCallId: id,
    toolName: "create_file",
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

function wireToolCallAdmission(options: {
  occurrenceId?: string;
  toolId?: string;
  publicToolId?: string;
  runId?: string;
  admissionId?: string;
  startId?: string;
} = {}) {
  return {
    occurrence_id: options.occurrenceId ?? toolOccurrenceId,
    admission_event_id: options.admissionId ?? admissionEventId,
    start_event_id: options.startId ?? startEventId,
    tool_call_id: options.toolId ?? toolCallId,
    public_tool_call_id: options.publicToolId ?? toolCallId,
    run_id: options.runId ?? canonicalRunId,
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
  toolCallAdmissions?: unknown;
} = {}) {
  return {
    run_id: canonicalRunId,
    latest_event_id: options.latestEventId ?? 7,
    latest_external_event_sequence: 5,
    appended_count: options.appendedCount ?? 1,
    ...(Object.hasOwn(options, "modelCallCaptures")
      ? { model_call_captures: options.modelCallCaptures }
      : {}),
    ...(Object.hasOwn(options, "toolCallAdmissions")
      ? { tool_call_admissions: options.toolCallAdmissions }
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

it("submits tool call admission sidecars and parses exact admission receipts", async () => {
  let request: Request | undefined;
  const response = await appendConversationRunEvents({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    events: [toolCallStartEvent()],
    toolCallStarts: [{ occurrenceId: toolOccurrenceId.toUpperCase(), eventIndex: 0 }],
    fetch: (_input, init) => {
      request = new Request(_input, init);
      return Promise.resolve(
        Response.json(appendResponse({ toolCallAdmissions: [wireToolCallAdmission()] })),
      );
    },
  });

  assertEquals((await request!.json()).tool_call_starts, [{
    occurrence_id: toolOccurrenceId,
    event_index: 0,
  }]);
  assertEquals(response.toolCallAdmissions, [{
    occurrenceId: toolOccurrenceId,
    admissionEventId,
    startEventId,
    toolCallId,
    publicToolCallId: toolCallId,
    runId: canonicalRunId,
    projectId,
  }]);
});

it("submits runtime observation sidecars with exact event indexes", async () => {
  let request: Request | undefined;
  await appendConversationRunEvents({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    events: [
      { type: "RUNTIME_EVENT_RECORDED", runtime: "veryfront", kind: "runtime_context" },
      { type: "STEP_STARTED", stepId: runtimeStepId },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "outer-message", delta: "hello" },
    ],
    runtimeObservations: [
      {
        observation: { version: 1, kind: "execution_entry", occurrenceId: runtimeOccurrenceId },
        eventIndex: 0,
      },
      {
        observation: { version: 1, kind: "step_started", stepId: runtimeStepId },
        eventIndex: 1,
      },
      {
        observation: {
          version: 1,
          kind: "step_message",
          stepId: runtimeStepId,
          messageSpanId: runtimeMessageSpanId,
        },
        eventIndex: 2,
      },
    ],
    fetch: (_input, init) => {
      request = new Request(_input, init);
      return Promise.resolve(Response.json(appendResponse({ appendedCount: 3 })));
    },
  });

  assertEquals((await request!.json()).runtime_observations, {
    version: 1,
    observations: [
      { kind: "execution_entry", occurrence_id: runtimeOccurrenceId, event_index: 0 },
      { kind: "step_started", step_id: runtimeStepId, event_index: 1 },
      {
        kind: "step_message",
        step_id: runtimeStepId,
        message_span_id: runtimeMessageSpanId,
        event_index: 2,
      },
    ],
  });
});

it("submits runtime observation sidecars for each normalized oversized fragment", async () => {
  let request: Request | undefined;
  const preparedEvents = prepareConversationRunExternalEvents([{
    type: "TEXT_MESSAGE_CONTENT",
    messageId: "outer-message",
    contentId: "text:0",
    delta: "x".repeat(250 * 1024),
  }]);
  assertEquals(preparedEvents.length > 1, true);
  await appendConversationRunEvents({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    events: preparedEvents,
    runtimeObservations: preparedEvents.map((_event, eventIndex) => ({
      observation: {
        version: 1,
        kind: "step_message",
        stepId: runtimeStepId,
        messageSpanId: runtimeMessageSpanId,
      },
      eventIndex,
    })),
    fetch: (_input, init) => {
      request = new Request(_input, init);
      return Promise.resolve(
        Response.json(appendResponse({ appendedCount: preparedEvents.length })),
      );
    },
  });

  const body = await request!.json();
  assertEquals(body.events.length, preparedEvents.length);
  assertEquals(body.runtime_observations, {
    version: 1,
    observations: preparedEvents.map((_event, eventIndex) => ({
      kind: "step_message",
      step_id: runtimeStepId,
      message_span_id: runtimeMessageSpanId,
      event_index: eventIndex,
    })),
  });
});

it("rejects runtime observation sidecar event indexes outside the wire contract", async () => {
  await assertRejects(() =>
    appendConversationRunEvents({
      authToken: "writer",
      apiUrl: "https://api.example.test",
      runId: "runtime-run-id",
      canonicalRunId,
      conversationId,
      events: [{ type: "TEXT_MESSAGE_CONTENT", messageId: "outer-message", delta: "hello" }],
      runtimeObservations: [{
        observation: {
          version: 1,
          kind: "step_message",
          stepId: runtimeStepId,
          messageSpanId: runtimeMessageSpanId,
        },
        eventIndex: 100,
      }],
      fetch: () => Promise.resolve(Response.json(appendResponse())),
    })
  );
});

it("accepts distinct canonical public tool call ids while preserving raw tool call matching", async () => {
  const response = await appendConversationRunEvents({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    events: [toolCallStartEvent()],
    toolCallStarts: [{ occurrenceId: toolOccurrenceId, eventIndex: 0 }],
    fetch: () =>
      Promise.resolve(
        Response.json(
          appendResponse({
            toolCallAdmissions: [wireToolCallAdmission({ publicToolId: "toolu_public_canonical" })],
          }),
        ),
      ),
  });

  assertEquals(response.toolCallAdmissions?.[0]?.toolCallId, toolCallId);
  assertEquals(response.toolCallAdmissions?.[0]?.publicToolCallId, "toolu_public_canonical");
});

it("rejects missing, unknown, duplicate, and wrong tool call admission receipts", async () => {
  const badBodies = [
    appendResponse(),
    appendResponse({
      toolCallAdmissions: [wireToolCallAdmission({ occurrenceId: otherToolOccurrenceId })],
    }),
    appendResponse({ toolCallAdmissions: [wireToolCallAdmission(), wireToolCallAdmission()] }),
    appendResponse({
      toolCallAdmissions: [
        wireToolCallAdmission({ runId: "88888888-8888-4888-8888-888888888888" }),
      ],
    }),
    appendResponse({ toolCallAdmissions: [wireToolCallAdmission({ toolId: "other-tool" })] }),
    appendResponse({
      toolCallAdmissions: [{ ...wireToolCallAdmission(), admission_event_id: "" }],
    }),
    appendResponse({
      toolCallAdmissions: [{ ...wireToolCallAdmission(), can_read_input: true }],
    }),
    appendResponse({ toolCallAdmissions: "malformed" }),
  ];

  for (const body of badBodies) {
    await assertRejects(() =>
      appendConversationRunEvents({
        authToken: "writer",
        apiUrl: "https://api.example.test",
        runId: "runtime-run-id",
        canonicalRunId,
        conversationId,
        events: [toolCallStartEvent()],
        toolCallStarts: [{ occurrenceId: toolOccurrenceId, eventIndex: 0 }],
        fetch: () => Promise.resolve(Response.json(body)),
      })
    );
  }
});

it("rejects tool call admission sidecars that do not select exact tool starts", async () => {
  for (
    const toolCallStarts of [
      [{ occurrenceId: toolOccurrenceId, eventIndex: 2 }],
      [{ occurrenceId: toolOccurrenceId, eventIndex: 0 }],
      [
        { occurrenceId: toolOccurrenceId, eventIndex: 1 },
        { occurrenceId: otherToolOccurrenceId, eventIndex: 1 },
      ],
    ]
  ) {
    await assertRejects(() =>
      appendConversationRunEvents({
        authToken: "writer",
        apiUrl: "https://api.example.test",
        runId: "runtime-run-id",
        canonicalRunId,
        conversationId,
        events: [{ type: "STATE_SNAPSHOT", snapshot: {} }, toolCallStartEvent()],
        toolCallStarts,
        fetch: () =>
          Promise.resolve(
            Response.json(appendResponse({ toolCallAdmissions: [wireToolCallAdmission()] })),
          ),
      })
    );
  }
});

it("rejects sidecar-bearing appends when normalization would move repeated tool starts", async () => {
  await assertRejects(() =>
    appendConversationRunEvents({
      authToken: "writer",
      apiUrl: "https://api.example.test",
      runId: "runtime-run-id",
      canonicalRunId,
      conversationId,
      events: [
        { type: "TEXT_MESSAGE_CONTENT", delta: "x".repeat(300 * 1024) },
        toolCallStartEvent(toolCallId),
        toolCallStartEvent(toolCallId),
      ],
      toolCallStarts: [{ occurrenceId: toolOccurrenceId, eventIndex: 2 }],
      fetch: () =>
        Promise.resolve(
          Response.json(appendResponse({ toolCallAdmissions: [wireToolCallAdmission()] })),
        ),
    })
  );
});

it("rejects tool call admission receipts for legacy appends without submitted sidecars", async () => {
  await assertRejects(() =>
    appendConversationRunEvents({
      authToken: "writer",
      apiUrl: "https://api.example.test",
      runId: "runtime-run-id",
      canonicalRunId,
      conversationId,
      events: [toolCallStartEvent()],
      fetch: () =>
        Promise.resolve(
          Response.json(appendResponse({ toolCallAdmissions: [wireToolCallAdmission()] })),
        ),
    })
  );
});

it("rejects duplicate tool call admission and start event identifiers", async () => {
  for (
    const toolCallAdmissions of [
      [
        wireToolCallAdmission({ occurrenceId: toolOccurrenceId, toolId: toolCallId }),
        wireToolCallAdmission({
          occurrenceId: otherToolOccurrenceId,
          toolId: "toolu_other_raw",
          publicToolId: "toolu_other_raw",
          startId: "9007199254740996",
        }),
      ],
      [
        wireToolCallAdmission({ occurrenceId: toolOccurrenceId, toolId: toolCallId }),
        wireToolCallAdmission({
          occurrenceId: otherToolOccurrenceId,
          toolId: "toolu_other_raw",
          publicToolId: "toolu_other_raw",
          admissionId: "9007199254740996",
        }),
      ],
      [
        wireToolCallAdmission({ occurrenceId: toolOccurrenceId, startId: admissionEventId }),
        wireToolCallAdmission({
          occurrenceId: otherToolOccurrenceId,
          toolId: "toolu_other_raw",
          publicToolId: "toolu_other_raw",
          admissionId: "9007199254740998",
          startId: "9007199254740999",
        }),
      ],
      [
        wireToolCallAdmission({
          occurrenceId: toolOccurrenceId,
          toolId: toolCallId,
          admissionId: "9007199254740998",
          startId: "9007199254740999",
        }),
        wireToolCallAdmission({
          occurrenceId: otherToolOccurrenceId,
          toolId: "toolu_other_raw",
          publicToolId: "toolu_other_raw",
          admissionId: "9007199254740999",
          startId: "9007199254741000",
        }),
      ],
    ]
  ) {
    await assertRejects(() =>
      appendConversationRunEvents({
        authToken: "writer",
        apiUrl: "https://api.example.test",
        runId: "runtime-run-id",
        canonicalRunId,
        conversationId,
        events: [toolCallStartEvent(toolCallId), toolCallStartEvent("toolu_other_raw")],
        toolCallStarts: [
          { occurrenceId: toolOccurrenceId, eventIndex: 0 },
          { occurrenceId: otherToolOccurrenceId, eventIndex: 1 },
        ],
        fetch: () => Promise.resolve(Response.json(appendResponse({ toolCallAdmissions }))),
      })
    );
  }
});

it("stores queue tool call admissions by occurrence id and preserves sidecar indexes", async () => {
  let body: Record<string, unknown> | undefined;
  const queue = createConversationRunEventQueueController({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    latestEventId: 1,
    latestExternalEventSequence: 4,
    maxEventsPerBatch: 100,
    fetch: (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(
        Response.json(appendResponse({ toolCallAdmissions: [wireToolCallAdmission()] })),
      );
    },
  });

  queue.enqueue([{ type: "STATE_SNAPSHOT", snapshot: {} }, toolCallStartEvent()], {
    toolCallStarts: [{ occurrenceId: toolOccurrenceId.toUpperCase(), eventIndex: 1 }],
  });
  await queue.flush();
  assertEquals(body?.tool_call_starts, [{ occurrence_id: toolOccurrenceId, event_index: 1 }]);
  assertEquals(queue.takeToolCallAdmissionReceipt?.(toolOccurrenceId.toUpperCase()), {
    occurrenceId: toolOccurrenceId,
    admissionEventId,
    startEventId,
    toolCallId,
    publicToolCallId: toolCallId,
    runId: canonicalRunId,
    projectId,
  });
  assertEquals(queue.takeToolCallAdmissionReceipt?.(toolOccurrenceId), undefined);
});

it("preserves queue runtime observation indexes across prior pending events", async () => {
  let body: Record<string, unknown> | undefined;
  const queue = createConversationRunEventQueueController({
    authToken: "writer",
    apiUrl: "https://api.example.test",
    runId: "runtime-run-id",
    canonicalRunId,
    conversationId,
    latestEventId: 1,
    latestExternalEventSequence: 4,
    maxEventsPerBatch: 100,
    fetch: (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(Response.json(appendResponse({ appendedCount: 2 })));
    },
  });

  queue.enqueue([{ type: "STATE_SNAPSHOT", snapshot: {} }]);
  queue.enqueue([{ type: "STEP_STARTED", stepId: runtimeStepId }], {
    runtimeObservations: [{
      observation: { version: 1, kind: "step_started", stepId: runtimeStepId },
      eventIndex: 0,
    }],
  });
  await queue.flush();
  assertEquals(body?.runtime_observations, {
    version: 1,
    observations: [{ kind: "step_started", step_id: runtimeStepId, event_index: 1 }],
  });
});

it("keeps tool call admission sidecars pending after retryable append failures", async () => {
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
        calls === 1
          ? Response.json(appendResponse(), { status: 500 })
          : Response.json(appendResponse({ toolCallAdmissions: [wireToolCallAdmission()] })),
      );
    },
  });

  queue.enqueue([toolCallStartEvent()], {
    toolCallStarts: [{ occurrenceId: toolOccurrenceId, eventIndex: 0 }],
  });
  const retry = await queue.flush();
  assertEquals(retry.outcome, "retry_scheduled");
  assertEquals(retry.pendingEventCount, 1);
  assertEquals(await queue.flush(), {
    outcome: "flushed",
    latestEventId: 7,
    latestExternalEventSequence: 5,
    pendingEventCount: 0,
    consecutiveFailures: 0,
    disabled: false,
  });
  assertEquals(
    queue.takeToolCallAdmissionReceipt?.(toolOccurrenceId)?.admissionEventId,
    admissionEventId,
  );
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
