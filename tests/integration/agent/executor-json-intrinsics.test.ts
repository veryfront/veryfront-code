import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { executorAgentJson } from "#veryfront/agent/hosted/executor-agent-schema.ts";
import { readExecutorDataEvents } from "#veryfront/agent/streaming/executor-data-stream.ts";
import { createToolExecutionDataEventBridgeStream } from "#veryfront/agent/streaming/tool-execution-data-event-bridge.ts";
import { StreamEventEmitter } from "#veryfront/agent/streaming/stream-events.ts";

describe("executor serialization intrinsics", () => {
  it("keeps private text out of replaced encoder and decoder operations", async () => {
    const marker = "synthetic-private-codec-marker";
    const request = { messages: [{ text: marker }] };
    const NativeEncoder = TextEncoder;
    const NativeDecoder = TextDecoder;
    const encode = TextEncoder.prototype.encode;
    const decode = TextDecoder.prototype.decode;
    const apply = Reflect.apply;
    const construct = Reflect.construct;
    const payload = new NativeEncoder().encode(
      `data: {"type":"text-delta","delta":"${marker}"}\n\ndata: {"type":"message-finish"}\n\n`,
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });
    let exposures = 0;
    const events: unknown[] = [];
    let snapshot: unknown;
    try {
      globalThis.TextEncoder = new Proxy(NativeEncoder, {
        construct(target, args, newTarget) {
          exposures++;
          return construct(target, args, newTarget);
        },
      });
      globalThis.TextDecoder = new Proxy(NativeDecoder, {
        construct(target, args, newTarget) {
          exposures++;
          return construct(target, args, newTarget);
        },
      });
      NativeEncoder.prototype.encode = function (input) {
        if (input?.includes(marker)) exposures++;
        return apply(encode, this, [input]);
      };
      NativeDecoder.prototype.decode = function (...args) {
        const value = apply(decode, this, args) as string;
        if (value.includes(marker)) exposures++;
        return value;
      };
      snapshot = executorAgentJson(request, "EXECUTOR_AGENT_INPUT_TOO_LARGE");
      for await (const event of readExecutorDataEvents(stream, new AbortController().signal)) {
        events.push(event);
      }
    } finally {
      NativeEncoder.prototype.encode = encode;
      NativeDecoder.prototype.decode = decode;
      globalThis.TextEncoder = NativeEncoder;
      globalThis.TextDecoder = NativeDecoder;
    }
    assertEquals(snapshot, request);
    assertEquals(events, [{ type: "text-delta", delta: marker }, { type: "message-finish" }]);
    assertEquals(exposures, 0);
  });

  it("does not expose decoded SSE lines to a replaced array mapper", async () => {
    const marker = "synthetic-private-line-marker";
    const originalMap = Array.prototype.map;
    const apply = Reflect.apply;
    const body = new Response(
      `data: {\ndata: "type":"text-delta",\ndata: "delta":"${marker}"}\n\ndata: {"type":"message-finish"}\n\n`,
    ).body!;
    let exposures = 0;
    const events: unknown[] = [];
    try {
      Array.prototype.map = function (this: unknown[], ...args) {
        for (let index = 0; index < this.length; index++) {
          const line = this[index];
          if (typeof line === "string" && line.includes(marker)) exposures++;
        }
        return apply(originalMap, this, args);
      } as typeof originalMap;
      for await (const event of readExecutorDataEvents(body, new AbortController().signal)) {
        events.push(event);
      }
    } finally {
      Array.prototype.map = originalMap;
    }
    assertEquals(events, [{ type: "text-delta", delta: marker }, { type: "message-finish" }]);
    assertEquals(exposures, 0);
  });

  it("checks binary output without invoking replaced typed-array brands", async () => {
    const NativeBytes = Uint8Array;
    const isView = ArrayBuffer.isView;
    const hasInstance = Function.prototype[Symbol.hasInstance];
    const apply = Reflect.apply;
    const get = Reflect.get;
    const bytes = new NativeBytes([11, 22, 33]);
    const view = new DataView(bytes.buffer, 1, 2);
    const source = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue(bytes);
        controller.enqueue(view);
        controller.close();
      },
    }) as ReadableStream<Uint8Array>;
    let exposures = 0;
    let chunks: Uint8Array[] = [];
    try {
      globalThis.Uint8Array = new Proxy(NativeBytes, {
        get(target, key, receiver) {
          if (key === Symbol.hasInstance) {
            return (value: unknown) => {
              exposures++;
              return apply(hasInstance, target, [value]);
            };
          }
          return get(target, key, receiver);
        },
      });
      ArrayBuffer.isView = ((value: unknown) => {
        exposures++;
        return isView(value);
      }) as typeof isView;
      chunks = await Array.fromAsync(
        createToolExecutionDataEventBridgeStream({
          baseStream: source,
          installPublisher: () => {},
        }),
      );
    } finally {
      globalThis.Uint8Array = NativeBytes;
      ArrayBuffer.isView = isView;
    }
    assertEquals(chunks, [bytes, new NativeBytes([22, 33])]);
    assertEquals(exposures, 0);
  });

  for (
    const hook of [
      "JSON",
      "inherited toJSON",
      "text encoding",
      "text decoding",
      "SSE mapping",
      "byte validation",
    ]
  ) {
    it(`keeps synthetic requests and model events out of replaced ${hook} methods`, async () => {
      const marker = "synthetic-private-json-marker";
      const request = { messages: [{ text: marker }] };
      const originalToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
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
        } else if (hook === "inherited toJSON") {
          Object.defineProperty(Object.prototype, "toJSON", {
            configurable: true,
            value() {
              observations++;
              return this;
            },
          });
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
        if (originalToJson) Object.defineProperty(Object.prototype, "toJSON", originalToJson);
        else Reflect.deleteProperty(Object.prototype, "toJSON");
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
