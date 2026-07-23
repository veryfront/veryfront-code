export interface ResponseTextPrefix {
  text: string;
  /** True when the byte limit was reached before EOF was observed. */
  truncated: boolean;
}

const MAX_RESPONSE_TEXT_PREFIX_BYTES = 16 * 1_024 * 1_024;
const MAX_CONSECUTIVE_EMPTY_CHUNKS = 100;

/** Read at most maxBytes from a response body and cancel any unread remainder. */
export async function readResponseTextPrefix(
  response: Response,
  maxBytes: number,
): Promise<ResponseTextPrefix> {
  if (
    !Number.isSafeInteger(maxBytes) || maxBytes < 0 ||
    maxBytes > MAX_RESPONSE_TEXT_PREFIX_BYTES
  ) {
    throw new RangeError(
      `maxBytes must be an integer between 0 and ${MAX_RESPONSE_TEXT_PREFIX_BYTES}.`,
    );
  }

  const body = response.body;
  if (!body) return { text: "", truncated: false };

  const limit = maxBytes;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let remaining = limit;
  let text = "";
  let completed = false;
  let truncated = false;
  let consecutiveEmptyChunks = 0;

  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      if (value.byteLength === 0) {
        consecutiveEmptyChunks++;
        if (consecutiveEmptyChunks >= MAX_CONSECUTIVE_EMPTY_CHUNKS) {
          throw new TypeError(
            `Response body made no progress after ${MAX_CONSECUTIVE_EMPTY_CHUNKS} empty chunks.`,
          );
        }
        continue;
      }
      consecutiveEmptyChunks = 0;

      const used = Math.min(value.byteLength, remaining);
      text += decoder.decode(value.subarray(0, used), { stream: true });
      remaining -= used;

      if (used < value.byteLength) {
        truncated = true;
        break;
      }
    }
    if (!completed && remaining === 0) truncated = true;
  } finally {
    if (!completed) {
      try {
        void reader.cancel().catch(() => {});
      } catch {
        // Cancellation is best effort and must not mask the read result.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // A non-conforming stream must not mask the read result during cleanup.
    }
  }

  return { text: text + decoder.decode(), truncated };
}
