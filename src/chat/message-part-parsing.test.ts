import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildToolResultOutput,
  getFilePart,
  getRawToolCallPart,
  getRawToolResultPart,
  getToolPart,
  hasSelfContainedRawToolCallResult,
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

  it("treats an errored tool call with no payload as not self-contained", () => {
    const bare = getRawToolCallPart({
      type: "tool_call",
      id: "c1",
      name: "search",
      state: "error",
    });
    assertEquals(bare === null, false);
    // buildRawToolCallResultOutput alone would return an error-text result for
    // this state. The guard is what keeps it from superseding the paired result.
    assertEquals(buildToolResultOutput({ state: "error" }), {
      type: "error-text",
      value: "Tool error",
    });
    assertEquals(hasSelfContainedRawToolCallResult(bare!), false);
  });

  it("treats an errored tool call carrying errorText or output as self-contained", () => {
    const withErrorText = getRawToolCallPart({
      type: "tool_call",
      id: "c1",
      name: "search",
      state: "error",
      errorText: "boom",
    });
    assertEquals(hasSelfContainedRawToolCallResult(withErrorText!), true);

    const withOutput = getRawToolCallPart({
      type: "tool_call",
      id: "c2",
      name: "search",
      state: "output-available",
      output: { ok: true },
    });
    assertEquals(hasSelfContainedRawToolCallResult(withOutput!), true);
  });

  it("treats a stateless tool call as not self-contained", () => {
    const stateless = getRawToolCallPart({ type: "tool_call", id: "c3", name: "search" });
    assertEquals(hasSelfContainedRawToolCallResult(stateless!), false);
  });

  it("reads a file part only when it carries a url", () => {
    assertEquals(
      getFilePart({ type: "file", mediaType: "text/plain", url: "https://e.test/a.txt" }),
      {
        type: "file",
        mediaType: "text/plain",
        data: "https://e.test/a.txt",
        url: "https://e.test/a.txt",
      },
    );
    assertEquals(getFilePart({ type: "file", mediaType: "text/plain" }), null);
    assertEquals(getFilePart({ type: "file", url: "https://e.test/a.txt" }), null);
    assertEquals(getFilePart({ type: "text", text: "hi" }), null);
  });
});
