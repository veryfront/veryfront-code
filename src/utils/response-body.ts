export interface ResponseTextPrefix {
  text: string;
  /** True when the byte limit was reached before EOF was observed. */
  truncated: boolean;
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortSignal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!abortSignal) return await reader.read();
  abortSignal.throwIfAborted();

  return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const onAbort = () => reject(abortSignal.reason);
    abortSignal.addEventListener("abort", onAbort, { once: true });
    if (abortSignal.aborted) onAbort();

    reader.read().then(resolve, reject).finally(() => {
      abortSignal.removeEventListener("abort", onAbort);
    });
  });
}

/** Read at most maxBytes from a response body and cancel any unread remainder. */
export async function readResponseTextPrefix(
  response: Response,
  maxBytes: number,
  abortSignal?: AbortSignal,
): Promise<ResponseTextPrefix> {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative integer");
  }
  abortSignal?.throwIfAborted();

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
      const { done, value } = await readChunk(reader, abortSignal);
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
    if (!completed) {
      try {
        const cancellation = reader.cancel();
        // A response stream controls its cancellation promise. Awaiting that
        // untrusted cleanup can defeat the caller's body timeout, including
        // after an exact-limit read, so initiate cancellation and detach it.
        void cancellation.catch(() => {});
      } catch {
        /* cancellation is best-effort cleanup */
      }
    }
    reader.releaseLock();
  }

  return { text: truncated ? text : text + decoder.decode(), truncated };
}
