import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ConversationRunEventEncoder,
  conversationRunEventTypes,
  encodeConversationRunEvents,
  normalizeEncodedConversationRunEvents,
} from "./run-events.ts";
import { MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES } from "./run-event-normalization.ts";

describe("agent/conversation-run-events", () => {
  it("captures active message ids from start events", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(encoder.encode({ type: "start", messageId: "msg-1" }), []);
    assertEquals(
      encoder.encode({ type: "tool-output-available", toolCallId: "tc-1", output: "ok" }),
      [{
        type: conversationRunEventTypes.toolCallResult,
        messageId: "msg-1:tool:tc-1",
        toolCallId: "tc-1",
        content: "ok",
        role: "tool",
      }],
    );
  });

  it("encodes text and reasoning events", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(
      encoder.encode({ type: "text-start", id: "msg-1" })[0]?.type,
      conversationRunEventTypes.textMessageStart,
    );
    assertEquals(
      encoder.encode({ type: "text-delta", id: "msg-1", delta: "hello" })[0]?.delta,
      "hello",
    );
    assertEquals(
      encoder.encode({ type: "reasoning-start", id: "r-1" })[0]?.type,
      conversationRunEventTypes.reasoningMessageStart,
    );
    assertEquals(
      encoder.encode({ type: "reasoning-delta", id: "r-1", delta: "think" })[0]?.type,
      conversationRunEventTypes.reasoningMessageContent,
    );
  });

  it("encodes model step lifecycle events for durable replay", () => {
    const encoder = new ConversationRunEventEncoder();

    assertEquals(encoder.encode({ type: "start-step" }), [{
      type: conversationRunEventTypes.stepStarted,
      stepName: "step-1",
    }]);
    assertEquals(encoder.encode({ type: "finish-step" }), [{
      type: conversationRunEventTypes.stepFinished,
      stepName: "step-1",
    }]);
    assertEquals(encoder.encode({ type: "start-step" }), [{
      type: conversationRunEventTypes.stepStarted,
      stepName: "step-2",
    }]);
    assertEquals(encoder.encode({ type: "finish-step" }), [{
      type: conversationRunEventTypes.stepFinished,
      stepName: "step-2",
    }]);
  });

  it("encodes text block ids as content ids when a durable message id is active", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(encoder.encode({ type: "start", messageId: "assistant-1" }), []);
    assertEquals(encoder.encode({ type: "text-start", id: "block-1" }), [{
      type: conversationRunEventTypes.textMessageStart,
      messageId: "assistant-1",
      contentId: "block-1",
      role: "assistant",
    }]);
    assertEquals(encoder.encode({ type: "text-delta", id: "block-1", delta: "hello" }), [{
      type: conversationRunEventTypes.textMessageContent,
      messageId: "assistant-1",
      contentId: "block-1",
      delta: "hello",
    }]);
    assertEquals(encoder.encode({ type: "text-end", id: "block-1" }), [{
      type: conversationRunEventTypes.textMessageEnd,
      messageId: "assistant-1",
      contentId: "block-1",
    }]);
  });

  it("encodes tool input availability with args when not previously streamed", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(
      encoder.encode({
        type: "tool-input-available",
        toolCallId: "tc-1",
        toolName: "bash",
        input: { command: "ls" },
      }),
      [
        {
          type: conversationRunEventTypes.toolCallArgs,
          toolCallId: "tc-1",
          delta: '{"command":"ls"}',
        },
        { type: conversationRunEventTypes.toolCallEnd, toolCallId: "tc-1" },
      ],
    );
  });

  it("skips repeated args when input was already streamed", () => {
    const encoder = new ConversationRunEventEncoder();
    encoder.encode({ type: "tool-input-delta", toolCallId: "tc-1", inputTextDelta: '{"cmd"' });
    assertEquals(
      encoder.encode({
        type: "tool-input-available",
        toolCallId: "tc-1",
        toolName: "bash",
        input: { command: "ls" },
      }),
      [{ type: conversationRunEventTypes.toolCallEnd, toolCallId: "tc-1" }],
    );
  });

  it("encodes tool errors and denial as tool results", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(
      encoder.encode({ type: "tool-output-error", toolCallId: "tc-1", errorText: "fail" })[0]
        ?.isError,
      true,
    );
    assertEquals(
      encoder.encode({ type: "tool-output-denied", toolCallId: "tc-1" })[0]?.content,
      "Tool output denied",
    );
  });

  it("encodes data-* chunks as custom events", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(
      encoder.encode({
        type: "data-tool-call-status",
        data: { toolCallId: "tc-1", status: "pending_input" },
      }),
      [
        {
          type: conversationRunEventTypes.custom,
          name: "tool-call-status",
          value: { toolCallId: "tc-1", status: "pending_input" },
        },
      ],
    );
  });

  it("encodes source documents as durable custom events", () => {
    const encoder = new ConversationRunEventEncoder();
    const path = "knowledge/knowledge-ingest-20260723131451088-source.md";

    assertEquals(
      encoder.encode({
        type: "source-document",
        sourceId: path,
        mediaType: "text/markdown",
        title: path,
        filename: path,
      }),
      [{
        type: conversationRunEventTypes.custom,
        name: "source-document",
        value: {
          type: "source-document",
          sourceId: path,
          mediaType: "text/markdown",
          title: path,
          filename: path,
        },
      }],
    );
  });

  it("encodes source URLs as durable custom events", () => {
    const encoder = new ConversationRunEventEncoder();
    const sourceUrl = {
      type: "source-url" as const,
      sourceId: "web-1",
      url: "https://example.com/reference",
      title: "Reference",
    };

    assertEquals(encoder.encode(sourceUrl), [{
      type: conversationRunEventTypes.custom,
      name: "source-url",
      value: sourceUrl,
    }]);
  });

  it("encodes files as durable custom events", () => {
    const encoder = new ConversationRunEventEncoder();
    const file = {
      type: "file" as const,
      url: "https://cdn.example.com/report.pdf",
      mediaType: "application/pdf",
      filename: "report.pdf",
    };

    assertEquals(encoder.encode(file), [{
      type: conversationRunEventTypes.custom,
      name: "file",
      value: file,
    }]);
  });

  it("gives an unresolved provider-executed tool call a durable terminal result", () => {
    // The reported incident read as TOOL_CALL_START + TOOL_CALL_END with no
    // TOOL_CALL_RESULT in the persisted run-event log, so the runs panel showed
    // a tool call that never finished.
    //
    // The stream handler synthesizes a terminal `tool-output-error` chunk for a
    // provider-executed call the provider never resolved. Chat-stream-handler
    // tests cover that it is emitted. This covers the other half of the chain:
    // that chunk must encode to a TOOL_CALL_RESULT, because the durable lane the
    // runs panel reads is fed by teeing these chunks into the run mirror. Change
    // this mapping and the live SSE card recovers while the runs panel silently
    // regresses to the original signature.
    const encoder = new ConversationRunEventEncoder();
    const toolCallId = "srvtoolu_provider_fetch";

    const types = [
      { type: "tool-input-start", toolCallId, toolName: "web_fetch", providerExecuted: true },
      { type: "tool-input-delta", toolCallId, inputTextDelta: '{"url":"https://example.com"}' },
      {
        type: "tool-input-available",
        toolCallId,
        toolName: "web_fetch",
        input: { url: "https://example.com" },
        providerExecuted: true,
      },
      {
        type: "tool-output-error",
        toolCallId,
        errorText:
          'Provider-executed tool "web_fetch" returned no result before the model turn ended.',
        providerExecuted: true,
      },
    ].flatMap((chunk) => encoder.encode(chunk as never)).map((event) => event.type);

    assertEquals(types, [
      conversationRunEventTypes.toolCallStart,
      conversationRunEventTypes.toolCallArgs,
      conversationRunEventTypes.toolCallEnd,
      conversationRunEventTypes.toolCallResult,
    ]);
  });

  it("persists one real terminal result for each parallel provider fetch", () => {
    const encoder = new ConversationRunEventEncoder();
    const calls = [
      ["fetch-skill", "https://docs.example/create-skill.md"],
      ["fetch-agent", "https://docs.example/create-agent.md"],
      ["fetch-schedule", "https://docs.example/schedule-agent.md"],
    ] as const;
    const durable = calls.flatMap(([toolCallId, url]) =>
      [
        { type: "tool-input-start", toolCallId, toolName: "web_fetch", providerExecuted: true },
        {
          type: "tool-input-available",
          toolCallId,
          toolName: "web_fetch",
          input: { url },
          providerExecuted: true,
        },
      ].flatMap((event) => encoder.encode(event as never))
    );

    durable.push(...encoder.encode({
      type: "tool-output-available",
      toolCallId: calls[0][0],
      output: { type: "web_fetch_result", url: calls[0][1], partial: true },
      providerExecuted: true,
      preliminary: true,
    }));
    for (const [toolCallId, url] of [...calls].reverse()) {
      durable.push(...encoder.encode({
        type: "tool-output-available",
        toolCallId,
        output: { type: "web_fetch_result", url, content: `content:${toolCallId}` },
        providerExecuted: true,
      }));
    }

    const starts = durable.filter((event) =>
      event.type === conversationRunEventTypes.toolCallStart
    );
    const results = durable.filter((event) =>
      event.type === conversationRunEventTypes.toolCallResult
    );
    assertEquals(starts.length, 3);
    assertEquals(results.length, 3);
    for (const [toolCallId, url] of calls) {
      const matching = results.filter((event) => event.toolCallId === toolCallId);
      assertEquals(matching.length, 1);
      assertEquals(
        matching[0]?.content,
        JSON.stringify({
          type: "web_fetch_result",
          url,
          content: `content:${toolCallId}`,
        }),
      );
    }
  });

  it("encodes and normalizes whole event lists", () => {
    const events = [
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "x".repeat(300 * 1024) },
    ] as const;

    const encoded = encodeConversationRunEvents(events as never);
    assertEquals(encoded[0]?.type, conversationRunEventTypes.textMessageStart);
    const normalized = normalizeEncodedConversationRunEvents(events as never);
    assertEquals(normalized.length > encoded.length, true);
  });

  // These records are what lands in `agent_run_event`. Its `created_at` is the
  // row's insert time, so without a stamp taken here nothing downstream can say
  // when an event actually happened, and durations describe the writer instead
  // of the run.
  it("stamps elapsedMs from the run's own clock when one is supplied", () => {
    let now = 5_000;
    const encoder = new ConversationRunEventEncoder({ nowMs: () => now });
    encoder.encode({ type: "start", messageId: "msg-clock" });

    now = 5_400;
    const first = encoder.encode({ type: "text-delta", id: "text:0", delta: "hi" });

    now = 12_000;
    const later = encoder.encode({ type: "text-end", id: "text:0" });

    assertEquals(first[0]?.elapsedMs, 400, "elapsed is relative to encoder creation");
    assertEquals(later[0]?.elapsedMs, 7000, "a later event carries a later elapsed");
  });

  it("preserves valid supplied timing and rejects invalid present timing", () => {
    const encoder = new ConversationRunEventEncoder({
      nowMs: () => Number.NaN,
      epochMs: () => -1,
      startedMs: 0,
    });
    const supplied = encoder.stamp([{
      type: conversationRunEventTypes.custom,
      elapsedMs: 12.5,
      emittedAt: 1_786_866_357_364,
    }]);
    assertEquals(supplied[0]?.elapsedMs, 12.5);
    assertEquals(supplied[0]?.emittedAt, 1_786_866_357_364);

    assertThrows(
      () =>
        encoder.stamp([{
          type: conversationRunEventTypes.custom,
          elapsedMs: -1,
          emittedAt: 1_786_866_357_364,
        }]),
      TypeError,
      "elapsedMs must be a finite non-negative number",
    );
    assertThrows(
      () =>
        encoder.stamp([{
          type: conversationRunEventTypes.custom,
          elapsedMs: 0,
          emittedAt: 1.5,
        }]),
      TypeError,
      "emittedAt must be a non-negative integer",
    );
  });

  it("rejects timing generated by invalid clocks", () => {
    const invalidElapsed = new ConversationRunEventEncoder({
      nowMs: () => Number.NaN,
      startedMs: 0,
    });
    assertThrows(
      () => invalidElapsed.encode({ type: "text-delta", id: "text:0", delta: "hi" }),
      TypeError,
      "elapsedMs must be a finite non-negative number",
    );

    const invalidEpoch = new ConversationRunEventEncoder({ epochMs: () => -1 });
    assertThrows(
      () => invalidEpoch.encode({ type: "text-delta", id: "text:0", delta: "hi" }),
      TypeError,
      "emittedAt must be a non-negative integer",
    );
  });

  it("omits elapsedMs entirely when no clock is supplied", () => {
    const encoder = new ConversationRunEventEncoder();
    assertEquals(encoder.getTimingAnchor(), undefined, "legacy unclocked encoders stay unclocked");
    encoder.encode({ type: "start", messageId: "msg-no-clock" });
    const encoded = encoder.encode({ type: "text-delta", id: "text:0", delta: "hi" });

    assertEquals(
      Object.hasOwn(encoded[0] ?? {}, "elapsedMs"),
      false,
      "an unclocked encoder must emit exactly what it emitted before",
    );
  });

  // Normalization splits oversized events and rewrites others. A stamp that does
  // not survive it never reaches the API, which is the gap that made the first
  // attempt at this change inert.
  it("carries elapsedMs through normalization onto every split part", () => {
    let now = 0;
    const encoder = new ConversationRunEventEncoder({ nowMs: () => now });
    now = 250;
    const events = [
      { type: "start", messageId: "msg-normalized" },
      { type: "text-start", id: "text:0" },
      {
        type: "text-delta",
        id: "text:0",
        delta: "x".repeat(MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES + 4096),
      },
    ];
    const normalized = normalizeEncodedConversationRunEvents(events as never, encoder);

    const contentParts = normalized.filter(
      (event) => event.type === conversationRunEventTypes.textMessageContent,
    );
    assertEquals(contentParts.length > 1, true, "the oversized delta should split");
    assertEquals(
      contentParts.every((event) => event.elapsedMs === 250),
      true,
      "every split part keeps the elapsed of the event it came from",
    );
  });
});
