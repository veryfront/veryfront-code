import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  encodeExecutorFrame,
  EXECUTOR_MAX_FRAME_BYTES,
  EXECUTOR_MAX_RETAINED_BYTES,
} from "../executor/protocol.ts";
import {
  EXECUTOR_AGENT_MAX_PAYLOAD_BYTES,
  ExecutorAgentError,
  executorAgentJson,
} from "../hosted/executor-agent-schema.ts";
import { readExecutorDataEvents } from "./executor-data-stream.ts";

async function collect(stream: ReadableStream<Uint8Array>) {
  const output: JsonValue[] = [];
  for await (const event of readExecutorDataEvents(stream, new AbortController().signal)) {
    output.push(event);
  }
  return output;
}

describe("executor runtime data stream validation", () => {
  it("accepts an exact-limit event with its separator split across chunks", async () => {
    const prefix = 'data: {"type":"text-delta","delta":"';
    const suffix = '"}';
    const delta = "x".repeat(EXECUTOR_AGENT_MAX_PAYLOAD_BYTES - prefix.length - suffix.length);
    const body = new TextEncoder().encode(prefix + delta + suffix);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body);
        controller.enqueue(new Uint8Array([10]));
        controller.enqueue(new TextEncoder().encode('\ndata: {"type":"message-finish"}\n\n'));
        controller.close();
      },
    });
    assertEquals(await collect(stream), [{ type: "text-delta", delta }, {
      type: "message-finish",
    }]);
  });

  it("reassembles split UTF-8 and coalesced events without changing text", async () => {
    const events: JsonValue[] = [{ type: "text-delta", delta: "Synthetic å🙂\ntext" }, {
      type: "message-finish",
    }];
    const bytes = new TextEncoder().encode(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    );
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) controller.close();
        else controller.enqueue(bytes.subarray(offset, ++offset));
      },
    });
    assertEquals(await collect(stream), events);
  });

  it("reads a large event one byte at a time across buffer growth and UTF-8 boundaries", async () => {
    const events: JsonValue[] = [{ type: "text-delta", delta: "x".repeat(32_768) + "å🙂" }, {
      type: "message-finish",
    }];
    const bytes = new TextEncoder().encode(
      "\uFEFF" + events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    );
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) controller.close();
        else controller.enqueue(bytes.subarray(offset, ++offset));
      },
    });
    assertEquals(await collect(stream), events);
  });

  for (
    const bytes of [
      new Uint8Array([0xff]),
      new TextEncoder().encode(
        `data: ${JSON.stringify({ type: "message-finish", totalUsage: { inputTokens: -1 } })}\n\n`,
      ),
      new TextEncoder().encode(`data: ${JSON.stringify({ type: "unknown-event" })}\n\n`),
      new TextEncoder().encode(
        `data: ${
          JSON.stringify({ type: "reasoning-end", id: "r1", signature: { invalid: true } })
        }\n\n`,
      ),
      new TextEncoder().encode(
        `data: ${
          JSON.stringify({ type: "tool-input-error", toolCallId: "call-1", errorText: 42 })
        }\n\n`,
      ),
      new TextEncoder().encode(
        `data: ${
          JSON.stringify({
            type: "tool-output-denied",
            toolCallId: "call-1",
            authorization: "synthetic",
          })
        }\n\n`,
      ),
      new TextEncoder().encode(
        `data: ${
          JSON.stringify({
            type: "text-delta",
            delta: "x".repeat(EXECUTOR_AGENT_MAX_PAYLOAD_BYTES),
          })
        }\n\n`,
      ),
      new Uint8Array(EXECUTOR_MAX_RETAINED_BYTES + 1),
    ]
  ) {
    it("rejects invalid data and releases its reader", async () => {
      let cancelled = 0;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
        },
        cancel() {
          cancelled++;
        },
      });
      await assertRejects(() => collect(stream), ExecutorAgentError);
      assertEquals(cancelled, 1);
      assertEquals(stream.locked, false);
    });
  }

  it("keeps the advertised payload within a worst-case channel envelope", () => {
    const value = executorAgentJson(
      "x".repeat(EXECUTOR_AGENT_MAX_PAYLOAD_BYTES - 2),
      "EXECUTOR_AGENT_INPUT_TOO_LARGE",
    );
    const frame = encodeExecutorFrame({
      version: 1,
      binding: {
        allocationId: "\u0000".repeat(128),
        invocationId: "\u0000".repeat(128),
        generation: Number.MAX_SAFE_INTEGER,
      },
      sequence: Number.MAX_SAFE_INTEGER,
      message: {
        type: "request",
        id: Number.MAX_SAFE_INTEGER,
        operation: "agent.stream",
        mode: "stream",
        timeoutMs: 86_400_000,
        value,
      },
    });
    assert(frame.byteLength <= EXECUTOR_MAX_FRAME_BYTES);
  });

  it("preserves curated provider classifications without carrying raw diagnostic bodies", async () => {
    for (
      const code of [
        "RATE_LIMITED",
        "RESOURCE_LIMIT_EXCEEDED",
        "AI_PROVIDER_SPEND_LIMIT_EXCEEDED",
        "AI_PROVIDER_WORKSPACE_LIMIT_EXCEEDED",
        "AI_PROVIDER_BILLING_ERROR",
        "PROJECT_SCHEMA_ERROR",
        "MODEL_UNSUPPORTED_ASSISTANT_PREFILL",
        "OUTPUT_SCHEMA_NOT_CLOSED",
      ]
    ) {
      const output = await collect(
        new Response(
          `data: ${JSON.stringify({ type: "error", code, error: "synthetic-private-body" })}\n\n`,
        ).body!,
      );
      assertEquals(output, [{ type: "error", code, error: code }]);
    }
  });
});
