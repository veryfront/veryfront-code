import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ConversationTypedRunEventRowInput,
  getConversationTypedRunEventRowSchema,
  getRunEventEnvelopeSchema,
  getTypedRunEventRowSchema,
  parseTypedRunEventRow,
} from "./envelope.ts";

/** A realistic envelope, field for field what a typed read surface returns. */
const ENVELOPE = {
  event_id: 42,
  event_type: "URL_CITED",
  run_id: "run_native_events_1",
  event_class: "fact" as const,
  span_id: "message:33333333-3333-4333-a333-333333333333",
  parent_span_id: null,
  turn_id: "message:33333333-3333-4333-a333-333333333333",
  origin_event_type: "URL_CITED",
  origin_custom_name: null,
  unrecoverable_fields: [] as string[],
  created_at: "2026-09-09T00:00:00.000Z",
  is_error: false,
};

const PAYLOAD = {
  type: "URL_CITED",
  sourceId: "web-1",
  url: "https://example.com/reference",
  title: "Reference",
};

describe("run-events/envelope", () => {
  it("accepts a realistic envelope", () => {
    assertEquals(getRunEventEnvelopeSchema().parse(ENVELOPE), ENVELOPE);
  });

  it("accepts a null event_id, which a live frame that was never stored carries", () => {
    const parsed = getRunEventEnvelopeSchema().parse({ ...ENVELOPE, event_id: null });
    assertEquals(parsed.event_id, null);
  });

  it("rejects a row with no event_type", () => {
    const { event_type: _dropped, ...withoutEventType } = ENVELOPE;
    assertThrows(() => getRunEventEnvelopeSchema().parse(withoutEventType));
    assertThrows(() => getRunEventEnvelopeSchema().parse({ ...ENVELOPE, event_type: "" }));
  });

  it("accepts an event_type the catalog does not list yet", () => {
    const parsed = getRunEventEnvelopeSchema().parse({
      ...ENVELOPE,
      event_type: "SOMETHING_THE_API_ADDED_LATER",
    });
    assertEquals(parsed.event_type, "SOMETHING_THE_API_ADDED_LATER");
  });

  it("rejects an event_class outside fact and delta", () => {
    assertThrows(() => getRunEventEnvelopeSchema().parse({ ...ENVELOPE, event_class: "chunk" }));
  });

  it("keeps the failing field paths of a row the API could not fully project", () => {
    const parsed = getRunEventEnvelopeSchema().parse({
      ...ENVELOPE,
      unrecoverable_fields: ["payload.sourceId"],
    });
    assertEquals(parsed.unrecoverable_fields, ["payload.sourceId"]);
  });

  it("parses a run-scoped row keyed by payload", () => {
    const row = parseTypedRunEventRow({ ...ENVELOPE, payload: PAYLOAD });
    assertEquals(row.event_type, "URL_CITED");
    assertEquals(row.payload.type, "URL_CITED");
    assertEquals(row.span_id, ENVELOPE.span_id);
  });

  it("keeps payload keys it does not declare", () => {
    const row = parseTypedRunEventRow({
      ...ENVELOPE,
      payload: { ...PAYLOAD, aFieldAddedLater: 7 },
    });
    assertEquals(row.payload.aFieldAddedLater, 7);
  });

  it("throws on a row with no payload", () => {
    assertThrows(() => parseTypedRunEventRow(ENVELOPE));
  });

  it("throws on a payload with no type", () => {
    assertThrows(() =>
      parseTypedRunEventRow({ ...ENVELOPE, payload: { url: "https://example.com" } })
    );
  });

  it("reports the failure instead of throwing when asked to", () => {
    const result = getTypedRunEventRowSchema().safeParse({ ...ENVELOPE, payload: {} });
    assertEquals(result.success, false);
  });

  it("accepts the conversation-scoped row keyed by payload, as every surface serves it now", () => {
    const row = getConversationTypedRunEventRowSchema().parse({ ...ENVELOPE, payload: PAYLOAD });
    assertEquals(row.payload, PAYLOAD);
    assertEquals(row.run_id, ENVELOPE.run_id);
  });

  it("exposes the payload-keyed row under the event alias too, until Phase F", () => {
    const row = getConversationTypedRunEventRowSchema().parse({ ...ENVELOPE, payload: PAYLOAD });
    assertEquals(row.event, PAYLOAD);
  });

  it("still accepts the conversation-scoped row keyed by the event alias", () => {
    const row = getConversationTypedRunEventRowSchema().parse({ ...ENVELOPE, event: PAYLOAD });
    assertEquals(row.payload, PAYLOAD);
    assertEquals(row.event, PAYLOAD);
    assertEquals(row.run_id, ENVELOPE.run_id);
  });

  it("prefers payload when a conversation-scoped row carries both keys", () => {
    const row = getConversationTypedRunEventRowSchema().parse({
      ...ENVELOPE,
      payload: PAYLOAD,
      event: { ...PAYLOAD, url: "https://example.com/stale-alias" },
    });
    assertEquals(row.payload, PAYLOAD);
    assertEquals(row.event, PAYLOAD);
  });

  it("ignores a stale or malformed event alias beside a canonical payload", () => {
    for (const alias of [{}, null, "not an object", { type: "" }]) {
      const row = getConversationTypedRunEventRowSchema().parse({
        ...ENVELOPE,
        payload: PAYLOAD,
        event: alias,
      });
      assertEquals(row.payload, PAYLOAD);
      assertEquals(row.event, PAYLOAD);
    }
  });

  it("reports the alias's own issues under event when it is the row's only payload", () => {
    const result = getConversationTypedRunEventRowSchema().safeParse({ ...ENVELOPE, event: {} });
    assert(!result.success);
    assertEquals(result.issues.map((issue) => issue.path), [["event", "type"]]);
  });

  it("types a hand-built row by the key it carries and parses either shape", () => {
    const byPayload: ConversationTypedRunEventRowInput = { ...ENVELOPE, payload: PAYLOAD };
    const byAlias: ConversationTypedRunEventRowInput = { ...ENVELOPE, event: PAYLOAD };
    // @ts-expect-error a row with neither key is not an input row
    const neither: ConversationTypedRunEventRowInput = { ...ENVELOPE };
    // @ts-expect-error an alias-only row needs a typed payload under event
    const malformedAlias: ConversationTypedRunEventRowInput = { ...ENVELOPE, event: {} };
    for (const input of [byPayload, byAlias]) {
      assertEquals(getConversationTypedRunEventRowSchema().parse(input).payload, PAYLOAD);
    }
    assert(!getConversationTypedRunEventRowSchema().safeParse(neither).success);
    assert(!getConversationTypedRunEventRowSchema().safeParse(malformedAlias).success);
  });

  it("rejects a conversation-scoped row with neither payload nor event, naming both keys", () => {
    const result = getConversationTypedRunEventRowSchema().safeParse({ ...ENVELOPE });
    assertEquals(result.success, false);
    assert(!result.success);
    const message = JSON.stringify(result.error);
    assert(message.includes("payload"), message);
    assert(message.includes("event"), message);
  });

  it("does not accept the event alias on the run-scoped schema", () => {
    assertThrows(() => parseTypedRunEventRow({ ...ENVELOPE, event: PAYLOAD }));
  });

  it("accepts a run-scoped row whose payload.type agrees with event_type", () => {
    const row = parseTypedRunEventRow({ ...ENVELOPE, payload: PAYLOAD });
    assertEquals(row.event_type, row.payload.type);
  });

  it("rejects a run-scoped row whose payload.type disagrees with event_type", () => {
    assertThrows(() =>
      parseTypedRunEventRow({
        ...ENVELOPE,
        event_type: "URL_CITED",
        payload: { ...PAYLOAD, type: "RUN_ERROR" },
      })
    );
  });

  it("throws on a run-scoped row whose payload has no type", () => {
    assertThrows(() =>
      parseTypedRunEventRow({ ...ENVELOPE, payload: { ...PAYLOAD, type: undefined } })
    );
  });

  it("accepts a conversation-scoped row whose payload.type agrees with event_type", () => {
    const row = getConversationTypedRunEventRowSchema().parse({ ...ENVELOPE, payload: PAYLOAD });
    assertEquals(row.event_type, row.payload.type);
  });

  it("rejects a conversation-scoped row whose payload.type disagrees with event_type", () => {
    assertThrows(() =>
      getConversationTypedRunEventRowSchema().parse({
        ...ENVELOPE,
        event_type: "URL_CITED",
        payload: { ...PAYLOAD, type: "RUN_ERROR" },
      })
    );
  });

  it("checks the type agreement against payload when both keys are present", () => {
    // payload wins, so a disagreeing payload fails even though the alias agrees...
    assertThrows(() =>
      getConversationTypedRunEventRowSchema().parse({
        ...ENVELOPE,
        event_type: "URL_CITED",
        payload: { ...PAYLOAD, type: "RUN_ERROR" },
        event: PAYLOAD,
      })
    );
    // ...and an agreeing payload passes even though the alias disagrees.
    const row = getConversationTypedRunEventRowSchema().parse({
      ...ENVELOPE,
      event_type: "URL_CITED",
      payload: PAYLOAD,
      event: { ...PAYLOAD, type: "RUN_ERROR" },
    });
    assertEquals(row.payload.type, "URL_CITED");
  });

  it("accepts a conversation-scoped row whose event.type agrees with event_type", () => {
    const row = getConversationTypedRunEventRowSchema().parse({ ...ENVELOPE, event: PAYLOAD });
    assertEquals(row.event_type, row.payload.type);
  });

  it("rejects a conversation-scoped row whose event.type disagrees with event_type", () => {
    assertThrows(() =>
      getConversationTypedRunEventRowSchema().parse({
        ...ENVELOPE,
        event_type: "URL_CITED",
        event: { ...PAYLOAD, type: "RUN_ERROR" },
      })
    );
  });

  it("throws on a conversation-scoped row whose payload has no type", () => {
    assertThrows(() =>
      getConversationTypedRunEventRowSchema().parse({
        ...ENVELOPE,
        payload: { ...PAYLOAD, type: undefined },
      })
    );
  });

  it("throws on a conversation-scoped row whose event has no type", () => {
    assertThrows(() =>
      getConversationTypedRunEventRowSchema().parse({
        ...ENVELOPE,
        event: { ...PAYLOAD, type: undefined },
      })
    );
  });

  it("accepts a run-scoped row whose event_class agrees with its catalogued event_type", () => {
    const row = parseTypedRunEventRow({
      ...ENVELOPE,
      event_type: "TEXT_MESSAGE_CONTENT",
      event_class: "delta",
      payload: { ...PAYLOAD, type: "TEXT_MESSAGE_CONTENT" },
    });
    assertEquals(row.event_class, "delta");
  });

  it("rejects a run-scoped row whose event_class disagrees with its catalogued event_type", () => {
    assertThrows(() =>
      parseTypedRunEventRow({
        ...ENVELOPE,
        event_type: "TEXT_MESSAGE_CONTENT",
        event_class: "fact",
        payload: { ...PAYLOAD, type: "TEXT_MESSAGE_CONTENT" },
      })
    );
  });

  it("accepts a run-scoped row whose event_type is not catalogued, regardless of event_class", () => {
    const row = parseTypedRunEventRow({
      ...ENVELOPE,
      event_type: "SOMETHING_THE_API_ADDED_LATER",
      event_class: "delta",
      payload: { type: "SOMETHING_THE_API_ADDED_LATER" },
    });
    assertEquals(row.event_class, "delta");
  });

  it("accepts a conversation-scoped row whose event_class agrees with its catalogued event_type", () => {
    const row = getConversationTypedRunEventRowSchema().parse({
      ...ENVELOPE,
      event_type: "TEXT_MESSAGE_CONTENT",
      event_class: "delta",
      payload: { ...PAYLOAD, type: "TEXT_MESSAGE_CONTENT" },
    });
    assertEquals(row.event_class, "delta");
  });

  it("rejects a conversation-scoped row whose event_class disagrees with its catalogued event_type", () => {
    for (const key of ["payload", "event"] as const) {
      assertThrows(() =>
        getConversationTypedRunEventRowSchema().parse({
          ...ENVELOPE,
          event_type: "TEXT_MESSAGE_CONTENT",
          event_class: "fact",
          [key]: { ...PAYLOAD, type: "TEXT_MESSAGE_CONTENT" },
        })
      );
    }
  });

  it("accepts a conversation-scoped row whose event_type is not catalogued, regardless of event_class", () => {
    const row = getConversationTypedRunEventRowSchema().parse({
      ...ENVELOPE,
      event_type: "SOMETHING_THE_API_ADDED_LATER",
      event_class: "delta",
      payload: { type: "SOMETHING_THE_API_ADDED_LATER" },
    });
    assertEquals(row.event_class, "delta");
  });
});
