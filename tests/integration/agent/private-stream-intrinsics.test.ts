import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createToolExecutionDataEventBridgeStream } from "#veryfront/agent/streaming/tool-execution-data-event-bridge.ts";
import "#veryfront/schemas/_test-setup.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";

describe("private stream intrinsics", () => {
  it("keeps raw turn messages out of a replaced array mapper", async () => {
    const marker = "synthetic-private-turn-marker";
    const originalMap = Array.prototype.map;
    const apply = Reflect.apply;
    const isArray = Array.isArray;
    let exposures = 0;
    const model = scriptedModel([{ text: "Synthetic answer" }]);
    const runtime = new AgentRuntime("private-messages", {
      model: "veryfront-cloud/openai/gpt-5.4",
      system: "Synthetic instructions",
    }, { resolveModelRuntime: () => model });
    try {
      Array.prototype.map = function (this: unknown[], ...args) {
        for (let index = 0; index < this.length; index++) {
          const message = this[index] as { parts?: unknown[] } | null;
          if (!message || !isArray(message.parts)) continue;
          for (let partIndex = 0; partIndex < message.parts.length; partIndex++) {
            if ((message.parts[partIndex] as { text?: unknown } | null)?.text === marker) {
              exposures++;
            }
          }
        }
        return apply(originalMap, this, args);
      } as typeof originalMap;
      await Array.fromAsync(
        await runtime.stream([{
          id: "synthetic-message",
          role: "user",
          parts: [{ type: "text", text: marker }],
        }]),
      );
    } finally {
      Array.prototype.map = originalMap;
    }
    assertEquals(model.calls.length, 1);
    assertEquals(exposures, 0);
  });

  it("reads and cancels private output without invoking replaced reader methods", async () => {
    const getReader = ReadableStream.prototype.getReader;
    const read = ReadableStreamDefaultReader.prototype.read;
    const cancel = ReadableStreamDefaultReader.prototype.cancel;
    const releaseLock = ReadableStreamDefaultReader.prototype.releaseLock;
    const cancelStream = ReadableStream.prototype.cancel;
    const apply = Reflect.apply;
    let exposures = 0;
    let cancellations = 0;
    let text = "";
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("Synthetic private output"));
      },
      cancel() {
        cancellations++;
      },
    });
    try {
      ReadableStream.prototype.getReader = function (this: ReadableStream<unknown>, ...args) {
        exposures++;
        return apply(getReader, this, args);
      } as typeof getReader;
      ReadableStreamDefaultReader.prototype.read = function () {
        exposures++;
        return apply(read, this, []);
      };
      ReadableStreamDefaultReader.prototype.cancel = function (reason) {
        exposures++;
        return apply(cancel, this, [reason]);
      };
      ReadableStreamDefaultReader.prototype.releaseLock = function () {
        exposures++;
        apply(releaseLock, this, []);
      };
      const output = createToolExecutionDataEventBridgeStream({
        baseStream: source,
        installPublisher: () => {},
      });
      const reader = apply(getReader, output, []);
      const chunk = await apply(read, reader, []);
      text = new TextDecoder().decode(chunk.value);
      apply(releaseLock, reader, []);
      await apply(cancelStream, output, []);
    } finally {
      ReadableStream.prototype.getReader = getReader;
      ReadableStreamDefaultReader.prototype.read = read;
      ReadableStreamDefaultReader.prototype.cancel = cancel;
      ReadableStreamDefaultReader.prototype.releaseLock = releaseLock;
    }
    assertEquals(text, "Synthetic private output");
    assertEquals(cancellations, 1);
    assertEquals(exposures, 0);
  });
});
