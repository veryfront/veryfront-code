import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  HttpModuleBodyEncodingError,
  HttpModuleBodyTooLargeError,
  readHttpModuleText,
} from "./http-module-response.ts";

describe("transforms/shared/http-module-response", () => {
  it("accepts a response exactly at the byte limit", async () => {
    assertEquals(await readHttpModuleText(new Response("four"), 4), "four");
  });

  it("rejects and cancels a declared oversized response", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-length": "5" } },
    );

    await assertRejects(
      () => readHttpModuleText(response, 4),
      HttpModuleBodyTooLargeError,
      "exceeds 4 bytes",
    );
    assertEquals(cancelled, true);
  });

  it("rejects and cancels an oversized streamed response", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("12345"));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await assertRejects(
      () => readHttpModuleText(response, 4),
      HttpModuleBodyTooLargeError,
      "exceeds 4 bytes",
    );
    assertEquals(cancelled, true);
  });

  it("rejects malformed UTF-8 instead of replacing source bytes", async () => {
    await assertRejects(
      () => readHttpModuleText(new Response(new Uint8Array([0xc3, 0x28])), 10),
      HttpModuleBodyEncodingError,
      "not valid UTF-8",
    );
  });

  it("honors an abort while a response body is stalled", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    const controller = new AbortController();
    const reason = new DOMException("body deadline reached", "TimeoutError");
    const pending = readHttpModuleText(response, 10, controller.signal);

    controller.abort(reason);

    await assertRejects(() => pending, DOMException, "body deadline reached");
    assertEquals(cancelled, true);
  });
});
