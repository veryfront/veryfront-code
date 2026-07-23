export interface ResponseTextPrefix {
  text: string;
  /** True when the byte limit was reached before EOF was observed. */
  truncated: boolean;
}

/** Read at most maxBytes from a response body and cancel any unread remainder. */
export async function readResponseTextPrefix(
  response: Response,
  maxBytes: number,
): Promise<ResponseTextPrefix> {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative integer");
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

  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }

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
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  return { text: truncated ? text : text + decoder.decode(), truncated };
}
