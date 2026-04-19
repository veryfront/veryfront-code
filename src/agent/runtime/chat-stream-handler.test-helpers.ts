/**
 * Helper: collect SSE events from a ReadableStream controller.
 * Returns an array of parsed JSON events.
 */
export function createSSECollector() {
  const events: Record<string, unknown>[] = [];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const controller = {
    enqueue(chunk: Uint8Array) {
      const text = decoder.decode(chunk);
      const lines = text.split("\n").filter((line) => line.startsWith("data: "));
      for (const line of lines) {
        events.push(JSON.parse(line.slice(6)));
      }
    },
  } as unknown as ReadableStreamDefaultController;
  return { events, controller, encoder };
}

/**
 * Helper: create a mock StreamTextResult with a fullStream from chunks.
 */
export function createMockResult(
  chunks: Record<string, unknown>[],
) {
  const fullStream = {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
  const textStream = {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        if (chunk.type === "text-delta" && typeof chunk.text === "string") {
          yield chunk.text;
        }
      }
    },
  };
  return { fullStream, textStream };
}
