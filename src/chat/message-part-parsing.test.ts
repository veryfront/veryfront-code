import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildToolResultOutput,
  getRawToolResultPart,
  getToolPart,
} from "./message-part-parsing.ts";

describe("message-part-parsing", () => {
  it("derives the tool name from a tool- prefixed type", () => {
    const parsed = getToolPart({
      type: "tool-search",
      toolCallId: "c1",
      state: "output-available",
      input: { q: "x" },
    });
    assertEquals(parsed?.toolName, "search");
    assertEquals(parsed?.toolCallId, "c1");
  });

  it("rejects a part missing toolCallId, state, or name", () => {
    assertEquals(getToolPart({ type: "tool-search", state: "output-available" }), null);
    assertEquals(getToolPart({ type: "dynamic-tool", toolCallId: "c1", state: "s" }), null);
    assertEquals(getToolPart(null), null);
  });

  it("maps an errored raw tool result to error-text", () => {
    const parsed = getRawToolResultPart({
      type: "tool_result",
      toolCallId: "c1",
      is_error: true,
      output: "boom",
    });
    assertEquals(parsed?.output.type, "error-text");
    assertEquals(parsed?.output.value, "boom");
  });

  it("returns null output for states that carry no result yet", () => {
    assertEquals(buildToolResultOutput({ state: "input-available" }), null);
    assertEquals(
      buildToolResultOutput({ state: "output-error", errorText: "bad" }),
      { type: "error-text", value: "bad" },
    );
  });
});
