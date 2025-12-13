export async function streamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(decoder.decode(value, { stream: true }));
    }
  }

  // Flush any remaining bytes in the decoder
  const finalChunk = decoder.decode();
  if (finalChunk) {
    chunks.push(finalChunk);
  }

  return chunks.join("");
}
