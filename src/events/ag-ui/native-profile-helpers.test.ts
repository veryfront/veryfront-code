import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import {
  aguiBase,
  aguiEnvelopeBase,
  nativeContextFields,
  nativeOccurrenceFields,
  optionalNumber,
  optionalString,
  requireRecord,
  requireStringValue,
  toJsonObject,
} from "#veryfront/events/ag-ui/native-profile-helpers.ts";

Deno.test("native profile helpers preserve omission and empty protocol string semantics", () => {
  assertEquals(aguiBase(undefined, new Set()), {});
  assertEquals(
    aguiBase({ timestamp: undefined, metadata: undefined, rawEvent: undefined }, new Set()),
    {},
  );
  assertEquals(nativeContextFields({ subject: "", traceparent: undefined }), { subject: "" });
  assertEquals(nativeOccurrenceFields({ source: "source", id: "id", time: undefined }), {
    source: "source",
    id: "id",
  });
  assertEquals(requireStringValue("", "identity"), "");
  assertEquals(optionalString(undefined, "occurrence"), undefined);
  assertThrows(
    () => optionalString("", "occurrence"),
    TypeError,
    "occurrence must be a non-empty string",
  );
  assertThrows(() => requireRecord([], "metadata"), TypeError, "metadata must be an object");
  assertEquals(optionalNumber(Infinity, "timestamp"), Infinity);
});

Deno.test("native profile helpers validate extensions before restoring protocol attribution", () => {
  const protocol = {
    extensions: { extra: "preserved" },
    timestamp: 0,
    rawEvent: null,
    metadata: {},
    attribution: { invocation: { subagentRunId: "" } },
  };
  assertEquals<Record<string, unknown>>(aguiBase(protocol, new Set(["type"])), {
    extra: "preserved",
    timestamp: 0,
    rawEvent: null,
    metadata: {},
    subagentRunId: "",
  });
  assertEquals<Record<string, unknown>>(aguiEnvelopeBase(protocol, new Set(["type"])), {
    extra: "preserved",
    timestamp: 0,
    rawEvent: null,
    metadata: {},
  });
  assertThrows(
    () => aguiBase({ extensions: { type: "CUSTOM" }, metadata: [] }, new Set(["type"])),
    TypeError,
    "protocol.agui.extensions must not contain reserved AG-UI field type",
  );
  assertThrows(
    () => aguiBase({ attribution: { invocation: {} } }, new Set()),
    TypeError,
    "protocol.agui.attribution.invocation.subagentRunId must be a string",
  );
});

Deno.test("native profile helpers snapshot JSON objects and reject unsupported metadata", () => {
  const input = { nested: { value: "before" } };
  const snapshot = toJsonObject(input);
  input.nested.value = "after";
  assertEquals(snapshot, { nested: { value: "before" } });
  assertEquals(toJsonObject([]), undefined);
  assertEquals(toJsonObject({ value: undefined }), undefined);
});
