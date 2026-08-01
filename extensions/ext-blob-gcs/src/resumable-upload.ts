import { API_ERROR, INVALID_ARGUMENT } from "veryfront/errors";

export const MIN_RESUMABLE_CHUNK_SIZE = 256 * 1024;
export const DEFAULT_RESUMABLE_CHUNK_SIZE = 8 * 1024 * 1024;
export const MAX_RESUMABLE_CHUNK_SIZE = 64 * 1024 * 1024;

const MAX_CONSECUTIVE_NO_PROGRESS_RESPONSES = 3;

interface ByteChunk {
  readonly bytes: Uint8Array;
  readonly final: boolean;
}

export interface ResumableStreamUploadOptions {
  readonly stream: ReadableStream;
  readonly sessionUrl: URL;
  readonly contentType: string;
  readonly chunkSize: number;
  readonly signal?: AbortSignal;
  readonly request: (input: URL, init: RequestInit) => Promise<Response>;
  readonly createHttpError: (response: Response) => Promise<Error>;
}

export interface ResumableStreamUploadResult {
  readonly response: Response;
  readonly size: number;
}

function invalidByteStream(detail: string, cause?: unknown): Error {
  return INVALID_ARGUMENT.create({ detail, cause });
}

function protocolError(detail: string): Error {
  return API_ERROR.create({ detail });
}

async function cancelReader(
  reader: ReadableStreamDefaultReader,
  reason: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // The failure that stopped the upload remains authoritative.
  }
}

async function* readByteChunks(
  stream: ReadableStream,
  chunkSize: number,
  signal: AbortSignal | undefined,
  cancellationReason: () => unknown,
): AsyncGenerator<ByteChunk> {
  let reader: ReadableStreamDefaultReader;
  try {
    reader = stream.getReader();
  } catch (cause) {
    throw invalidByteStream("GCSBlobStorage: upload stream must be unlocked", cause);
  }

  let readerFinished = false;
  let readerCancelled = false;
  let pending: Uint8Array | undefined;
  let pendingOffset = 0;

  const cancel = async (reason: unknown): Promise<void> => {
    if (readerFinished || readerCancelled) return;
    readerCancelled = true;
    await cancelReader(reader, reason);
  };
  let abortCancellation: Promise<void> | undefined;
  const onAbort = (): void => {
    abortCancellation ??= cancel(signal?.reason);
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  const loadPendingBytes = async (): Promise<boolean> => {
    while (!readerFinished && (!pending || pendingOffset === pending.byteLength)) {
      signal?.throwIfAborted();
      const result = await reader.read();
      if (result.done) {
        readerFinished = true;
        pending = undefined;
        pendingOffset = 0;
        return false;
      }
      if (!(result.value instanceof Uint8Array)) {
        throw invalidByteStream(
          "GCSBlobStorage: ReadableStream chunks must be Uint8Array values",
        );
      }
      if (result.value.byteLength === 0) continue;
      pending = result.value;
      pendingOffset = 0;
    }
    return pending !== undefined && pendingOffset < pending.byteLength;
  };

  try {
    if (!(await loadPendingBytes())) {
      yield { bytes: new Uint8Array(), final: true };
      return;
    }

    while (true) {
      const buffer = new Uint8Array(chunkSize);
      let length = 0;
      while (length < chunkSize && await loadPendingBytes()) {
        const available = pending!.byteLength - pendingOffset;
        const copied = Math.min(chunkSize - length, available);
        buffer.set(pending!.subarray(pendingOffset, pendingOffset + copied), length);
        length += copied;
        pendingOffset += copied;
      }

      const final = !(await loadPendingBytes());
      yield {
        bytes: length === chunkSize ? buffer : buffer.slice(0, length),
        final,
      };
      if (final) return;
    }
  } catch (error) {
    await cancel(error);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await abortCancellation;
    await cancel(cancellationReason());
    reader.releaseLock();
  }
}

function acknowledgedByteCount(response: Response): number {
  const value = response.headers.get("range");
  if (value === null) return 0;
  const match = /^bytes=0-(0|[1-9][0-9]*)$/.exec(value);
  if (!match) {
    throw protocolError("GCSBlobStorage: resumable upload returned an invalid Range header");
  }
  const lastByte = Number(match[1]);
  if (!Number.isSafeInteger(lastByte)) {
    throw protocolError("GCSBlobStorage: resumable upload returned an unsafe byte range");
  }
  return lastByte + 1;
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A valid acknowledgement remains authoritative over body cleanup.
  }
}

/** Upload an unknown-length byte stream using the GCS resumable protocol. */
export async function uploadUnknownLengthStream(
  options: ResumableStreamUploadOptions,
): Promise<ResumableStreamUploadResult> {
  let acknowledged = 0;
  let cancellationReason: unknown;

  for await (
    const chunk of readByteChunks(
      options.stream,
      options.chunkSize,
      options.signal,
      () => cancellationReason,
    )
  ) {
    const chunkStart = acknowledged;
    const chunkEndExclusive = chunkStart + chunk.bytes.byteLength;
    if (!Number.isSafeInteger(chunkEndExclusive)) {
      const error = protocolError("GCSBlobStorage: upload stream exceeds the supported size range");
      cancellationReason = error;
      throw error;
    }
    const totalSize = chunk.final ? chunkEndExclusive : undefined;
    let chunkOffset = 0;
    let noProgressResponses = 0;

    while (true) {
      const requestStart = chunkStart + chunkOffset;
      const requestBytes = chunk.bytes.subarray(chunkOffset);
      const headers = new Headers({
        "content-length": String(requestBytes.byteLength),
        "content-type": options.contentType,
      });
      headers.set(
        "content-range",
        requestBytes.byteLength === 0
          ? `bytes */${totalSize}`
          : `bytes ${requestStart}-${chunkEndExclusive - 1}/${totalSize ?? "*"}`,
      );

      let response: Response;
      try {
        options.signal?.throwIfAborted();
        response = await options.request(options.sessionUrl, {
          method: "PUT",
          headers,
          body: requestBytes as BodyInit,
        });
      } catch (error) {
        cancellationReason = error;
        throw error;
      }

      if (response.status === 200 || response.status === 201) {
        if (!chunk.final) {
          await discardResponseBody(response);
          const error = protocolError(
            "GCSBlobStorage: resumable upload finalized before the source stream ended",
          );
          cancellationReason = error;
          throw error;
        }
        return { response, size: totalSize! };
      }

      if (response.status !== 308) {
        const error = await options.createHttpError(response);
        cancellationReason = error;
        throw error;
      }

      let nextByte: number;
      try {
        nextByte = acknowledgedByteCount(response);
      } catch (error) {
        cancellationReason = error;
        throw error;
      } finally {
        await discardResponseBody(response);
      }

      if (nextByte < requestStart || nextByte > chunkEndExclusive) {
        const error = protocolError(
          "GCSBlobStorage: resumable upload acknowledged bytes outside the request range",
        );
        cancellationReason = error;
        throw error;
      }
      if (!chunk.final && nextByte % MIN_RESUMABLE_CHUNK_SIZE !== 0) {
        const error = protocolError(
          "GCSBlobStorage: resumable upload acknowledged an unaligned intermediate range",
        );
        cancellationReason = error;
        throw error;
      }
      if (nextByte === requestStart) {
        noProgressResponses += 1;
        if (noProgressResponses >= MAX_CONSECUTIVE_NO_PROGRESS_RESPONSES) {
          const error = protocolError(
            "GCSBlobStorage: resumable upload repeatedly made no progress",
          );
          cancellationReason = error;
          throw error;
        }
        continue;
      }

      noProgressResponses = 0;
      acknowledged = nextByte;
      chunkOffset = nextByte - chunkStart;
      if (chunkOffset === chunk.bytes.byteLength) {
        if (chunk.final) {
          const error = protocolError(
            "GCSBlobStorage: resumable upload accepted the final range without finalizing",
          );
          cancellationReason = error;
          throw error;
        }
        break;
      }
    }
  }

  throw protocolError("GCSBlobStorage: upload stream ended without a final response");
}
