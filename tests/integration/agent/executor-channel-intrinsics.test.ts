import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createExecutorChannel,
  type ExecutorOperation,
  type ExecutorOperationContext,
} from "#veryfront/agent/executor/channel.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";

describe("private executor channel dispatch", () => {
  for (const hook of ["operation lookup", "text codecs", "byte copies", "transport reads"]) {
    it(`keeps request payloads out of replaced ${hook}`, async () => {
      const binding = { allocationId: "channel", invocationId: "channel", generation: 1 };
      const marker = "synthetic-private-channel-message";
      const forward = new TransformStream<Uint8Array, Uint8Array>();
      const backward = new TransformStream<Uint8Array, Uint8Array>();
      const caller = createExecutorChannel({
        binding,
        transport: { readable: backward.readable, writable: forward.writable },
      });
      const receiver = createExecutorChannel({
        binding,
        transport: { readable: forward.readable, writable: backward.writable },
        operations: new Map<string, ExecutorOperation>([["agent.stream", {
          mode: "stream",
          async *handle(input, context) {
            assertEquals(context.binding, binding);
            yield input;
          },
        }]]),
      });
      const originalSet = Uint8Array.prototype.set;
      const originalRead = ReadableStreamDefaultReader.prototype.read;
      const decoder = new TextDecoder();
      const originalGet = Map.prototype.get;
      const originalEncode = TextEncoder.prototype.encode;
      const originalDecode = TextDecoder.prototype.decode;
      let observations = 0;
      let received: JsonValue[] = [];
      try {
        await Promise.all([caller.ready, receiver.ready]);
        if (hook === "operation lookup") {
          Map.prototype.get = function (key) {
            const operation = Reflect.apply(originalGet, this, [key]);
            if (key === "agent.stream" && operation?.mode === "stream") {
              return {
                ...operation,
                handle(input: JsonValue, context: ExecutorOperationContext) {
                  observations++;
                  return Reflect.apply(operation.handle, operation, [input, context]);
                },
              };
            }
            return operation;
          };
        } else if (hook === "byte copies") {
          Uint8Array.prototype.set = function (source, offset) {
            if (
              source instanceof Uint8Array &&
              Reflect.apply(originalDecode, decoder, [source]).includes(marker)
            ) observations++;
            return Reflect.apply(originalSet, this, [source, offset]);
          };
        } else if (hook === "transport reads") {
          ReadableStreamDefaultReader.prototype.read = async function () {
            const result = await Reflect.apply(originalRead, this, []);
            if (
              result.value instanceof Uint8Array &&
              Reflect.apply(originalDecode, decoder, [result.value]).includes(marker)
            ) observations++;
            return result;
          };
        } else {
          TextEncoder.prototype.encode = function (text = "") {
            if (text.includes(marker)) observations++;
            return Reflect.apply(originalEncode, this, [text]);
          };
          TextDecoder.prototype.decode = function (input, options) {
            const text = Reflect.apply(originalDecode, this, [input, options]);
            if (text.includes(marker)) observations++;
            return text;
          };
        }
        received = await Array.fromAsync(caller.stream("agent.stream", { text: marker }));
        received.push(...await Array.fromAsync(caller.stream("agent.stream", { text: marker })));
      } finally {
        Uint8Array.prototype.set = originalSet;
        ReadableStreamDefaultReader.prototype.read = originalRead;
        Map.prototype.get = originalGet;
        TextEncoder.prototype.encode = originalEncode;
        TextDecoder.prototype.decode = originalDecode;
        caller.close();
        receiver.close();
        await Promise.all([caller.settled, receiver.settled]);
      }
      assertEquals(received, [{ text: marker }, { text: marker }]);
      assertEquals(observations, 0);
    });
  }
});
