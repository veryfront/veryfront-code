import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAgUiEncoderState,
  mapRuntimeStreamEventToAgUiEvents,
} from "#veryfront/agent/ag-ui/encoder.ts";

describe("observation encoder private intrinsics", () => {
  it("preserves observed tool inputs when project code replaces JSON.stringify", () => {
    const original = JSON.stringify;
    let events: ReturnType<typeof mapRuntimeStreamEventToAgUiEvents> = [];
    try {
      JSON.stringify = () => {
        throw new Error("project replacement");
      };
      events = mapRuntimeStreamEventToAgUiEvents(createAgUiEncoderState(), {
        type: "tool-input-available",
        toolCallId: "tool-observed",
        toolName: "lookup",
        input: { query: "exact input" },
      });
    } finally {
      JSON.stringify = original;
    }
    const args = events.find((event) => event.event === "ToolCallArgs");
    assertEquals(args?.payload.delta, '{"query":"exact input"}');
  });

  it("preserves custom observations when project code replaces string methods", () => {
    const startsWith = String.prototype.startsWith;
    const slice = String.prototype.slice;
    let events: ReturnType<typeof mapRuntimeStreamEventToAgUiEvents> = [];
    try {
      String.prototype.startsWith = () => false;
      String.prototype.slice = () => "";
      events = mapRuntimeStreamEventToAgUiEvents(
        createAgUiEncoderState({ nowMs: null, epochMs: null }),
        {
          type: "data-message-metadata",
          data: { status: "running" },
        },
      );
    } finally {
      String.prototype.startsWith = startsWith;
      String.prototype.slice = slice;
    }
    assertEquals(events, [{
      event: "Custom",
      payload: { name: "message-metadata", value: { status: "running" } },
    }]);
  });
});
