import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { readResponseTextPrefix } from "./response-body.ts";

describe("utils/response-body", () => {
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

  it("does not wait indefinitely for an underlying cancel hook", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("exact"));
        },
        cancel() {
          cancelled = true;
          return new Promise<void>(() => {});
        },
      }),
    );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("cancel hook blocked the reader")), 50);
    });
    try {
      assertEquals(
        await Promise.race([readResponseTextPrefix(response, 5), timeout]),
        { text: "exact", truncated: true },
      );
      assertEquals(cancelled, true);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  });

  it("rejects limits that cannot provide a finite memory bound", async () => {
    for (const limit of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 16 * 1_024 * 1_024 + 1]) {
      await assertRejects(
        () => readResponseTextPrefix(new Response("body"), limit),
        RangeError,
        "maxBytes must be an integer between 0 and 16777216",
      );
    }
  });

  it("cancels a stream that repeatedly produces empty chunks", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array());
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await assertRejects(
      () => readResponseTextPrefix(response, 10),
      TypeError,
      "Response body made no progress",
    );
    assertEquals(cancelled, true);
  });
});
