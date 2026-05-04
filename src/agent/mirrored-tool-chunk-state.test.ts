import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatMessageMetadata, ChatUiMessageChunk } from "../chat/protocol.ts";
import {
  cloneMirroredToolChunkState,
  computeOpenToolCalls,
  createMirroredToolChunkState,
  isDurableMirroredOutputChunk,
  recordMirroredToolChunkState,
} from "./mirrored-tool-chunk-state.ts";

type Chunk = ChatUiMessageChunk<ChatMessageMetadata>;

function createStateAfterRecording(chunk: Chunk): ReturnType<typeof createMirroredToolChunkState> {
  const state = createMirroredToolChunkState();
  recordMirroredToolChunkState(state, chunk);
  return state;
}

function expectMirrored(chunk: Chunk): void {
  assertEquals(isDurableMirroredOutputChunk(chunk), true);
}

function expectNotMirrored(chunk: Chunk): void {
  assertEquals(isDurableMirroredOutputChunk(chunk), false);
}

describe("mirrored-tool-chunk-state", () => {
  it("identifies durable mirrored output chunk types", () => {
    expectMirrored({ type: "text-start", id: "msg-1" });
    expectMirrored({ type: "text-delta", id: "msg-1", delta: "" });
    expectMirrored({ type: "text-end", id: "msg-1" });
    expectMirrored({ type: "reasoning-start", id: "msg-1" });
    expectMirrored({ type: "reasoning-delta", id: "msg-1", delta: "" });
    expectMirrored({ type: "reasoning-end", id: "msg-1" });
    expectMirrored({ type: "tool-input-start", toolCallId: "tc-1", toolName: "bash" });
    expectMirrored({ type: "tool-input-delta", toolCallId: "tc-1", inputTextDelta: "" });
    expectMirrored({
      type: "tool-input-available",
      toolCallId: "tc-1",
      toolName: "bash",
      input: {},
    });
    expectMirrored({
      type: "tool-input-error",
      toolCallId: "tc-1",
      toolName: "bash",
      input: {},
      errorText: "err",
    });
    expectMirrored({ type: "tool-output-available", toolCallId: "tc-1", output: "ok" });
    expectMirrored({ type: "tool-output-error", toolCallId: "tc-1", errorText: "fail" });
    expectMirrored({ type: "tool-output-denied", toolCallId: "tc-1" });

    expectNotMirrored({ type: "start" });
    expectNotMirrored({ type: "finish" });
    expectNotMirrored({ type: "message-metadata", messageMetadata: {} });
  });

  it("creates empty state", () => {
    const state = createMirroredToolChunkState();

    assertEquals(state.startedToolCallIds.size, 0);
    assertEquals(state.inputAvailableToolCallIds.size, 0);
    assertEquals(state.outputAvailableToolCallIds.size, 0);
    assertEquals(state.outputErrorToolCallIds.size, 0);
    assertEquals(state.outputDeniedToolCallIds.size, 0);
  });

  it("clones state as an independent copy", () => {
    const state = createMirroredToolChunkState();
    state.startedToolCallIds.add("tc-1");

    const clone = cloneMirroredToolChunkState(state);
    clone.startedToolCallIds.add("tc-2");

    assertEquals(state.startedToolCallIds.has("tc-2"), false);
    assertEquals(clone.startedToolCallIds.has("tc-1"), true);
  });

  it("records tool lifecycle chunks", () => {
    const inputStarted = createStateAfterRecording({
      type: "tool-input-start",
      toolCallId: "tc-1",
      toolName: "bash",
    });
    assertEquals(inputStarted.startedToolCallIds.has("tc-1"), true);

    const inputAvailable = createStateAfterRecording({
      type: "tool-input-available",
      toolCallId: "tc-1",
      toolName: "bash",
      input: {},
    });
    assertEquals(inputAvailable.startedToolCallIds.has("tc-1"), true);
    assertEquals(inputAvailable.inputAvailableToolCallIds.has("tc-1"), true);

    const outputAvailable = createStateAfterRecording({
      type: "tool-output-available",
      toolCallId: "tc-1",
      output: "ok",
    });
    assertEquals(outputAvailable.outputAvailableToolCallIds.has("tc-1"), true);

    const outputError = createStateAfterRecording({
      type: "tool-output-error",
      toolCallId: "tc-1",
      errorText: "fail",
    });
    assertEquals(outputError.outputErrorToolCallIds.has("tc-1"), true);

    const outputDenied = createStateAfterRecording({
      type: "tool-output-denied",
      toolCallId: "tc-1",
    });
    assertEquals(outputDenied.outputDeniedToolCallIds.has("tc-1"), true);
  });

  it("treats tool-input-error as a terminal error result", () => {
    const state = createStateAfterRecording({
      type: "tool-input-error",
      toolCallId: "tc-1",
      toolName: "edit_file",
      input: { path: "x.md" },
      errorText: "bad args",
    });

    assertEquals(state.outputErrorToolCallIds.has("tc-1"), true);
    assertEquals(computeOpenToolCalls(state), {
      needsInputClose: [],
      needsOutputClose: [],
    });
  });

  it("ignores non-tool chunks while recording state", () => {
    const state = createStateAfterRecording({ type: "text-delta", id: "msg-1", delta: "hi" });

    assertEquals(state.startedToolCallIds.size, 0);
  });

  it("returns output closes for accepted but unresolved tool calls", () => {
    const state = createStateAfterRecording({
      type: "tool-input-available",
      toolCallId: "tc-1",
      toolName: "edit_file",
      input: { path: "x.md" },
    });

    assertEquals(computeOpenToolCalls(state), {
      needsInputClose: [],
      needsOutputClose: [{ toolCallId: "tc-1", toolName: "edit_file" }],
    });
  });
});
