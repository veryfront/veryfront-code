import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { executorAgentJson } from "#veryfront/agent/hosted/executor-agent-schema.ts";
import { readExecutorDataEvents } from "#veryfront/agent/streaming/executor-data-stream.ts";
import { createToolExecutionDataEventBridgeStream } from "#veryfront/agent/streaming/tool-execution-data-event-bridge.ts";
import { StreamEventEmitter } from "#veryfront/agent/streaming/stream-events.ts";

describe("executor serialization intrinsics", () => {
  for (const hook of ["JSON", "text encoding", "text decoding", "SSE mapping", "byte validation"]) {
    it(`keeps synthetic requests and model events out of replaced ${hook} methods`, async () => {
      const marker = "synthetic-private-json-marker";
      const request = { messages: [{ text: marker }] };
      const originalParse = JSON.parse;
      const originalStringify = JSON.stringify;
      const originalEncode = TextEncoder.prototype.encode;
      const originalDecode = TextDecoder.prototype.decode;
      const originalMap = Array.prototype.map;
      const originalIsView = ArrayBuffer.isView;
      const OriginalUint8Array = Uint8Array;
      const hasInstance = Function.prototype[Symbol.hasInstance];
      const decoder = new TextDecoder();
      let observations = 0;
      let snapshot: unknown;
      const received: unknown[] = [];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const emitter = new StreamEventEmitter(controller);
          queueMicrotask(() => {
            emitter.emitTextDelta("text-1", marker);
            emitter.emitFinish();
            controller.close();
          });
        },
      });
      try {
        if (hook === "JSON") {
          JSON.stringify = ((value: unknown) => {
            const encoded = originalStringify(value);
            if (encoded?.includes(marker)) observations++;
            return encoded;
          }) as typeof JSON.stringify;
          JSON.parse = ((text: string) => {
            if (text.includes(marker)) observations++;
            return originalParse(text);
          }) as typeof JSON.parse;
        } else if (hook === "text encoding") {
          TextEncoder.prototype.encode = function (text = "") {
            if (text.includes(marker)) observations++;
            return Reflect.apply(originalEncode, this, [text]);
          };
        } else if (hook === "text decoding") {
          TextDecoder.prototype.decode = function (input, options) {
            const text = Reflect.apply(originalDecode, this, [input, options]);
            if (text.includes(marker)) observations++;
            return text;
          };
        } else if (hook === "SSE mapping") {
          Array.prototype.map = function (callback, thisArg) {
            for (let index = 0; index < this.length; index++) {
              if (typeof this[index] === "string" && this[index].includes(marker)) observations++;
            }
            return Reflect.apply(originalMap, this, [callback, thisArg]);
          };
        } else {
          const observe = (value: unknown) => {
            if (
              originalIsView(value) &&
              Reflect.apply(originalDecode, decoder, [value]).includes(marker)
            ) {
              observations++;
            }
          };
          ArrayBuffer.isView = (value: unknown): value is ArrayBufferView => {
            observe(value);
            return originalIsView(value);
          };
          globalThis.Uint8Array = class extends OriginalUint8Array {
            static override [Symbol.hasInstance](value: unknown): boolean {
              observe(value);
              return Reflect.apply(hasInstance, OriginalUint8Array, [value]);
            }
          } as Uint8ArrayConstructor;
        }
        snapshot = executorAgentJson(request, "EXECUTOR_AGENT_INPUT_TOO_LARGE");
        const bridged = createToolExecutionDataEventBridgeStream({
          baseStream: stream,
          installPublisher: () => {},
        });
        for await (const event of readExecutorDataEvents(bridged, new AbortController().signal)) {
          received.push(event);
        }
      } finally {
        JSON.stringify = originalStringify;
        JSON.parse = originalParse;
        TextEncoder.prototype.encode = originalEncode;
        TextDecoder.prototype.decode = originalDecode;
        Array.prototype.map = originalMap;
        ArrayBuffer.isView = originalIsView;
        globalThis.Uint8Array = OriginalUint8Array;
      }
      assertEquals(snapshot, request);
      assertEquals(received, [{ type: "text-delta", id: "text-1", delta: marker }, {
        type: "message-finish",
      }]);
      assertEquals(observations, 0);
    });
  }
});
