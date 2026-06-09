/** Max size of a fetched cross-project module source, to bound memory use. */
export const MAX_CROSS_PROJECT_SOURCE_BYTES = 5 * 1024 * 1024; // 5MB

export class CrossProjectSourceTooLargeError extends Error {
  constructor(registryUrl: string, maxBytes = MAX_CROSS_PROJECT_SOURCE_BYTES) {
    super(`Cross-project source exceeds size limit: ${registryUrl} (${maxBytes} bytes)`);
    this.name = "CrossProjectSourceTooLargeError";
  }
}

export async function readLimitedCrossProjectSource(
  response: Response,
  registryUrl: string,
  maxBytes = MAX_CROSS_PROJECT_SOURCE_BYTES,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new CrossProjectSourceTooLargeError(registryUrl, maxBytes);
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new CrossProjectSourceTooLargeError(registryUrl, maxBytes);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new CrossProjectSourceTooLargeError(registryUrl, maxBytes);
      }

      chunks.push(decoder.decode(value, { stream: true }));
    }

    const tail = decoder.decode();
    if (tail.length > 0) chunks.push(tail);
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}
