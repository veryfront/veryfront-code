/** Read a response body without buffering more than the caller's byte limit. */
const INITIAL_BUFFER_BYTES = 64 * 1024;
const MAX_RESPONSE_BODY_CHUNKS = 65_536;

export async function readResponseTextWithinLimit(
  response: Response,
  maxBytes: number,
  createLimitError: () => Error,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("Response byte limit must be a positive safe integer");
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = /^\d+$/.test(contentLength) ? Number(contentLength) : Number.NaN;
    if (Number.isSafeInteger(declaredBytes) && declaredBytes > maxBytes) {
      await cancelBody(response.body);
      throw createLimitError();
    }
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  let buffer = new Uint8Array(Math.min(INITIAL_BUFFER_BYTES, maxBytes));
  let totalBytes = 0;
  let chunkCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunkCount++;
      if (chunkCount > MAX_RESPONSE_BODY_CHUNKS) {
        await cancelReader(reader);
        throw new TypeError("Response body chunk count exceeds the limit");
      }

      const nextTotalBytes = totalBytes + value.byteLength;
      if (nextTotalBytes > maxBytes) {
        await cancelReader(reader);
        throw createLimitError();
      }

      if (nextTotalBytes > buffer.byteLength) {
        buffer = growBuffer(buffer, nextTotalBytes, maxBytes);
      }
      buffer.set(value, totalBytes);
      totalBytes = nextTotalBytes;
    }
    return new TextDecoder().decode(buffer.subarray(0, totalBytes));
  } finally {
    reader.releaseLock();
  }
}

function growBuffer(
  current: Uint8Array<ArrayBufferLike>,
  requiredBytes: number,
  maxBytes: number,
): Uint8Array<ArrayBuffer> {
  let nextBytes = Math.max(1, current.byteLength);
  while (nextBytes < requiredBytes) {
    nextBytes = Math.min(maxBytes, Math.max(requiredBytes, nextBytes * 2));
  }
  const next = new Uint8Array(nextBytes);
  next.set(current);
  return next;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Preserve the deterministic resource-limit error if cancellation fails.
  }
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;
  try {
    await body.cancel();
  } catch {
    // Preserve the deterministic size-limit error if cancellation fails.
  }
}
