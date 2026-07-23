import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readResponseTextWithinLimit } from "./bounded-response-reader.ts";

describe("styles-builder/bounded-response-reader", () => {
  it("cancels bodies with excessive chunk overhead before buffering them all", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls <= 70_000) controller.enqueue(new Uint8Array([97]));
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });

    await assertRejects(
      () =>
        readResponseTextWithinLimit(
          new Response(body),
          1024 * 1024,
          () => new TypeError("response exceeds the byte limit"),
        ),
      TypeError,
      "chunk count",
    );
    assertEquals(cancelled, true);
    assertEquals(pulls < 70_000, true);
  });
});
