import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessageChunk } from "../../chat/types.ts";
import {
  type ChatUiMessageStreamFinish,
  type ChatUiMessageStreamFinishPart,
  createChatUiMessageStreamFromDataStream,
} from "./chat-ui-message-stream.ts";
import { getRuntimeObservation } from "#veryfront/runtime/runtime-observation-carrier.ts";

const encoder = new TextEncoder();

function createSseStream(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

async function collectChunks(
  stream: AsyncIterable<ChatUiMessageChunk>,
): Promise<ChatUiMessageChunk[]> {
  const chunks: ChatUiMessageChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("createChatUiMessageStreamFromDataStream", () => {
  it("strips and rebinds trusted runtime observations to exact public chunks", async () => {
    const stepId = "11111111-1111-4111-8111-111111111111";
    const messageSpanId = "22222222-2222-4222-8222-222222222222";
    const occurrenceId = "33333333-3333-4333-8333-333333333333";
    let finish: unknown;
    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        {
          stream: createSseStream([
            { type: "message-start", messageId: "framework-message" },
            {
              type: "data-veryfront.runtime_context",
              data: { runStartedAtUtc: "2026-01-01T00:00:00.000Z" },
              privateRuntimeObservation: {
                version: 1,
                kind: "execution_entry",
                occurrenceId,
              },
            },
            {
              type: "step-start",
              privateRuntimeObservation: { version: 1, kind: "step_started", stepId },
            },
            {
              type: "text-delta",
              id: "text-1",
              delta: "hello",
              privateRuntimeObservation: {
                version: 1,
                kind: "step_message",
                stepId,
                messageSpanId,
              },
            },
            {
              type: "step-end",
              privateRuntimeObservation: { version: 1, kind: "step_ended", stepId },
            },
            { type: "message-finish" },
          ]),
        },
        {
          generateMessageId: () => "assistant-message",
          privateRuntimeObservations: true,
          onFinish(value) {
            finish = value;
          },
        },
      ),
    );

    const observations = chunks.map((chunk) => getRuntimeObservation(chunk)).filter((value) =>
      value !== undefined
    );
    assertEquals(observations.find((observation) => observation.kind === "execution_entry"), {
      version: 1,
      kind: "execution_entry",
      occurrenceId,
    });
    assertEquals(observations.find((observation) => observation.kind === "step_started"), {
      version: 1,
      kind: "step_started",
      stepId,
    });
    assertEquals(observations.find((observation) => observation.kind === "step_message"), {
      version: 1,
      kind: "step_message",
      stepId,
      messageSpanId,
    });
    assertEquals(observations.find((observation) => observation.kind === "step_ended"), {
      version: 1,
      kind: "step_ended",
      stepId,
    });
    assertEquals(JSON.stringify({ chunks, finish }).includes("privateRuntimeObservation"), false);
    assertEquals(JSON.stringify({ chunks, finish }).includes(messageSpanId), false);
  });

  it("ignores private runtime observations unless the trusted carrier option is enabled", async () => {
    const stepId = "11111111-1111-4111-8111-111111111111";
    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        {
          stream: createSseStream([
            {
              type: "step-start",
              privateRuntimeObservation: { version: 1, kind: "step_started", stepId },
            },
            { type: "message-finish" },
          ]),
        },
        { generateMessageId: () => "assistant-message" },
      ),
    );

    assertEquals(chunks.every((chunk) => getRuntimeObservation(chunk) === undefined), true);
    assertEquals(JSON.stringify(chunks).includes("privateRuntimeObservation"), false);
    assertEquals(JSON.stringify(chunks).includes(stepId), false);
  });

  it("rejects malformed trusted runtime observations instead of dropping provenance", async () => {
    const stepId = "11111111-1111-4111-8111-111111111111";
    const messageSpanId = "22222222-2222-4222-8222-222222222222";
    const cases: Array<{ name: string; event: Record<string, unknown>; message: string }> = [
      {
        name: "invalid version",
        event: {
          type: "step-start",
          privateRuntimeObservation: { version: 2, kind: "step_started", stepId },
        },
        message: "Invalid private runtime observation",
      },
      {
        name: "invalid UUID",
        event: {
          type: "step-start",
          privateRuntimeObservation: {
            version: 1,
            kind: "step_started",
            stepId: "not-a-uuid",
          },
        },
        message: "Invalid private runtime observation",
      },
      {
        name: "unknown field",
        event: {
          type: "step-start",
          privateRuntimeObservation: {
            version: 1,
            kind: "step_started",
            stepId,
            extra: true,
          },
        },
        message: "Invalid private runtime observation",
      },
      {
        name: "incompatible attachment",
        event: {
          type: "step-start",
          privateRuntimeObservation: {
            version: 1,
            kind: "step_message",
            stepId,
            messageSpanId,
          },
        },
        message: "Private runtime observation is attached to an incompatible event",
      },
    ];

    for (const entry of cases) {
      await assertRejects(
        () =>
          collectChunks(
            createChatUiMessageStreamFromDataStream(
              { stream: createSseStream([entry.event, { type: "message-finish" }]) },
              {
                generateMessageId: () => `assistant-message-${entry.name}`,
                privateRuntimeObservations: true,
              },
            ),
          ),
        TypeError,
        entry.message,
      );
    }
  });

  it("accepts trusted observations on valid raw events that emit no UI chunk", async () => {
    const stepId = "11111111-1111-4111-8111-111111111111";
    const messageSpanId = "22222222-2222-4222-8222-222222222222";
    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        {
          stream: createSseStream([
            {
              type: "reasoning-delta",
              id: "reasoning-1",
              delta: "hidden reasoning",
              privateRuntimeObservation: {
                version: 1,
                kind: "step_message",
                stepId,
                messageSpanId,
              },
            },
            {
              type: "text-delta",
              id: "text-1",
              delta: "",
              privateRuntimeObservation: {
                version: 1,
                kind: "step_message",
                stepId,
                messageSpanId,
              },
            },
            { type: "message-finish" },
          ]),
        },
        {
          generateMessageId: () => "assistant-message",
          privateRuntimeObservations: true,
          sendReasoning: false,
        },
      ),
    );

    assertEquals(chunks[0], { type: "start", messageId: "assistant-message" });
    assertEquals(JSON.stringify(chunks).includes("privateRuntimeObservation"), false);
    assertEquals(JSON.stringify(chunks).includes(messageSpanId), false);
  });

  it("rejects an incompatible trusted observation before yielding that raw event's chunks", async () => {
    const stream = createChatUiMessageStreamFromDataStream(
      {
        stream: createSseStream([
          {
            type: "step-start",
            privateRuntimeObservation: {
              version: 1,
              kind: "step_message",
              stepId: "11111111-1111-4111-8111-111111111111",
              messageSpanId: "22222222-2222-4222-8222-222222222222",
            },
          },
          { type: "message-finish" },
        ]),
      },
      {
        generateMessageId: () => "assistant-message",
        privateRuntimeObservations: true,
      },
    );
    const iterator = stream[Symbol.asyncIterator]();

    assertEquals(await iterator.next(), {
      done: false,
      value: { type: "start", messageId: "assistant-message" },
    });
    await assertRejects(
      () => iterator.next(),
      TypeError,
      "Private runtime observation is attached to an incompatible event",
    );
  });

  it("maps data stream events into UI chunks and finalizes a response message", async () => {
    let finish: ChatUiMessageStreamFinish<{ modelId: string }> | undefined;
    const stream = createSseStream([
      { type: "message-start", messageId: "framework-message" },
      { type: "step-start" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello from framework" },
      { type: "tool-input-start", toolCallId: "tool-1", toolName: "search_files" },
      { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"query":"' },
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "search_files",
        input: { query: "chat runtime" },
      },
      { type: "tool-output-available", toolCallId: "tool-1", output: { matches: 2 } },
      { type: "step-end" },
      { type: "text-end", id: "text-1" },
      { type: "message-finish" },
    ]);

    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        { stream },
        {
          generateMessageId: () => "assistant-message",
          messageMetadata: () => ({ modelId: "anthropic/claude" }),
          onFinish: (value) => {
            finish = value;
          },
        },
      ),
    );

    assertEquals(chunks, [
      { type: "start", messageId: "assistant-message" },
      { type: "start-step" },
      { type: "text-start", id: "assistant-message", contentId: "text-1" },
      {
        type: "text-delta",
        id: "assistant-message",
        contentId: "text-1",
        delta: "Hello from framework",
      },
      { type: "tool-input-start", toolCallId: "tool-1", toolName: "search_files" },
      { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"query":"' },
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "search_files",
        input: { query: "chat runtime" },
      },
      { type: "tool-output-available", toolCallId: "tool-1", output: { matches: 2 } },
      { type: "finish-step" },
      { type: "text-end", id: "assistant-message", contentId: "text-1" },
      { type: "finish", finishReason: "stop", messageMetadata: { modelId: "anthropic/claude" } },
    ]);

    assertEquals(finish, {
      messages: [
        {
          id: "assistant-message",
          role: "assistant",
          parts: [
            { type: "text", text: "Hello from framework" },
            {
              type: "dynamic-tool",
              toolName: "search_files",
              toolCallId: "tool-1",
              input: { query: "chat runtime" },
              state: "output-available",
              output: { matches: 2 },
            },
          ],
          metadata: { modelId: "anthropic/claude" },
        },
      ],
      isContinuation: false,
      responseMessage: {
        id: "assistant-message",
        role: "assistant",
        parts: [
          { type: "text", text: "Hello from framework" },
          {
            type: "dynamic-tool",
            toolName: "search_files",
            toolCallId: "tool-1",
            input: { query: "chat runtime" },
            state: "output-available",
            output: { matches: 2 },
          },
        ],
        metadata: { modelId: "anthropic/claude" },
      },
      isAborted: false,
      finishReason: "stop",
    });
  });

  it("persists one exact source document for repeated successful knowledge reads", async () => {
    const path = "knowledge/knowledge-ingest-exact.md";
    const output = { path, type: "file", content: "# Exact source" };
    let finish: ChatUiMessageStreamFinish | undefined;
    const stream = createSseStream([
      { type: "message-start", messageId: "framework-message" },
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "get_file",
        input: { path },
      },
      { type: "tool-output-available", toolCallId: "tool-1", output },
      {
        type: "tool-input-available",
        toolCallId: "tool-2",
        toolName: "get_file",
        input: { path },
      },
      { type: "tool-output-available", toolCallId: "tool-2", output },
      { type: "message-finish" },
    ]);

    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        { stream },
        {
          generateMessageId: () => "assistant-message",
          onFinish: (value) => {
            finish = value;
          },
        },
      ),
    );
    const expectedSource = {
      type: "source-document" as const,
      sourceId: path,
      mediaType: "text/markdown",
      title: path,
      filename: path,
    };

    assertEquals(
      chunks.filter((chunk) => chunk.type === "source-document"),
      [expectedSource],
    );
    assertEquals(
      finish?.responseMessage.parts.filter((part) => part.type === "source-document"),
      [expectedSource],
    );
  });

  it("replaces a derived source with richer upstream metadata", async () => {
    const path = "knowledge/product/limits.md";
    const fallbackSource = {
      type: "source-document" as const,
      sourceId: path,
      mediaType: "text/markdown",
      title: path,
      filename: path,
    };
    const upstreamSource = {
      type: "source-document" as const,
      sourceId: path,
      mediaType: "text/x-markdown",
      title: "Curated product limits",
      filename: "limits.md",
    };
    let finish: ChatUiMessageStreamFinish | undefined;
    const stream = createSseStream([
      { type: "message-start", messageId: "framework-message" },
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "get_file",
        input: { path },
      },
      {
        type: "tool-output-available",
        toolCallId: "tool-1",
        output: { path, type: "file", content: "# Limits" },
      },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "The annual limit is 300 KEUR." },
      { type: "text-end", id: "text-1" },
      {
        type: "data",
        data: {
          name: "source-document",
          value: upstreamSource,
        },
      },
      { type: "message-finish" },
    ]);

    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        { stream },
        {
          generateMessageId: () => "assistant-message",
          onFinish: (value) => {
            finish = value;
          },
        },
      ),
    );

    assertEquals(
      chunks.filter((chunk) => chunk.type === "source-document"),
      [fallbackSource, upstreamSource],
    );
    assertEquals(
      finish?.responseMessage.parts.filter((part) => part.type === "source-document"),
      [upstreamSource],
    );
  });

  it("persists ordered source urls once by source id in the final response message", async () => {
    let finish: ChatUiMessageStreamFinish | undefined;
    const stream = createSseStream([
      { type: "message-start", messageId: "framework-message" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Before source" },
      {
        type: "data",
        data: {
          name: "source-url",
          value: {
            type: "source-url",
            sourceId: "web-1",
            url: "https://example.com/first",
            title: "First reference",
          },
        },
      },
      {
        type: "data",
        data: {
          name: "source-url",
          value: {
            type: "source-url",
            sourceId: "web-1",
            url: "https://example.com/duplicate",
            title: "Duplicate reference",
          },
        },
      },
      { type: "text-start", id: "text-2" },
      { type: "text-delta", id: "text-2", delta: "After source" },
      {
        type: "data",
        data: {
          name: "source-url",
          value: {
            type: "source-url",
            sourceId: "web-2",
            url: "https://example.com/second",
            title: "Second reference",
          },
        },
      },
      { type: "message-finish" },
    ]);

    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        { stream },
        {
          generateMessageId: () => "assistant-message",
          onFinish: (value) => {
            finish = value;
          },
        },
      ),
    );
    const firstSource = {
      type: "source-url" as const,
      sourceId: "web-1",
      url: "https://example.com/first",
      title: "First reference",
    };
    const secondSource = {
      type: "source-url" as const,
      sourceId: "web-2",
      url: "https://example.com/second",
      title: "Second reference",
    };

    assertEquals(
      chunks.filter((chunk) => chunk.type === "source-url"),
      [firstSource, secondSource],
    );
    assertEquals(finish?.responseMessage.parts, [
      { type: "text", text: "Before source" },
      firstSource,
      { type: "text", text: "After source" },
      secondSource,
    ]);
  });

  it("preserves providerExecuted from data stream tool events into final dynamic tool parts", async () => {
    let finish: ChatUiMessageStreamFinish | undefined;
    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        {
          stream: createSseStream([
            { type: "message-start", messageId: "framework-message" },
            {
              type: "tool-input-start",
              toolCallId: "tool-provider-fetch",
              toolName: "web_fetch",
              providerExecuted: true,
            },
            {
              type: "tool-input-available",
              toolCallId: "tool-provider-fetch",
              toolName: "web_fetch",
              input: { url: "https://example.com/docs" },
              providerExecuted: true,
            },
            { type: "message-finish" },
          ]),
        },
        {
          generateMessageId: () => "assistant-message",
          onFinish: (value) => {
            finish = value;
          },
        },
      ),
    );

    assertEquals(chunks, [
      { type: "start", messageId: "assistant-message" },
      { type: "start-step" },
      {
        type: "tool-input-start",
        toolCallId: "tool-provider-fetch",
        toolName: "web_fetch",
        providerExecuted: true,
      },
      {
        type: "tool-input-available",
        toolCallId: "tool-provider-fetch",
        toolName: "web_fetch",
        input: { url: "https://example.com/docs" },
        providerExecuted: true,
      },
      { type: "finish", finishReason: "stop" },
    ]);
    assertEquals(finish?.responseMessage.parts, [
      {
        type: "dynamic-tool",
        toolName: "web_fetch",
        toolCallId: "tool-provider-fetch",
        input: { url: "https://example.com/docs" },
        providerExecuted: true,
        state: "input-available",
      },
    ]);
  });

  it("carries runtime finish usage into final message metadata", async () => {
    let finish:
      | ChatUiMessageStreamFinish<{
        modelId: string;
        usage: {
          inputTokens: number;
          outputTokens: number;
          cachedInputTokens?: number;
          cacheCreationInputTokens?: number;
          cacheCreation1hInputTokens?: number;
          cacheReadInputTokens?: number;
          reasoningTokens?: number;
        };
        costCredits?: number;
      }>
      | undefined;
    let observedFinishPart: ChatUiMessageStreamFinishPart | undefined;

    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        {
          stream: createSseStream([
            { type: "message-start", messageId: "framework-message" },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Hello" },
            { type: "text-end", id: "text-1" },
            {
              type: "message-finish",
              finishReason: "stop",
              totalUsage: {
                inputTokens: 123,
                outputTokens: 45,
                totalTokens: 170,
                inputTokenDetails: {
                  cacheReadTokens: 20,
                  cacheWriteTokens: 7,
                },
                cacheCreation1hInputTokens: 3,
                outputTokenDetails: {
                  reasoningTokens: 2,
                },
                costCredits: 0.098,
              },
            },
          ]),
        },
        {
          generateMessageId: () => "assistant-message",
          messageMetadata: ({ part }) => {
            observedFinishPart = part;
            return {
              modelId: "veryfront-cloud/moonshotai/kimi-k2.6",
              usage: {
                inputTokens: part.totalUsage.inputTokens,
                outputTokens: part.totalUsage.outputTokens,
                cachedInputTokens: part.totalUsage.inputTokenDetails.cacheReadTokens,
                cacheCreationInputTokens: part.totalUsage.inputTokenDetails.cacheWriteTokens,
                cacheCreation1hInputTokens: part.totalUsage.cacheCreation1hInputTokens,
                cacheReadInputTokens: part.totalUsage.inputTokenDetails.cacheReadTokens,
                reasoningTokens: part.totalUsage.outputTokenDetails.reasoningTokens,
              },
              costCredits: part.totalUsage.costCredits,
            };
          },
          onFinish: (value) => {
            finish = value;
          },
        },
      ),
    );

    const expectedMetadata = {
      modelId: "veryfront-cloud/moonshotai/kimi-k2.6",
      usage: {
        inputTokens: 123,
        outputTokens: 45,
        cachedInputTokens: 20,
        cacheCreationInputTokens: 7,
        cacheCreation1hInputTokens: 3,
        cacheReadInputTokens: 20,
        reasoningTokens: 2,
      },
      costCredits: 0.098,
    };

    assertEquals(observedFinishPart?.totalUsage, {
      inputTokens: 123,
      outputTokens: 45,
      totalTokens: 170,
      inputTokenDetails: {
        cacheReadTokens: 20,
        cacheWriteTokens: 7,
      },
      cacheCreation1hInputTokens: 3,
      outputTokenDetails: {
        reasoningTokens: 2,
      },
      costCredits: 0.098,
    });
    assertEquals(chunks.at(-1), {
      type: "finish",
      finishReason: "stop",
      messageMetadata: expectedMetadata,
    });
    assertEquals(finish?.responseMessage.metadata, expectedMetadata);
  });

  it("surfaces orphaned tool input deltas as tool input errors", async () => {
    const orphaned: Array<{ toolCallId: string; inputText: string }> = [];
    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        {
          stream: createSseStream([
            { type: "message-start", messageId: "framework-message" },
            { type: "step-start" },
            { type: "tool-input-delta", toolCallId: "tool-orphan", inputTextDelta: '{"path":"' },
            {
              type: "tool-input-delta",
              toolCallId: "tool-orphan",
              inputTextDelta: 'docs/research.md"',
            },
            { type: "message-finish" },
          ]),
        },
        {
          generateMessageId: () => "assistant-message",
          onOrphanedToolInput: (value) => orphaned.push(value),
        },
      ),
    );

    assertEquals(orphaned, [
      { toolCallId: "tool-orphan", inputText: '{"path":"docs/research.md"' },
    ]);
    assertEquals(chunks, [
      { type: "start", messageId: "assistant-message" },
      { type: "start-step" },
      {
        type: "tool-input-error",
        toolCallId: "tool-orphan",
        toolName: "unknown",
        input: { __rawInputText: '{"path":"docs/research.md"' },
        errorText:
          'Tool input started streaming before the tool lifecycle was established and never materialized into an executable tool call. Buffered args: {"path":"docs/research.md"',
      },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  it("includes data parts in the final response message", async () => {
    let finish: ChatUiMessageStreamFinish | undefined;
    const lifecycle = {
      action: "created",
      inputRequest: { id: "input-request-1", toolCallId: "tool-1" },
    };

    const chunks = await collectChunks(
      createChatUiMessageStreamFromDataStream(
        {
          stream: createSseStream([
            { type: "message-start", messageId: "framework-message" },
            { type: "data", data: { name: "veryfront.input_request.lifecycle", value: lifecycle } },
            { type: "message-finish" },
          ]),
        },
        {
          generateMessageId: () => "assistant-message",
          onFinish: (value) => {
            finish = value;
          },
        },
      ),
    );

    assertEquals(chunks, [
      { type: "start", messageId: "assistant-message" },
      { type: "data-veryfront.input_request.lifecycle", data: lifecycle },
      { type: "finish", finishReason: "stop" },
    ]);
    assertEquals(finish?.responseMessage.parts, [
      { type: "data-veryfront.input_request.lifecycle", data: lifecycle },
    ]);
  });
});
