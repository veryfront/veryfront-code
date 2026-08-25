import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  createForkRuntimeStreamMappingState,
  mapAgUiRuntimeEventToForkParts,
} from "./fork-runtime-part-mapper.ts";

describe("agent/fork-runtime-part-mapper", () => {
  it("maps direct source-document events to fork source parts", () => {
    const state = createForkRuntimeStreamMappingState();

    const parts = mapAgUiRuntimeEventToForkParts(
      {
        type: "source-document",
        sourceId: "knowledge/product/limits.md",
        mediaType: "text/markdown",
        title: "Product limits",
        filename: "limits.md",
      },
      state,
    );

    assertEquals(parts, [{
      type: "source",
      id: "knowledge/product/limits.md",
      sourceType: "document",
      mediaType: "text/markdown",
      title: "Product limits",
      filename: "limits.md",
    }]);
  });

  it("maps direct source-url events to fork source parts", () => {
    const state = createForkRuntimeStreamMappingState();

    const parts = mapAgUiRuntimeEventToForkParts(
      {
        type: "source-url",
        sourceId: "docs-1",
        url: "https://example.com/docs",
        title: "Docs",
      },
      state,
    );

    assertEquals(parts, [{
      type: "source",
      id: "docs-1",
      sourceType: "url",
      url: "https://example.com/docs",
      title: "Docs",
    }]);
  });

  it("maps wrapped source-document data events to fork source parts", () => {
    const state = createForkRuntimeStreamMappingState();

    const parts = mapAgUiRuntimeEventToForkParts(
      {
        type: "data",
        data: {
          name: "source-document",
          value: {
            type: "source-document",
            sourceId: "knowledge/product/limits.md",
            mediaType: "text/markdown",
            title: "Product limits",
            filename: "limits.md",
          },
        },
      },
      state,
    );

    assertEquals(parts, [{
      type: "source",
      id: "knowledge/product/limits.md",
      sourceType: "document",
      mediaType: "text/markdown",
      title: "Product limits",
      filename: "limits.md",
    }]);
  });

  it("maps wrapped source-url data events to fork source parts", () => {
    const state = createForkRuntimeStreamMappingState();

    const parts = mapAgUiRuntimeEventToForkParts(
      {
        type: "data",
        data: {
          name: "source-url",
          value: {
            type: "source-url",
            sourceId: "docs-1",
            url: "https://example.com/docs",
            title: "Docs",
          },
        },
      },
      state,
    );

    assertEquals(parts, [{
      type: "source",
      id: "docs-1",
      sourceType: "url",
      url: "https://example.com/docs",
      title: "Docs",
    }]);
  });

  it("rejects wrapped sources whose custom event name disagrees with the payload", () => {
    const state = createForkRuntimeStreamMappingState();

    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        {
          type: "data",
          data: {
            name: "source-document",
            value: {
              type: "source-url",
              sourceId: "docs-1",
              url: "https://example.com/docs",
            },
          },
        },
        state,
      ),
      [],
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

  it("emits a missing tool-call before a streamed tool error", () => {
    const state = createForkRuntimeStreamMappingState();

    mapAgUiRuntimeEventToForkParts(
      { type: "tool-input-start", toolCallId: "tool-1", toolName: "create_file" },
      state,
    );
    mapAgUiRuntimeEventToForkParts(
      { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"path":"plan.md"}' },
      state,
    );

    const parts = mapAgUiRuntimeEventToForkParts(
      { type: "tool-output-error", toolCallId: "tool-1", errorText: "disk full" },
      state,
    );

    assertEquals(parts.length, 2, "a streamed tool error must recover the missing tool-call part");
    assertEquals(parts[0], {
      type: "tool-call",
      toolCallId: "tool-1",
      toolName: "create_file",
      input: { path: "plan.md" },
    }, "the recovered tool-call must carry the streamed tool name and input");
    if (parts[1]?.type !== "tool-error") {
      throw new Error("Expected a tool-error part");
    }
    assertEquals(parts[1].toolCallId, "tool-1", "the tool-error must carry the tool call id");
    assertEquals(
      parts[1].toolName,
      "create_file",
      "the tool-error must carry the streamed tool name",
    );
    assertEquals(
      parts[1].input,
      { path: "plan.md" },
      "the tool-error must carry the streamed tool input",
    );
    assertEquals(
      parts[1].error.message,
      "disk full",
      "the tool-error must preserve the upstream errorText",
    );
  });

  it("skips preliminary tool output", () => {
    const state = createForkRuntimeStreamMappingState();

    mapAgUiRuntimeEventToForkParts(
      { type: "tool-input-start", toolCallId: "tool-1", toolName: "create_file" },
      state,
    );

    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        {
          type: "tool-output-available",
          toolCallId: "tool-1",
          output: { partial: true },
          preliminary: true,
        },
        state,
      ),
      [],
      "a preliminary tool output must not emit fork parts",
    );
    assertEquals(
      state.emittedToolResultIds.has("tool-1"),
      false,
      "a preliminary tool output must not mark the tool result as emitted",
    );
  });

  it("preserves the concrete upstream error when errorText is absent", () => {
    const state = createForkRuntimeStreamMappingState();

    const parts = mapAgUiRuntimeEventToForkParts(
      {
        type: "error",
        error: 'Tool "gmail__upload_attachment" is not registered',
      },
      state,
    );

    assertEquals(parts.length, 1);
    assertEquals(parts[0]?.type, "error");
    if (parts[0]?.type !== "error") {
      throw new Error("Expected an error part");
    }
    assertEquals(
      parts[0].error.message,
      'Tool "gmail__upload_attachment" is not registered',
    );
  });
});
