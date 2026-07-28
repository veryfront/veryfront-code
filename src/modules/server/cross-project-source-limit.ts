import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

/** Max size of a fetched cross-project module source, to bound memory use. */
export const MAX_CROSS_PROJECT_SOURCE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_CROSS_PROJECT_SOURCE_CHUNKS = 16_384;

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
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Cross-project source maxBytes must be a positive safe integer");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try {
      await response.body?.cancel();
    } catch {
      /* preserve the boundary error when cancellation itself fails */
    }
    throw new CrossProjectSourceTooLargeError(registryUrl, maxBytes);
  }

  if (!response.body) {
    const text = await response.text();
    if (utf8ByteLength(text, maxBytes) > maxBytes) {
      throw new CrossProjectSourceTooLargeError(registryUrl, maxBytes);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let totalBytes = 0;
  let chunkCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunkCount++;
      totalBytes += value.byteLength;
      if (
        chunkCount > MAX_CROSS_PROJECT_SOURCE_CHUNKS ||
        totalBytes > maxBytes
      ) {
        try {
          await reader.cancel();
        } catch {
          /* preserve the boundary error when cancellation itself fails */
        }
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
