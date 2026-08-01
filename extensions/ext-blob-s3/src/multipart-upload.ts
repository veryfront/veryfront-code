import type { PutObjectCommandInput, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import { API_ERROR, INVALID_ARGUMENT } from "veryfront/errors";

export const MIN_MULTIPART_PART_SIZE = 5 * 1024 * 1024;
export const DEFAULT_MULTIPART_PART_SIZE = 8 * 1024 * 1024;
export const MAX_MULTIPART_PART_SIZE = 512 * 1024 * 1024;
export const DEFAULT_MULTIPART_QUEUE_SIZE = 2;
export const MAX_MULTIPART_QUEUE_SIZE = 16;

export interface S3BlobStorageStreamUploadInput {
  readonly bucket: string;
  readonly key: string;
  readonly stream: ReadableStream;
  readonly mimeType: string;
  readonly expiresAt?: Date;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly partSize: number;
  readonly queueSize: number;
  readonly signal?: AbortSignal;
}

export interface S3BlobStorageStreamUploader {
  upload(input: S3BlobStorageStreamUploadInput): Promise<number>;
}

function invalidByteStream(detail: string, cause?: unknown): Error {
  return INVALID_ARGUMENT.create({ detail, cause });
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

async function uploadStream(
  client: S3Client,
  input: S3BlobStorageStreamUploadInput,
): Promise<number> {
  input.signal?.throwIfAborted();
  let reader: ReadableStreamDefaultReader;
  try {
    reader = input.stream.getReader();
  } catch (cause) {
    throw invalidByteStream("S3BlobStorage: upload stream must be unlocked", cause);
  }

  let bytesRead = 0;
  let readerFinished = false;
  let readerCancelled = false;
  let cancellationReason: unknown;
  const cancelSource = async (reason: unknown): Promise<void> => {
    if (readerFinished || readerCancelled) return;
    readerCancelled = true;
    await cancelReader(reader, reason);
  };

  async function* bytes(): AsyncGenerator<Uint8Array> {
    try {
      while (true) {
        input.signal?.throwIfAborted();
        const result = await reader.read();
        input.signal?.throwIfAborted();
        if (result.done) {
          readerFinished = true;
          return;
        }
        if (!(result.value instanceof Uint8Array)) {
          throw invalidByteStream(
            "S3BlobStorage: ReadableStream chunks must be Uint8Array values",
          );
        }
        bytesRead += result.value.byteLength;
        if (!Number.isSafeInteger(bytesRead)) {
          throw invalidByteStream("S3BlobStorage: upload stream exceeds the supported size range");
        }
        yield result.value;
      }
    } catch (error) {
      cancellationReason = error;
      await cancelSource(error);
      throw error;
    } finally {
      await cancelSource(cancellationReason);
      reader.releaseLock();
    }
  }

  const body = Readable.from(bytes(), { objectMode: false });
  const abortController = new AbortController();
  let upload: Upload | undefined;
  let uploadAbortPromise: Promise<void> | undefined;
  let uploadAbortFailed = false;
  let uploadAbortFailure: unknown;
  const requestUploadAbort = (): void => {
    if (!upload || uploadAbortPromise) return;
    const currentUpload = upload;
    uploadAbortPromise = Promise.resolve()
      .then(() => currentUpload.abort())
      .catch((error) => {
        uploadAbortFailed = true;
        uploadAbortFailure = error;
      });
  };
  let abortCancellation: Promise<void> | undefined;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = (): void => {
    const reason = input.signal?.reason;
    cancellationReason = reason;
    abortController.abort(reason);
    abortCancellation ??= cancelSource(reason);
    body.destroy();
    requestUploadAbort();
    rejectAbort?.(reason);
  };
  if (input.signal?.aborted) onAbort();
  else input.signal?.addEventListener("abort", onAbort, { once: true });

  let completed = false;
  let done: Promise<unknown> | undefined;
  try {
    const params: PutObjectCommandInput = {
      Bucket: input.bucket,
      Key: input.key,
      Body: body as PutObjectCommandInput["Body"],
      ContentType: input.mimeType,
      Expires: input.expiresAt,
      Metadata: input.metadata,
    };
    upload = new Upload({
      client,
      params,
      abortController,
      leavePartsOnError: false,
      partSize: input.partSize,
      queueSize: input.queueSize,
    });
    done = upload.done();
    await Promise.race([done, aborted]);
    if (!readerFinished) {
      throw API_ERROR.create({
        detail: "S3BlobStorage: multipart uploader did not consume the source stream",
      });
    }
    completed = true;
    return bytesRead;
  } catch (error) {
    cancellationReason = error;
    abortController.abort(error);
    await cancelSource(error);
    body.destroy();
    requestUploadAbort();
    await uploadAbortPromise;
    if (uploadAbortFailed) {
      throw new AggregateError(
        [error, uploadAbortFailure],
        "S3BlobStorage: upload failed and multipart cleanup also failed",
      );
    }
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    rejectAbort = undefined;
    await abortCancellation;
    await uploadAbortPromise;
    if (!completed) void done?.catch(() => undefined);
  }
}

/** Create the official AWS multipart adapter for unknown-length Web streams. */
export function createS3BlobStorageStreamUploader(client: S3Client): S3BlobStorageStreamUploader {
  return {
    upload: (input) => uploadStream(client, input),
  };
}
