import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NATIVE_RUN_EVENTS } from "#veryfront/agent/ag-ui/native-run-events.ts";
import {
  fromRunEventWireName,
  getRunEventClass,
  isRunEventType,
  NATIVE_RUN_EVENT_TYPES,
  RUN_EVENT_CLASSES,
  RUN_EVENT_TYPES,
  type RunEventType,
  toRunEventWireName,
} from "./vocabulary.ts";

/**
 * Read from the veryfront-api catalog on 2026-09-10: `RUN_EVENT_TYPES` in
 * `src/lib/types/run-event/payload.ts`, which derives from the options of
 * `RunEventPayloadSchema`. The cross-repository contract fixture
 * (`tests/fixtures/contracts/native-run-events.json`) covers the eight types
 * this runtime emits; these two values cover the other forty-five, which have
 * no producer here and so no fixture sample.
 *
 * Pinning a length and a digest rather than a second copy of the list keeps
 * the list itself the one declaration: `RUN_EVENT_TYPES` in `vocabulary.ts` is
 * the copy under test, and a name changed there fails the digest.
 */
const API_RUN_EVENT_TYPE_COUNT = 53;
const API_RUN_EVENT_TYPES_SHA256 =
  "9aeb493b3010fc05f63ca401ddb92e546c3f0dca4b51000ed0cdb3cb680c5803";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("run-events/vocabulary", () => {
  it("matches the API catalog's type list", async () => {
    assertEquals(RUN_EVENT_TYPES.length, API_RUN_EVENT_TYPE_COUNT);
    assertEquals(
      await sha256Hex([...RUN_EVENT_TYPES].sort().join("\n")),
      API_RUN_EVENT_TYPES_SHA256,
    );
  });

  it("lists every type exactly once", () => {
    assertEquals(new Set<string>(RUN_EVENT_TYPES).size, RUN_EVENT_TYPES.length);
  });

  it("agrees with the producer vocabulary on the types this runtime emits", () => {
    for (const entry of NATIVE_RUN_EVENTS) {
      assert(
        isRunEventType(entry.storedType),
        `${entry.storedType} is emitted here but is not catalogued`,
      );
      assertEquals(toRunEventWireName(entry.storedType), entry.wireName);
      assertEquals(fromRunEventWireName(entry.wireName), entry.storedType);
    }
  });

  it("exposes the produced types as catalogued types", () => {
    assertEquals(
      [...NATIVE_RUN_EVENT_TYPES],
      NATIVE_RUN_EVENTS.map((entry) => entry.storedType),
    );
  });

  it("round-trips every wire name", () => {
    for (const eventType of RUN_EVENT_TYPES) {
      assertEquals(fromRunEventWireName(toRunEventWireName(eventType)), eventType);
    }
  });

  it("returns null for a wire name it does not know", () => {
    assertEquals(fromRunEventWireName("SomethingTheApiAddedLater"), null);
    assertEquals(fromRunEventWireName("Custom"), null);
  });

  it("classes the seven delta types as delta and everything else as fact", () => {
    const deltas = RUN_EVENT_TYPES.filter((eventType) => getRunEventClass(eventType) === "delta");
    assertEquals(deltas, [
      "TEXT_MESSAGE_CONTENT",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_CHUNK",
      "STATE_DELTA",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_CONTENT",
      "ACTIVITY_DELTA",
    ] as RunEventType[]);
  });

  it("classes an uncatalogued type as a fact rather than failing", () => {
    assertEquals(getRunEventClass("SOMETHING_THE_API_ADDED_LATER"), "fact");
    assertEquals(RUN_EVENT_CLASSES, ["fact", "delta"]);
  });

  it("rejects a type outside the catalog, CUSTOM included", () => {
    assertEquals(isRunEventType("CUSTOM"), false);
    assertEquals(isRunEventType("tool-call-status"), false);
    assertEquals(isRunEventType("URL_CITED"), true);
  });
});
