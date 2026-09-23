import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withResponseCleanup } from "./response-cleanup.ts";

describe("withResponseCleanup", () => {
  it("retains invocation resources through streaming and cleans once on completion", async () => {
    let cleaned = 0;
    const abort = new AbortController();
    const response = withResponseCleanup(new Response("hello"), () => cleaned++, abort.signal);
    assertEquals(cleaned, 0);
    assertEquals(await response.text(), "hello");
    assertEquals(cleaned, 1);
    abort.abort();
    assertEquals(cleaned, 1);
  });

  it("cleans cancellation and forwards its reason", async () => {
    let cleaned = 0;
    let reason: unknown;
    const response = withResponseCleanup(
      new Response(
        new ReadableStream({
          cancel(value) {
            reason = value;
          },
        }),
      ),
      () => cleaned++,
      new AbortController().signal,
    );
    await response.body!.cancel("stop");
    assertEquals(cleaned, 1);
    assertEquals(reason, "stop");
  });

  it("cleans a failed response", async () => {
    let cleaned = 0;
    const failed = withResponseCleanup(
      new Response(
        new ReadableStream({
          pull() {
            throw new Error("failed");
          },
        }),
      ),
      () => cleaned++,
      new AbortController().signal,
    );
    await assertRejects(() => failed.text(), Error, "failed");
    assertEquals(cleaned, 1);
  });

  for (const alreadyAborted of [false, true]) {
    it(`cancels an ${alreadyAborted ? "already" : "subsequently"} aborted body before cleanup`, async () => {
      const events: string[] = [];
      const cancelled = Promise.withResolvers<void>();
      const abort = new AbortController();
      let cancellationReason: unknown;
      const body = new ReadableStream<Uint8Array>({
        async cancel(reason) {
          cancellationReason = reason;
          events.push("cancel-start");
          await cancelled.promise;
          events.push("cancel-done");
        },
      });
      if (alreadyAborted) abort.abort("request-disconnected");
      const response = withResponseCleanup(
        new Response(body),
        () => events.push("cleanup"),
        abort.signal,
      );
      if (!alreadyAborted) abort.abort("request-disconnected");
      await Promise.resolve();
      assertEquals(events, ["cancel-start"]);
      assertEquals(cancellationReason, "request-disconnected");
      const consumed = response.text();
      await Promise.resolve();
      assertEquals(events, ["cancel-start"]);
      cancelled.resolve();
      await consumed;
      assertEquals(events, ["cancel-start", "cancel-done", "cleanup"]);
      assertEquals(body.locked, false);
    });
  }

  it("awaits upstream cancellation with a pending read", async () => {
    const started = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    const abort = new AbortController();
    let cleaned = 0;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        started.resolve();
      },
      cancel() {
        return cancelled.promise;
      },
    });
    const response = withResponseCleanup(new Response(body), () => cleaned++, abort.signal);
    const consumed = response.text();
    await started.promise;
    abort.abort();
    await Promise.resolve();
    assertEquals(cleaned, 0);
    cancelled.resolve();
    await consumed;
    assertEquals(cleaned, 1);
    assertEquals(body.locked, false);
  });

  it("retires resources even when upstream cancellation rejects", async () => {
    const abort = new AbortController();
    let cleaned = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(new Error("cancel failed"));
      },
    });
    const response = withResponseCleanup(new Response(body), () => cleaned++, abort.signal);
    abort.abort();
    await assertRejects(() => response.text(), Error, "cancel failed");
    assertEquals(cleaned, 1);
    assertEquals(body.locked, false);
  });
});
