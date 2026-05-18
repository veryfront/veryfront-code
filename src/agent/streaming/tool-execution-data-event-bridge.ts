import type { ToolExecutionDataEvent } from "#veryfront/tool/types.ts";

/** Public API contract for tool execution data event publisher. */
export type ToolExecutionDataEventPublisher = (event: ToolExecutionDataEvent) => void;

/** Input payload for tool execution data event bridge stream. */
export type ToolExecutionDataEventBridgeStreamInput = {
  baseStream: ReadableStream<Uint8Array>;
  installPublisher: (publish: ToolExecutionDataEventPublisher) => void;
};

function serializeToolExecutionDataEvent(event: ToolExecutionDataEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify({ type: "data", data: event })}\n\n`);
}

function toUint8ArrayChunk(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  throw new Error("Agent runtime returned a non-binary stream chunk");
}

/** Create tool execution data event bridge stream. */
export function createToolExecutionDataEventBridgeStream(
  input: ToolExecutionDataEventBridgeStreamInput,
): ReadableStream<Uint8Array> {
  let baseReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      input.installPublisher((event) => {
        if (closed) {
          return;
        }

        controller.enqueue(serializeToolExecutionDataEvent(event));
      });

      const reader = input.baseStream.getReader();
      baseReader = reader;

      void (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            controller.enqueue(toUint8ArrayChunk(value));
          }

          closed = true;
          controller.close();
        } catch (error) {
          closed = true;
          controller.error(error);
        } finally {
          input.installPublisher(() => {});
          reader.releaseLock();
          if (baseReader === reader) {
            baseReader = null;
          }
        }
      })();
    },
    async cancel(reason) {
      await baseReader?.cancel(reason);
    },
  });
}
