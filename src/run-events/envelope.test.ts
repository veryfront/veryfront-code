import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
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

  it("accepts the conversation-scoped row, which keys the payload as event", () => {
    const row = getConversationTypedRunEventRowSchema().parse({ ...ENVELOPE, event: PAYLOAD });
    assertEquals(row.event.type, "URL_CITED");
    assertEquals(row.run_id, ENVELOPE.run_id);
  });

  it("does not accept the conversation row's key on the run-scoped schema", () => {
    assertThrows(() => parseTypedRunEventRow({ ...ENVELOPE, event: PAYLOAD }));
    assert(
      !getConversationTypedRunEventRowSchema().safeParse({ ...ENVELOPE, payload: PAYLOAD })
        .success,
    );
  });
});
