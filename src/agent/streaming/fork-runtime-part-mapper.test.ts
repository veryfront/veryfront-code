import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  createForkRuntimeStreamMappingState,
  mapAgUiRuntimeEventToForkParts,
} from "./fork-runtime-part-mapper.ts";

describe("agent/fork-runtime-part-mapper", () => {
  it("preserves authoritative source metadata for child stream mirroring", () => {
    const state = createForkRuntimeStreamMappingState();

    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        {
          type: "source-document",
          sourceId: "knowledge/product/limits.md",
          mediaType: "text/x-markdown",
          title: "Curated product limits",
          filename: "limits.md",
        },
        state,
      ),
      [{
        type: "source",
        id: "knowledge/product/limits.md",
        sourceType: "document",
        mediaType: "text/x-markdown",
        title: "Curated product limits",
        filename: "limits.md",
      }],
    );
  });

  it("emits a missing tool-call before a final tool-result", () => {
    const state = createForkRuntimeStreamMappingState();

    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        { type: "tool-input-start", toolCallId: "tool-1", toolName: "create_file" },
        state,
      ),
      [{ type: "tool-input-start", toolCallId: "tool-1", toolName: "create_file" }],
    );
    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"path":' },
        state,
      ),
      [{ type: "tool-input-delta", toolCallId: "tool-1", delta: '{"path":' }],
    );
    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '"plan.md"}' },
        state,
      ),
      [{ type: "tool-input-delta", toolCallId: "tool-1", delta: '"plan.md"}' }],
    );

    const parts = mapAgUiRuntimeEventToForkParts(
      {
        type: "tool-output-available",
        toolCallId: "tool-1",
        output: { path: "plan.md" },
      },
      state,
    );

    assertEquals(parts, [
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "plan.md" },
      },
      {
        type: "tool-result",
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "plan.md" },
        output: { path: "plan.md" },
      },
    ]);
  });
});
