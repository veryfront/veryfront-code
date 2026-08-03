import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { MIN_RESUMABLE_CHUNK_SIZE, uploadUnknownLengthStream } from "./resumable-upload.ts";

const SESSION_URL = new URL(
  "https://storage.googleapis.com/upload/storage/v1/b/bucket/o?uploadType=resumable&upload_id=test",
);

function byteStream(size: number, observeCancel?: (reason: unknown) => void): ReadableStream {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(size));
      controller.close();
    },
    cancel: observeCancel,
  });
}

function upload(
  stream: ReadableStream,
  request: (input: URL, init: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
  createHttpError: (response: Response) => Promise<Error> = async () =>
    new Error("provider failed"),
) {
  return uploadUnknownLengthStream({
    stream,
    sessionUrl: SESSION_URL,
    contentType: "application/octet-stream",
    chunkSize: MIN_RESUMABLE_CHUNK_SIZE,
    signal,
    request,
    createHttpError,
  });
}

describe("GCS resumable stream protocol", () => {
  it("finalizes an empty stream with an explicit zero-byte total", async () => {
    let headers = new Headers();
    const result = await upload(byteStream(0), async (_input, init) => {
      headers = new Headers(init.headers);
      return new Response(null, { status: 200 });
    });
    assertEquals(result.size, 0);
    assertEquals(headers.get("content-length"), "0");
    assertEquals(headers.get("content-range"), "bytes */0");
  });

  it("rejects missing, malformed, out-of-range, and unaligned acknowledgements", async () => {
    const cases: Array<{ range: string | undefined; detail: string }> = [
      { range: "malformed", detail: "invalid Range header" },
      {
        range: `bytes=0-${MIN_RESUMABLE_CHUNK_SIZE}`,
        detail: "outside the request range",
      },
      { range: "bytes=0-0", detail: "unaligned intermediate range" },
    ];
    for (const testCase of cases) {
      await assertRejects(
        () =>
          upload(
            byteStream(MIN_RESUMABLE_CHUNK_SIZE + 1),
            async () =>
              new Response(null, {
                status: 308,
                headers: testCase.range === undefined ? {} : { range: testCase.range },
              }),
          ),
        Error,
        testCase.detail,
      );
    }

    let requests = 0;
    await assertRejects(
      () =>
        upload(byteStream(MIN_RESUMABLE_CHUNK_SIZE + 1), async () => {
          requests += 1;
          return requests === 1
            ? new Response(null, {
              status: 308,
              headers: { range: `bytes=0-${MIN_RESUMABLE_CHUNK_SIZE - 1}` },
            })
            : new Response(null, { status: 308 });
        }),
      Error,
      "outside the request range",
    );
  });

  it("bounds repeated acknowledgements that make no progress", async () => {
    let requests = 0;
    await assertRejects(
      () =>
        upload(byteStream(MIN_RESUMABLE_CHUNK_SIZE + 1), async () => {
          requests += 1;
          return new Response(null, { status: 308 });
        }),
      Error,
      "repeatedly made no progress",
    );
    assertEquals(requests, 3);
  });

  it("rejects premature success and a final acknowledgement without completion", async () => {
    await assertRejects(
      () => upload(byteStream(MIN_RESUMABLE_CHUNK_SIZE + 1), async () => new Response()),
      Error,
      "finalized before the source stream ended",
    );
    await assertRejects(
      () =>
        upload(
          byteStream(1),
          async () =>
            new Response(null, {
              status: 308,
              headers: { range: "bytes=0-0" },
            }),
        ),
      Error,
      "accepted the final range without finalizing",
    );
  });

  it("rejects non-byte chunks before transport", async () => {
    let requests = 0;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue("not bytes");
        controller.close();
      },
    });
    await assertRejects(
      () =>
        upload(stream, async () => {
          requests += 1;
          return new Response();
        }),
      Error,
      "ReadableStream chunks must be Uint8Array",
    );
    assertEquals(requests, 0);
  });

  it("cancels the source with the exact HTTP failure", async () => {
    const providerError = new Error("provider failed");
    let cancellationReason: unknown;
    let caught: unknown;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MIN_RESUMABLE_CHUNK_SIZE + 1));
      },
      cancel(reason) {
        cancellationReason = reason;
      },
    });
    try {
      await upload(
        stream,
        async () => new Response("failed", { status: 500 }),
        undefined,
        async () => providerError,
      );
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, providerError);
    assertStrictEquals(cancellationReason, providerError);
  });

  it("cancels an idle read and rejects with the exact abort reason", async () => {
    const controller = new AbortController();
    const abortReason = new Error("stop upload");
    let cancellationReason: unknown;
    let requests = 0;
    const stream = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancellationReason = reason;
      },
    });
    const pending = upload(
      stream,
      async () => {
        requests += 1;
        return new Response();
      },
      controller.signal,
    );
    controller.abort(abortReason);
    let caught: unknown;
    try {
      await pending;
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, abortReason);
    assertStrictEquals(cancellationReason, abortReason);
    assertEquals(requests, 0);
  });
});
