import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { encodeMessage, readMessages } from "./protocol.ts";

describe("performance control protocol", () => {
  it("cancels a stalled read when its deadline expires", async () => {
    const deadline = new AbortController();
    let cancelled = false;
    let source: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
        controller.enqueue(new TextEncoder().encode('{"stage":'));
      },
      cancel() {
        cancelled = true;
      },
    });
    // Bound the regression on implementations that ignore the signal.
    const fallback = setTimeout(() => source.close(), 100);
    const timeout = setTimeout(
      () => deadline.abort(new Error("Client deadline expired")),
      10,
    );
    try {
      await assertRejects(
        async () => {
          for await (const _message of readMessages(stream, deadline.signal)) {
            // The partial message never completes.
          }
        },
        Error,
        "Client deadline expired",
      );
      assertEquals(cancelled, true);
      assertEquals(stream.locked, false);
    } finally {
      clearTimeout(timeout);
      clearTimeout(fallback);
    }
  });

  it("reads complete messages and releases the stream before a later abort", async () => {
    const deadline = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeMessage({ stage: "ready" }));
        controller.enqueue(encodeMessage({ stage: "measured" }));
        controller.close();
      },
    });
    const messages = [];
    for await (const message of readMessages(stream, deadline.signal)) {
      messages.push(message);
    }
    assertEquals(messages, [{ stage: "ready" }, { stage: "measured" }]);
    assertEquals(stream.locked, false);
    deadline.abort();
  });
});
