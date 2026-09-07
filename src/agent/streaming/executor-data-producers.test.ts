import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockResult } from "../runtime/chat-stream-handler.test-helpers.ts";
import { createStreamState, processStream } from "../runtime/chat-stream-handler.ts";
import { createStreamLifecycleLiveAdapter } from "./lifecycle/live-adapter.ts";
import type { StreamSemanticEvent } from "./lifecycle/types.ts";
import { StreamEventEmitter } from "./stream-events.ts";
import { streamDataStreamEvents } from "./data-stream.ts";
import { readExecutorDataEvents } from "./executor-data-stream.ts";
import { createToolExecutionDataEventBridgeStream } from "./tool-execution-data-event-bridge.ts";

async function assertProducerStreamPreserved(stream: ReadableStream<Uint8Array>) {
  const [local, remote] = stream.tee();
  const [expected, actual] = await Promise.all([
    Array.fromAsync(streamDataStreamEvents(local)),
    Array.fromAsync(readExecutorDataEvents(remote, new AbortController().signal)),
  ]);
  assertEquals<unknown>(actual, expected);
  return actual;
}

describe("executor data compatibility with runtime producers", () => {
  it("preserves signed and redacted reasoning emitted by the existing stream handler", async () => {
    // Uses the signed-reasoning provider fixture from chat-stream-handler.test.ts
    // through the real producer, with the runtime's enclosing finish event.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emitter = new StreamEventEmitter(controller);
        emitter.emitStart("synthetic-message");
        await processStream(
          createMockResult([
            { type: "reasoning-start", id: "thinking-0" },
            { type: "reasoning-delta", id: "thinking-0", delta: "Check evidence." },
            {
              type: "reasoning-end",
              id: "thinking-0",
              signature: "synthetic-signature",
              redactedData: "synthetic-redacted-data",
            },
            { type: "finish", finishReason: "stop", totalUsage: null },
          ]),
          createStreamState(),
          controller,
          new TextEncoder(),
          "text-1",
        );
        emitter.emitFinish();
        controller.close();
      },
    });
    const events = await assertProducerStreamPreserved(stream);
    assert(
      events.some((event) =>
        event.type === "reasoning-end" && "signature" in event &&
        event.signature === "synthetic-signature" && "redactedData" in event &&
        event.redactedData === "synthetic-redacted-data"
      ),
    );
  });

  it("preserves every emitted live-lifecycle shape, including rejected and denied tools", async () => {
    const adapter = createStreamLifecycleLiveAdapter({ textPartId: "text-part" });
    // Mirrors the protocol-shape fixtures in lifecycle/live-adapter.test.ts.
    const semantic: StreamSemanticEvent[] = [
      { type: "text_start", id: "text:0" },
      { type: "text_content", id: "text:0", delta: "hello" },
      { type: "text_end", id: "text:0" },
      { type: "reasoning_start", id: "r1" },
      { type: "reasoning_content", id: "r1", delta: "thinking" },
      {
        type: "reasoning_end",
        id: "r1",
        signature: "synthetic-signature",
        redactedData: "synthetic-redacted-data",
      },
      { type: "tool_input_start", toolCallId: "local-1", toolName: "create_file", dynamic: true },
      { type: "tool_input_content", toolCallId: "local-1", delta: '{"path":"a.md"}' },
      {
        type: "tool_input_ready",
        toolCallId: "local-1",
        toolName: "create_file",
        input: { path: "a.md" },
      },
      {
        type: "tool_input_rejected",
        toolCallId: "local-2",
        toolName: "create_file",
        reason: "malformed",
      },
      {
        type: "provider_tool_result",
        toolCallId: "native-1",
        toolName: "web_search",
        output: { ok: true },
        isError: false,
        providerExecuted: true,
        dynamic: true,
        preliminary: false,
      },
      {
        type: "provider_tool_result",
        toolCallId: "native-2",
        toolName: "web_search",
        output: { error: "Synthetic tool error" },
        isError: true,
        providerExecuted: true,
        dynamic: true,
      },
      {
        type: "provider_tool_denied",
        toolCallId: "native-3",
        toolName: "web_search",
        providerExecuted: true,
      },
      {
        type: "provider_tool_cancelled",
        toolCallId: "native-4",
        toolName: "web_search",
        providerExecuted: true,
      },
      { type: "custom", name: "synthetic", data: { progress: 1 } },
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emitter = new StreamEventEmitter(controller);
        for (const [sequence, event] of semantic.entries()) {
          for (
            const output of adapter.encode({
              class: "semantic",
              sequence,
              elapsedMs: sequence,
              event,
            })
          ) emitter.emit(output);
        }
        for (
          const output of adapter.encode({
            class: "telemetry",
            sequence: semantic.length,
            elapsedMs: semantic.length,
            event: { type: "tool_input_status", toolCallId: "local-1", status: "pending_input" },
          })
        ) emitter.emit(output);
        emitter.emitFinish();
        controller.close();
      },
    });
    const events = await assertProducerStreamPreserved(stream);
    assert(events.some((event) => event.type === "tool-input-error"));
    assert(events.some((event) => event.type === "tool-output-denied"));
    assert(events.some((event) => event.type === "data-tool-call-status"));
  });

  it("preserves emitter tool-input errors and optional tool/custom payloads", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emitter = new StreamEventEmitter(controller);
        emitter.emitStart("synthetic-message");
        emitter.emitStepStart();
        emitter.emitTextStart("text");
        emitter.emitTextDelta("text", "hello");
        emitter.emitTextEnd("text");
        emitter.emitToolInputStart("call-1", "read_file", true);
        emitter.emitToolInputDelta("call-1", "{");
        emitter.emitToolInputError("call-1", "Synthetic incomplete input", true);
        emitter.emitToolInputAvailable("call-2", "read_file", {}, true);
        emitter.emitToolOutputAvailable("call-2", undefined, true);
        emitter.emitToolOutputError("call-3", "Synthetic tool error", true);
        emitter.emitStepEnd();
        emitter.emitFinish();
        controller.close();
      },
    });
    const bridged = createToolExecutionDataEventBridgeStream({
      baseStream: stream,
      installPublisher(publish) {
        publish({ type: "progress", name: "tool-progress", value: { progress: 1 } });
        publish({ type: "progress", name: "tool-pending" });
        publish({ type: "progress", data: { progress: 2 } });
      },
    });
    const events = await assertProducerStreamPreserved(bridged);
    assert(events.some((event) => event.type === "tool-input-error" && !("toolName" in event)));
    assert(events.some((event) => event.type === "tool-output-available" && !("output" in event)));
    assert(events.some((event) => event.type === "data-tool-pending" && !("data" in event)));
  });
});
