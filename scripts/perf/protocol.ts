/** Newline-delimited control messages between the synthetic client and server. */
export async function* readMessages(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
) {
  let buffer = "";
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const cancel = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        yield JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    if (buffer.trim()) {
      throw new Error("Incomplete performance control message");
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function encodeMessage(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value) + "\n");
}
