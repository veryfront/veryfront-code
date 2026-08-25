import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  ProxyResponseBodyError,
  readProxyResponseBytes,
  readProxyResponseText,
} from "./response-body.ts";

describe("proxy response body reader", () => {
  it("rejects an invalid declared content length before reading", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "Content-Length": "not-a-number" } },
    );

    await assertRejects(
      () => readProxyResponseBytes(response, 16),
      ProxyResponseBodyError,
      "invalid-content-length",
    );
    await Promise.resolve();
    assertEquals(cancelled, true);
  });

  it("rejects streamed bytes beyond the configured limit", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
        },
      }),
    );

    await assertRejects(
      () => readProxyResponseBytes(response, 5),
      ProxyResponseBodyError,
      "too-large",
    );
  });

  // Zero-length chunks skip the byte accounting entirely, so the fixture emits
  // one more than MAX_RESPONSE_BODY_CHUNKS to exercise the independent guard.
  // Keeping it finite makes a broken guard fail the rejection assertion instead
  // of hanging the test worker forever.
  it("rejects an upstream stream that emits too many empty chunks", async () => {
    let emitted = 0;
    const totalChunks = 65_537;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (emitted >= totalChunks) {
            controller.close();
            return;
          }
          emitted++;
          controller.enqueue(new Uint8Array(0));
        },
      }),
    );

    await assertRejects(
      () => readProxyResponseBytes(response, 16),
      ProxyResponseBodyError,
      "too-many-chunks",
    );
    assertEquals(
      emitted,
      totalChunks,
      "the chunk guard must trip on the first chunk beyond MAX_RESPONSE_BODY_CHUNKS",
    );
  });

  it("rejects invalid UTF-8 instead of replacing bytes", async () => {
    const response = new Response(new Uint8Array([0xc3, 0x28]));

    await assertRejects(
      () => readProxyResponseText(response, 2),
      ProxyResponseBodyError,
      "invalid-utf8",
    );
  });

  it("aborts a stalled response stream", async () => {
    const controller = new AbortController();
    const response = new Response(new ReadableStream<Uint8Array>());
    const read = readProxyResponseBytes(response, 16, controller.signal);

    controller.abort(new DOMException("caller stopped", "AbortError"));

    await assertRejects(
      () => read,
      DOMException,
      "caller stopped",
    );
  });
});
