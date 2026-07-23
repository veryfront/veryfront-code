import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readResponseTextPrefix } from "./response-body.ts";

describe("utils/response-body", () => {
  it("rejects invalid byte limits", async () => {
    for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assertRejects(
        () => readResponseTextPrefix(new Response("body"), limit),
        RangeError,
      );
    }
  });

  it("cancels an oversized response after reading the byte limit", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1_024));
    let pulls = 0;
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          pulls++;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    const result = await readResponseTextPrefix(response, 2_000);

    assertEquals(result.text.length, 2_000);
    assertEquals(result.truncated, true);
    assertEquals(cancelled, true);
    assertEquals(pulls <= 3, true);
  });

  it("reports a complete response without truncation", async () => {
    const result = await readResponseTextPrefix(new Response("complete"), 100);

    assertEquals(result, { text: "complete", truncated: false });
  });

  it("does not emit a replacement character when truncating inside UTF-8", async () => {
    const result = await readResponseTextPrefix(new Response("😀after"), 3);

    assertEquals(result, { text: "", truncated: true });
  });

  it("cancels immediately when the byte limit is reached before EOF", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("exact"));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("reader waited beyond the byte limit")),
        50,
      );
    });
    const result = await (async () => {
      try {
        return await Promise.race([readResponseTextPrefix(response, 5), timeout]);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    })();

    assertEquals(result, { text: "exact", truncated: true });
    assertEquals(cancelled, true);
  });
});
