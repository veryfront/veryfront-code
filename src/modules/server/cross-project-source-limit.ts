/** Max size of a fetched cross-project module source, to bound memory use. */
export const MAX_CROSS_PROJECT_SOURCE_BYTES = 5 * 1024 * 1024; // 5MB

export class CrossProjectSourceTooLargeError extends Error {
  constructor(_registryUrl: string, maxBytes = MAX_CROSS_PROJECT_SOURCE_BYTES) {
    super(`Cross-project source exceeds size limit (${maxBytes} bytes)`);
    this.name = "CrossProjectSourceTooLargeError";
  }
}

export class CrossProjectSourceEncodingError extends Error {
  constructor() {
    super("Cross-project source must contain valid UTF-8");
    this.name = "CrossProjectSourceEncodingError";
  }
}

function decodeUtf8(
  decoder: TextDecoder,
  value?: Uint8Array,
  options?: TextDecodeOptions,
): string {
  try {
    return decoder.decode(value, options);
  } catch (error) {
    if (error instanceof TypeError) throw new CrossProjectSourceEncodingError();
    throw error;
  }
}

export async function readLimitedCrossProjectSource(
  response: Response,
  registryUrl: string,
  maxBytes = MAX_CROSS_PROJECT_SOURCE_BYTES,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }

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
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let totalBytes = 0;
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new CrossProjectSourceTooLargeError(registryUrl, maxBytes);
      }

      chunks.push(decodeUtf8(decoder, value, { stream: true }));
    }

    const tail = decodeUtf8(decoder);
    if (tail.length > 0) chunks.push(tail);
    completed = true;
    return chunks.join("");
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the source read or decoding error.
      }
    }
    reader.releaseLock();
  }
}
