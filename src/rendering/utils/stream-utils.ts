/**
 * Stream Utilities
 * Pure utility functions for working with ReadableStreams
 */

/**
 * Convert a ReadableStream to a string by reading all chunks
 *
 * @param stream - The ReadableStream to convert
 * @returns A promise that resolves to the complete string content
 *
 * @example
 * ```ts
 * const stream = new ReadableStream({
 *   start(controller) {
 *     controller.enqueue(new TextEncoder().encode("Hello "));
 *     controller.enqueue(new TextEncoder().encode("World"));
 *     controller.close();
 *   }
 * });
 * const result = await streamToString(stream);
 * console.log(result); // "Hello World"
 * ```
 */
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

  return chunks.join("");
}
