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
