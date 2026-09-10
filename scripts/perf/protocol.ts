/** Newline-delimited control messages between the synthetic client and server. */
export async function* readMessages(stream: ReadableStream<Uint8Array>) {
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      yield JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  if (buffer.trim()) throw new Error("Incomplete performance control message");
}

export function encodeMessage(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value) + "\n");
}
