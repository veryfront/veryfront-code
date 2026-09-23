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

  it("cleans a failed response and an aborted unconsumed response", async () => {
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
    const abort = new AbortController();
    const response = withResponseCleanup(new Response("unused"), () => cleaned++, abort.signal);
    abort.abort();
    assertEquals(cleaned, 2);
    await response.body!.cancel();
    assertEquals(cleaned, 2);
  });
});
