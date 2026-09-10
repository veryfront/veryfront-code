// This test reads the pinned cross-repository contract fixture off disk, a
// genuine filesystem read, so it lives in the semantic integration suite
// rather than beside the colocated unit tests.
import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getConversationTypedRunEventRowSchema,
  getRunEventClass,
  isRunEventType,
  parseTypedRunEventRow,
  RUN_EVENT_PAYLOAD_SCHEMAS,
  toRunEventWireName,
} from "#veryfront/run-events/index.ts";

// Resolved from this module's URL, not the working directory, so the suite runs
// the same way from any cwd.
const FIXTURE_URL = new URL(
  "../../../../../tests/fixtures/contracts/native-run-events.json",
  import.meta.url,
);

interface ContractSample {
  storedType: string;
  legacyCustomName: string;
  live: { event: string; payload: Record<string, unknown> };
  durable: Record<string, unknown>;
}

const SAMPLES = JSON.parse(await Deno.readTextFile(FIXTURE_URL)) as ContractSample[];

/**
 * The envelope a typed read surface wraps a row in. Span, turn and origin
 * fields are what the API's projection derives for a durably appended row; the
 * payload under test is the fixture's own.
 */
function envelopeFor(sample: ContractSample, eventId: number) {
  return {
    event_id: eventId,
    event_type: sample.storedType,
    run_id: "run_native_events_1",
    event_class: getRunEventClass(sample.storedType),
    span_id: "message:33333333-3333-4333-a333-333333333333",
    parent_span_id: null,
    turn_id: "message:33333333-3333-4333-a333-333333333333",
    origin_event_type: sample.storedType,
    origin_custom_name: null,
    unrecoverable_fields: [],
    created_at: "2026-09-09T00:00:00.000Z",
    is_error: false,
  };
}

describe("run-events typed contract fixture", () => {
  it("covers the eight types this runtime emits", () => {
    assertEquals(SAMPLES.length, 8);
  });

  it("names every sample with a catalogued type and its wire name", () => {
    for (const sample of SAMPLES) {
      assert(
        isRunEventType(sample.storedType),
        `${sample.storedType} is in the fixture but not in the catalog`,
      );
      assertEquals(toRunEventWireName(sample.storedType), sample.live.event);
    }
  });

  it("validates every durable sample against its per-type payload schema", () => {
    for (const sample of SAMPLES) {
      const getSchema = isRunEventType(sample.storedType)
        ? RUN_EVENT_PAYLOAD_SCHEMAS[sample.storedType]
        : undefined;
      assert(getSchema, `no payload schema for ${sample.storedType}`);
      const result = getSchema().safeParse(sample.durable);
      assert(
        result.success,
        `${sample.storedType} payload rejected: ${JSON.stringify(result)}`,
      );
    }
  });

  it("validates the live payload once its stored type is restored", () => {
    for (const sample of SAMPLES) {
      const getSchema = isRunEventType(sample.storedType)
        ? RUN_EVENT_PAYLOAD_SCHEMAS[sample.storedType]
        : undefined;
      assert(getSchema, `no payload schema for ${sample.storedType}`);
      // The live frame carries its type on the SSE `event:` line rather than in
      // the payload, which is the one shape difference between the two.
      const result = getSchema().safeParse({
        type: sample.storedType,
        ...sample.live.payload,
      });
      assert(result.success, `${sample.storedType} live payload rejected`);
    }
  });

  it("accepts every durable sample wrapped in a typed row", () => {
    SAMPLES.forEach((sample, index) => {
      const row = parseTypedRunEventRow({
        ...envelopeFor(sample, index + 1),
        payload: sample.durable,
      });
      assertEquals(row.event_type, sample.storedType);
      assertEquals(row.payload.type, sample.storedType);
      assertEquals(row.event_class, "fact");
    });
  });

  it("accepts every durable sample on the conversation-scoped row", () => {
    SAMPLES.forEach((sample, index) => {
      const row = getConversationTypedRunEventRowSchema().parse({
        ...envelopeFor(sample, index + 1),
        event: sample.durable,
      });
      assertEquals(row.event.type, sample.storedType);
    });
  });
});
