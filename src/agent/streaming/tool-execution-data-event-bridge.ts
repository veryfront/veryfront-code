import type { ToolExecutionDataEvent } from "#veryfront/tool/types.ts";
import { AGENT_ERROR } from "#veryfront/errors";

/** Public API contract for tool execution data event publisher. */
export type ToolExecutionDataEventPublisher = (event: ToolExecutionDataEvent) => void;

/** Input payload for tool execution data event bridge stream. */
export type ToolExecutionDataEventBridgeStreamInput = {
  baseStream: ReadableStream<Uint8Array>;
  installPublisher: (publish: ToolExecutionDataEventPublisher) => void;
};

function serializeToolExecutionDataEvent(event: ToolExecutionDataEvent): Uint8Array {
  if (typeof event.name === "string" && event.name.length > 0) {
    const data = Object.hasOwn(event, "value") ? event.value : event.data;
    return new TextEncoder().encode(
      `data: ${JSON.stringify({ type: `data-${event.name}`, data })}\n\n`,
    );
  }

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

  throw AGENT_ERROR.create({ detail: "Agent runtime returned a non-binary stream chunk" });
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
      // Cancellation is best-effort teardown (the client disconnected / hit
      // Stop). Forwarding the cancel to the base reader can reject — e.g. the
      // upstream agent runtime aborts an in-flight signal whose rejection
      // surfaces through the cancel chain. Swallow it so it does not escape as
      // an unhandled rejection, which is fatal under Deno (#2334).
      try {
        await baseReader?.cancel(reason);
      } catch {
        // Stream is being torn down; a failed cancel is a clean stop here.
      }
    },
  });
}
