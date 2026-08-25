import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatMessageMetadata, ChatUiMessageChunk } from "../../chat/protocol.ts";
import {
  cloneMirroredToolChunkState,
  closeHostedMirroredOpenToolCalls,
  computeOpenToolCalls,
  createHostedMirroredUiStream,
  createMirroredToolChunkState,
  getHostedMirroredAbortErrorText,
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

async function* streamChunks(
  chunks: readonly Chunk[],
  error?: Error,
): AsyncIterable<Chunk> {
  for (const chunk of chunks) {
    yield chunk;
  }

  if (error) {
    throw error;
  }
}

async function collectChunks(stream: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
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
    state.inputAvailableToolCallIds.add("tc-in");
    state.outputAvailableToolCallIds.add("tc-out");
    state.outputErrorToolCallIds.add("tc-err");
    state.outputDeniedToolCallIds.add("tc-denied");
    state.toolCallNames.set("tc-1", "bash");

    const clone = cloneMirroredToolChunkState(state);
    clone.startedToolCallIds.add("tc-2");
    clone.inputAvailableToolCallIds.add("tc-in-2");
    clone.outputAvailableToolCallIds.add("tc-out-2");
    clone.outputErrorToolCallIds.add("tc-err-2");
    clone.outputDeniedToolCallIds.add("tc-denied-2");
    clone.toolCallNames.set("tc-2", "read");

    assertEquals(
      state.startedToolCallIds.has("tc-2"),
      false,
      "writing started ids on the clone must not reach the source",
    );
    assertEquals(
      state.inputAvailableToolCallIds.has("tc-in-2"),
      false,
      "writing input-available ids on the clone must not reach the source",
    );
    assertEquals(
      state.outputAvailableToolCallIds.has("tc-out-2"),
      false,
      "writing output-available ids on the clone must not reach the source",
    );
    assertEquals(
      state.outputErrorToolCallIds.has("tc-err-2"),
      false,
      "writing output-error ids on the clone must not reach the source",
    );
    assertEquals(
      state.outputDeniedToolCallIds.has("tc-denied-2"),
      false,
      "writing output-denied ids on the clone must not reach the source",
    );
    assertEquals(
      state.toolCallNames.get("tc-2"),
      undefined,
      "writing tool call names on the clone must not reach the source",
    );

    assertEquals(
      clone.startedToolCallIds.has("tc-1"),
      true,
      "the clone must carry the seeded started id",
    );
    assertEquals(
      clone.inputAvailableToolCallIds.has("tc-in"),
      true,
      "the clone must carry the seeded input-available id",
    );
    assertEquals(
      clone.outputAvailableToolCallIds.has("tc-out"),
      true,
      "the clone must carry the seeded output-available id",
    );
    assertEquals(
      clone.outputErrorToolCallIds.has("tc-err"),
      true,
      "the clone must carry the seeded output-error id",
    );
    assertEquals(
      clone.outputDeniedToolCallIds.has("tc-denied"),
      true,
      "the clone must carry the seeded output-denied id",
    );
    assertEquals(
      clone.toolCallNames.get("tc-1"),
      "bash",
      "the clone must carry the seeded tool call name",
    );
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

  it("builds stream abort error text from abort and non-abort errors", () => {
    assertEquals(
      getHostedMirroredAbortErrorText(new DOMException("cancelled", "AbortError")),
      "Chat stream aborted before tool call completed",
    );
    assertEquals(
      getHostedMirroredAbortErrorText(new Error("provider stopped")),
      "Chat stream errored before tool call completed: provider stopped",
    );
  });

  it("closes mirrored open tool calls with terminal error chunks", async () => {
    const state = createMirroredToolChunkState();
    recordMirroredToolChunkState(state, {
      type: "tool-input-start",
      toolCallId: "tc-1",
      toolName: "bash",
    });
    recordMirroredToolChunkState(state, {
      type: "tool-input-available",
      toolCallId: "tc-2",
      toolName: "edit_file",
      input: { path: "AGENTS.md" },
    });

    const chunks: Chunk[] = [];
    const warnings: Array<{ message: string; metadata?: Record<string, unknown> }> = [];

    await closeHostedMirroredOpenToolCalls({
      mirroredToolChunkState: state,
      errorText: "stream stopped",
      appendChunk: (chunk) => {
        chunks.push(chunk);
      },
      logger: {
        warn: (message, metadata) => {
          warnings.push({ message, metadata });
        },
      },
    });

    assertEquals(chunks, [
      {
        type: "tool-input-error",
        toolCallId: "tc-1",
        toolName: "bash",
        input: {},
        errorText: "stream stopped",
      },
      {
        type: "tool-output-error",
        toolCallId: "tc-2",
        errorText: "stream stopped",
      },
    ]);
    assertEquals(warnings.length, 1);
    assertEquals(warnings[0]?.message, "Closing open tool calls after stream abort");
  });

  it("does not append chunks when no mirrored tool calls are open", async () => {
    const chunks: Chunk[] = [];

    await closeHostedMirroredOpenToolCalls({
      mirroredToolChunkState: createMirroredToolChunkState(),
      errorText: "stream stopped",
      appendChunk: (chunk) => {
        chunks.push(chunk);
      },
    });

    assertEquals(chunks, []);
  });

  it("logs tool calls without recoverable tool names", async () => {
    const state = createMirroredToolChunkState();
    state.startedToolCallIds.add("tc-1");

    const warnings: Array<{ message: string; metadata?: Record<string, unknown> }> = [];

    await closeHostedMirroredOpenToolCalls({
      mirroredToolChunkState: state,
      errorText: "stream stopped",
      appendChunk: () => undefined,
      logger: {
        warn: (message, metadata) => {
          warnings.push({ message, metadata });
        },
      },
    });

    assertEquals(
      warnings.map(({ message }) => message),
      [
        "Closing open tool calls after stream abort",
        "Closing aborted tool calls without recoverable tool names",
      ],
    );
  });

  it("mirrors stream chunks, records tool state, observes the stream, and disposes the watchdog", async () => {
    const sourceChunks: Chunk[] = [
      { type: "start" },
      { type: "tool-input-start", toolCallId: "tc-1", toolName: "bash" },
      { type: "tool-output-available", toolCallId: "tc-1", output: "ok" },
    ];
    const observedChunks: Chunk[] = [];
    const appendedChunks: Chunk[] = [];
    let disposed = false;
    let mirroredOutput = false;
    const state = createMirroredToolChunkState();

    const outputChunks = await collectChunks(
      createHostedMirroredUiStream({
        sourceStream: streamChunks(sourceChunks),
        rootStreamWatchdog: {
          observe: (chunk) => {
            observedChunks.push(chunk);
          },
          dispose: () => {
            disposed = true;
          },
        },
        mirroredToolChunkState: state,
        appendChunk: (chunk) => {
          appendedChunks.push(chunk);
        },
        setMirroredOutput: (value) => {
          mirroredOutput = value;
        },
      }),
    );

    assertEquals(outputChunks, sourceChunks);
    assertEquals(observedChunks, sourceChunks);
    assertEquals(appendedChunks, sourceChunks);
    assertEquals(state.startedToolCallIds.has("tc-1"), true);
    assertEquals(state.outputAvailableToolCallIds.has("tc-1"), true);
    assertEquals(disposed, true);
    assertEquals(mirroredOutput, true);
  });

  it("passes through an upstream-derived source without synthesizing duplicates", async () => {
    const path =
      "knowledge/knowledge-ingest-20260723131451088-6d16440c-veryfront-equity-story-13july26.md";
    const sourceChunks: Chunk[] = [
      {
        type: "tool-input-available",
        toolCallId: "tc-1",
        toolName: "get_file",
        input: { path },
      },
      {
        type: "tool-output-available",
        toolCallId: "tc-1",
        output: { path, content: "# Equity story" },
      },
      {
        type: "source-document",
        sourceId: path,
        mediaType: "text/x-markdown",
        title: "Curated equity story",
        filename: path,
      },
      {
        type: "tool-input-available",
        toolCallId: "tc-2",
        toolName: "get_file",
        input: { path },
      },
      {
        type: "tool-output-available",
        toolCallId: "tc-2",
        output: { path, content: "# Equity story" },
      },
    ];
    const appendedChunks: Chunk[] = [];

    const outputChunks = await collectChunks(
      createHostedMirroredUiStream({
        sourceStream: streamChunks(sourceChunks),
        rootStreamWatchdog: {
          observe: () => undefined,
          dispose: () => undefined,
        },
        mirroredToolChunkState: createMirroredToolChunkState(),
        appendChunk: (chunk) => {
          appendedChunks.push(chunk);
        },
      }),
    );
    assertEquals(outputChunks, sourceChunks);
    assertEquals(appendedChunks, outputChunks);
  });

  it("mirrors a richer upstream source after an early fallback flush", async () => {
    const path = "knowledge/product/limits.md";
    const toolInput: Chunk = {
      type: "tool-input-available",
      toolCallId: "tc-1",
      toolName: "get_file",
      input: { path },
    };
    const toolOutput: Chunk = {
      type: "tool-output-available",
      toolCallId: "tc-1",
      output: { path, content: "# Limits" },
    };
    const upstreamSource: Chunk = {
      type: "source-document",
      sourceId: path,
      mediaType: "text/x-markdown",
      title: "Curated product limits",
      filename: path,
    };
    const fallbackSource: Chunk = {
      type: "source-document",
      sourceId: path,
      mediaType: "text/markdown",
      title: path,
      filename: path,
    };
    const appendedChunks: Chunk[] = [];
    let flushPendingDerivedSource = async (): Promise<void> => {};

    async function* sourceStream(): AsyncIterable<Chunk> {
      yield toolInput;
      yield toolOutput;
      await flushPendingDerivedSource();
      yield upstreamSource;
    }

    const outputChunks = await collectChunks(
      createHostedMirroredUiStream({
        sourceStream: sourceStream(),
        rootStreamWatchdog: {
          observe: () => undefined,
          dispose: () => undefined,
        },
        mirroredToolChunkState: createMirroredToolChunkState(),
        appendChunk: (chunk) => {
          appendedChunks.push(chunk);
        },
        registerPendingDerivedSourceFlush: (flush) => {
          flushPendingDerivedSource = flush;
        },
      }),
    );

    assertEquals(outputChunks, [toolInput, toolOutput, upstreamSource]);
    assertEquals(appendedChunks, [
      toolInput,
      toolOutput,
      fallbackSource,
      upstreamSource,
    ]);
  });

  it("mirrors a richer upstream source after a yielded fallback", async () => {
    const path = "knowledge/product/limits.md";
    const sourceChunks: Chunk[] = [
      {
        type: "tool-input-available",
        toolCallId: "tc-1",
        toolName: "get_file",
        input: { path },
      },
      {
        type: "tool-output-available",
        toolCallId: "tc-1",
        output: { path, content: "# Limits" },
      },
      { type: "text-start", id: "message-1" },
      {
        type: "source-document",
        sourceId: path,
        mediaType: "text/x-markdown",
        title: "Curated product limits",
        filename: "limits.md",
      },
    ];
    const fallbackSource: Chunk = {
      type: "source-document",
      sourceId: path,
      mediaType: "text/markdown",
      title: path,
      filename: path,
    };
    const appendedChunks: Chunk[] = [];

    const outputChunks = await collectChunks(
      createHostedMirroredUiStream({
        sourceStream: streamChunks(sourceChunks),
        rootStreamWatchdog: {
          observe: () => undefined,
          dispose: () => undefined,
        },
        mirroredToolChunkState: createMirroredToolChunkState(),
        appendChunk: (chunk) => {
          appendedChunks.push(chunk);
        },
      }),
    );

    assertEquals(outputChunks, [
      sourceChunks[0],
      sourceChunks[1],
      fallbackSource,
      sourceChunks[2],
      sourceChunks[3],
    ]);
    assertEquals(appendedChunks, outputChunks);
  });

  it("derives one source document for direct streams with repeated knowledge reads", async () => {
    const path = "knowledge/product/limits.md";
    const sourceChunks: Chunk[] = [
      {
        type: "tool-input-available",
        toolCallId: "tc-1",
        toolName: "get_file",
        input: { path },
      },
      {
        type: "tool-output-available",
        toolCallId: "tc-1",
        output: { path, content: "# Limits" },
      },
      {
        type: "tool-input-available",
        toolCallId: "tc-2",
        toolName: "get_file",
        input: { path },
      },
      {
        type: "tool-output-available",
        toolCallId: "tc-2",
        output: { path, content: "# Limits" },
      },
    ];
    const appendedChunks: Chunk[] = [];

    const outputChunks = await collectChunks(
      createHostedMirroredUiStream({
        sourceStream: streamChunks(sourceChunks),
        rootStreamWatchdog: {
          observe: () => undefined,
          dispose: () => undefined,
        },
        mirroredToolChunkState: createMirroredToolChunkState(),
        appendChunk: (chunk) => {
          appendedChunks.push(chunk);
        },
      }),
    );
    const expectedSource: Chunk = {
      type: "source-document",
      sourceId: path,
      mediaType: "text/markdown",
      title: path,
      filename: path,
    };

    assertEquals(outputChunks, [
      sourceChunks[0],
      sourceChunks[1],
      expectedSource,
      sourceChunks[2],
      sourceChunks[3],
    ]);
    assertEquals(appendedChunks, outputChunks);
  });

  it("flushes a pending direct-stream source before propagating a stream error", async () => {
    const path = "knowledge/product/limits.md";
    const sourceChunks: Chunk[] = [
      {
        type: "tool-input-available",
        toolCallId: "tc-1",
        toolName: "get_file",
        input: { path },
      },
      {
        type: "tool-output-available",
        toolCallId: "tc-1",
        output: { path, content: "# Limits" },
      },
    ];
    const appendedChunks: Chunk[] = [];
    let didThrow = false;

    try {
      await collectChunks(
        createHostedMirroredUiStream({
          sourceStream: streamChunks(sourceChunks, new Error("provider stopped")),
          rootStreamWatchdog: {
            observe: () => undefined,
            dispose: () => undefined,
          },
          mirroredToolChunkState: createMirroredToolChunkState(),
          appendChunk: (chunk) => {
            appendedChunks.push(chunk);
          },
        }),
      );
    } catch (error) {
      didThrow = true;
      if (!(error instanceof Error)) {
        throw new Error("Expected source stream to throw an Error");
      }
      assertEquals(error.message, "provider stopped");
    }

    assertEquals(didThrow, true);
    assertEquals(appendedChunks, [
      ...sourceChunks,
      {
        type: "source-document",
        sourceId: path,
        mediaType: "text/markdown",
        title: path,
        filename: path,
      },
    ]);
  });

  it("closes open mirrored tool calls when the source stream aborts", async () => {
    const sourceChunks: Chunk[] = [
      { type: "tool-input-available", toolCallId: "tc-1", toolName: "edit_file", input: {} },
    ];
    const appendedChunks: Chunk[] = [];
    const errors: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
    let disposed = false;
    let didThrow = false;

    try {
      await collectChunks(
        createHostedMirroredUiStream({
          sourceStream: streamChunks(sourceChunks, new Error("provider stopped")),
          rootStreamWatchdog: {
            observe: () => undefined,
            dispose: () => {
              disposed = true;
            },
          },
          mirroredToolChunkState: createMirroredToolChunkState(),
          appendChunk: (chunk) => {
            appendedChunks.push(chunk);
          },
          logger: {
            warn: () => undefined,
            error: (message, metadata) => {
              errors.push({ message, metadata });
            },
          },
        }),
      );
    } catch (error) {
      didThrow = true;
      if (!(error instanceof Error)) {
        throw new Error("Expected source stream to throw an Error");
      }
      assertEquals(error.message, "provider stopped");
    }

    assertEquals(didThrow, true);
    assertEquals(appendedChunks, [
      ...sourceChunks,
      {
        type: "tool-output-error",
        toolCallId: "tc-1",
        errorText: "Chat stream errored before tool call completed: provider stopped",
      },
    ]);
    assertEquals(errors, []);
    assertEquals(disposed, true);
  });
});
