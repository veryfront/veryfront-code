export interface ResponseTextPrefix {
  text: string;
  /** True when the byte limit was reached before EOF was observed. */
  truncated: boolean;
}

/** Raised when strict response decoding encounters malformed UTF-8. */
export class InvalidResponseBodyUtf8Error extends TypeError {
  constructor(options?: ErrorOptions) {
    super("Response body is not valid UTF-8", options);
    this.name = "InvalidResponseBodyUtf8Error";
  }
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
  options: { fatalUtf8?: boolean } = {},
): Promise<ResponseTextPrefix> {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative integer");
  }
  abortSignal?.throwIfAborted();

  const body = response.body;
  if (!body) return { text: "", truncated: false };

  const limit = maxBytes;
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: options.fatalUtf8 ?? false });
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
      try {
        text += decoder.decode(value.subarray(0, used), { stream: true });
      } catch (cause) {
        throw new InvalidResponseBodyUtf8Error({ cause });
      }
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

  if (truncated) return { text, truncated };
  try {
    return { text: text + decoder.decode(), truncated };
  } catch (cause) {
    throw new InvalidResponseBodyUtf8Error({ cause });
  }
}
