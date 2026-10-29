import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createHostedRunEventWriterCapability,
  hostedAcceptedChildEvidenceFromCapability,
  hostedAcceptedTaskInputReference,
  persistHostedAcceptedTaskInput,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
import { ACCEPTED_TASK_INPUT_EVENT_TYPE } from "./accepted-task-input.ts";

const parentRunId = "parent-routing-id";
const canonicalRunId = "11111111-1111-4111-8111-111111111111";
const event = {
  type: ACCEPTED_TASK_INPUT_EVENT_TYPE,
  version: 1 as const,
  targetAgentId: "child-agent",
  sourceEventIds: [1],
  artifactVersions: [{
    path: "intake.json",
    version_id: canonicalRunId,
    sha256: "a".repeat(64),
    size_bytes: 12,
  }],
  payload: { intakeId: "intake-1" },
};
const result = () =>
  Response.json({ run_id: canonicalRunId, appended_count: 1, latest_event_id: 2 });
type FetchTransport = typeof globalThis.fetch;
const capability = (fetch: FetchTransport = () => Promise.resolve(result())) =>
  createHostedRunEventWriterCapability({
    apiUrl: "https://api.example/v1/",
    runId: parentRunId,
    canonicalRunId,
    runEventAppendToken: "private-writer",
    fetch,
  });

it("grants an exact-parent child receipt only after authenticated event persistence", async () => {
  const calls: Request[] = [];
  const writer = capability((input, init) => {
    calls.push(new Request(input, init));
    return Promise.resolve(result());
  });
  const receipt = await runWithHostedRunEventWriterCapability(
    writer,
    () =>
      persistHostedAcceptedTaskInput({
        parentRunId,
        toolCallId: "call-1",
        event,
        abortSignal: new AbortController().signal,
      }),
  );
  assertEquals(calls[0]!.url, `https://api.example/v1/runs/${canonicalRunId}/events`);
  assertEquals(calls[0]!.headers.get("Authorization"), "Bearer private-writer");
  assertEquals(await calls[0]!.json(), { events: [event] });
  assertEquals(Object.isFrozen(receipt), true);
  assertEquals(hostedAcceptedTaskInputReference(receipt, parentRunId, event.targetAgentId), {
    event_id: 2,
  });
  assertEquals(
    hostedAcceptedTaskInputReference(undefined, parentRunId, event.targetAgentId),
    undefined,
  );
  assertThrows(() =>
    hostedAcceptedTaskInputReference({ ...receipt }, parentRunId, event.targetAgentId)
  );
  assertThrows(() =>
    hostedAcceptedTaskInputReference(receipt, "foreign-parent", event.targetAgentId)
  );
  assertThrows(() => hostedAcceptedTaskInputReference(receipt, parentRunId, "foreign-child"));
});

it("rejects malformed nested input before authenticated persistence transport", async () => {
  let calls = 0;
  const writer = capability(() => {
    calls++;
    return Promise.resolve(result());
  });
  for (const payload of [null, "input", 42, true, []]) {
    await assertRejects(() =>
      persistHostedAcceptedTaskInput({
        capability: writer,
        parentRunId,
        toolCallId: "call-1",
        event: Object.defineProperty({ ...event }, "payload", { value: payload }),
      })
    );
  }
  assertEquals(calls, 0);
});

it("rejects absent or wrong-parent persistence authority before transport", async () => {
  await assertRejects(() =>
    persistHostedAcceptedTaskInput({ parentRunId, toolCallId: "call-1", event })
  );
  await assertRejects(() =>
    persistHostedAcceptedTaskInput({
      capability: capability(),
      parentRunId: "foreign",
      toolCallId: "call-1",
      event,
    })
  );
  const unbound = createHostedRunEventWriterCapability({
    apiUrl: "https://api.example",
    runId: parentRunId,
    runEventAppendToken: "private-writer",
  });
  await assertRejects(() =>
    persistHostedAcceptedTaskInput({
      capability: unbound,
      parentRunId,
      toolCallId: "call-1",
      event,
    })
  );
});

it("does not grant a receipt for failed oversized or inconsistent persistence acknowledgments", async () => {
  for (
    const response of [
      new Response("denied", { status: 403 }),
      new Response("x".repeat(4097)),
      Response.json({ run_id: "foreign", appended_count: 1, latest_event_id: 2 }),
      Response.json({ run_id: canonicalRunId, appended_count: 0, latest_event_id: 2 }),
      Response.json({ run_id: canonicalRunId, appended_count: 1, latest_event_id: 0 }),
      Response.json({ run_id: canonicalRunId, appended_count: 1, latest_event_id: 1.5 }),
    ]
  ) {
    await assertRejects(() =>
      persistHostedAcceptedTaskInput({
        capability: capability(() => Promise.resolve(response)),
        parentRunId,
        toolCallId: "call-1",
        event,
      })
    );
  }
});

it("requires matching parent authority before exposing accepted child evidence readers", () => {
  const readers = {
    readParentToolResults: () => Promise.resolve([]),
    readCommittedVersion: () => Promise.reject(new Error("Unexpected artifact read")),
  };
  const writer = createHostedRunEventWriterCapability({
    apiUrl: "https://api.example",
    runId: parentRunId,
    canonicalRunId,
    runEventAppendToken: "private-writer",
    acceptedChildEvidence: () => readers,
  });
  assertEquals(hostedAcceptedChildEvidenceFromCapability(writer, parentRunId, "project"), readers);
  assertThrows(() => hostedAcceptedChildEvidenceFromCapability(undefined, parentRunId, "project"));
  assertThrows(() => hostedAcceptedChildEvidenceFromCapability(writer, "foreign", "project"));
  assertThrows(() =>
    hostedAcceptedChildEvidenceFromCapability(capability(), parentRunId, "project")
  );
});

it("recovers the original keyed receipt after response loss with a fresh capability", async () => {
  const stored = new Map<string, { payload: string; eventId: number }>();
  let writes = 0;
  let loseResponse = true;
  const fetch: FetchTransport = async (_url, init) => {
    const key = new Headers(init?.headers).get("Idempotency-Key");
    const payload = String(init?.body);
    const previous = key ? stored.get(key) : undefined;
    if (previous && previous.payload !== payload) return new Response(null, { status: 409 });
    const eventId = previous?.eventId ?? ++writes;
    if (key) stored.set(key, { payload, eventId });
    if (loseResponse) {
      loseResponse = false;
      throw new Error("Response lost after commit");
    }
    return Response.json({ run_id: canonicalRunId, appended_count: 1, latest_event_id: eventId });
  };
  const persist = (toolCallId: string, accepted = event) =>
    persistHostedAcceptedTaskInput({
      capability: capability(fetch),
      parentRunId,
      toolCallId,
      event: accepted,
    });
  await assertRejects(() => persist("call-1"), Error, "Response lost");
  const receipt = await persist("call-1");
  assertEquals(hostedAcceptedTaskInputReference(receipt, parentRunId, event.targetAgentId), {
    event_id: 1,
  });
  await persist("call-2");
  const replay = await persist("call-1");
  assertEquals(hostedAcceptedTaskInputReference(replay, parentRunId, event.targetAgentId), {
    event_id: 1,
  });
  await assertRejects(() => persist("call-1", { ...event, payload: { intakeId: "changed" } }));
  assertEquals(writes, 2);
});
