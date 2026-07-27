import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createClientRequestLifetime, readJsonResponseWithinLimit } from "./client-transport.ts";

describe("rendering/rsc/client-transport", () => {
  it("cancels a response body that crosses the configured byte limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"too large"}'));
      },
      cancel() {
        cancelled = true;
      },
    });

    await assertRejects(
      () => readJsonResponseWithinLimit(new Response(body), 8),
      RangeError,
      "byte limit",
    );
    assertEquals(cancelled, true);
  });

  it("rejects malformed UTF-8 instead of replacing bytes inside JSON", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new Uint8Array([
            0x7b,
            0x22,
            0x76,
            0x22,
            0x3a,
            0x22,
            0xff,
            0x22,
            0x7d,
          ]),
        );
        controller.close();
      },
    });

    await assertRejects(
      () => readJsonResponseWithinLimit(new Response(body), 64),
      TypeError,
    );
  });

  it("links requests to pagehide and removes the listener on disposal", () => {
    const target = new EventTarget();
    const lifetime = createClientRequestLifetime(60_000, target);

    target.dispatchEvent(new Event("pagehide"));
    assertEquals(lifetime.signal.aborted, true);

    lifetime.dispose();
  });
});
