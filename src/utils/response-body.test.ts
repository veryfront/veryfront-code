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

  it("does not await stalled cancellation after an exact-limit read, even if abort follows", async () => {
    let cancellationStarted = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("exact"));
        },
        cancel() {
          cancellationStarted = true;
          return new Promise<void>(() => {});
        },
      }),
    );
    const abortController = new AbortController();
    const laterAbort = new Promise<void>((resolve) => {
      setTimeout(() => {
        abortController.abort(new Error("later abort"));
        resolve();
      }, 5);
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timed-out">((resolve) => {
      timeoutId = setTimeout(() => resolve("timed-out"), 100);
    });

    try {
      const outcome = await Promise.race([
        readResponseTextPrefix(response, 5, abortController.signal),
        timeout,
      ]);

      assertEquals(outcome === "timed-out", false);
      if (outcome === "timed-out") return;
      assertEquals(outcome, { text: "exact", truncated: true });
      assertEquals(cancellationStarted, true);
      await laterAbort;
      assertEquals(abortController.signal.aborted, true);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  });

  it("aborts a stalled body read and cancels the unread stream", async () => {
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    const abortController = new AbortController();
    const fallbackTimer = setTimeout(() => {
      try {
        streamController?.close();
      } catch {
        // The implementation may already have cancelled the stream.
      }
    }, 25);
    const read = readResponseTextPrefix(response, 100, abortController.signal);
    abortController.abort(new Error("body read timed out"));

    try {
      await assertRejects(() => read, Error, "body read timed out");
      assertEquals(cancelled, true);
    } finally {
      clearTimeout(fallbackTimer);
      try {
        streamController?.close();
      } catch {
        // The implementation should already have cancelled the stream.
      }
    }
  });

  it("does not let a stalled cancellation defeat an aborted body read", async () => {
    let cancellationStarted = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => {}),
        cancel: () => {
          cancellationStarted = true;
          return new Promise<void>(() => {});
        },
      }),
    );
    const abortController = new AbortController();
    const read = readResponseTextPrefix(response, 100, abortController.signal);
    abortController.abort(new Error("body read timed out"));

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timed-out">((resolve) => {
      timeoutId = setTimeout(() => resolve("timed-out"), 100);
    });

    try {
      const outcome = await Promise.race([
        read.then(
          () => ({ status: "fulfilled" as const }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        ),
        timeout,
      ]);

      assertEquals(outcome === "timed-out", false);
      if (outcome === "timed-out") return;
      assertEquals(outcome.status, "rejected");
      assertEquals(
        outcome.status === "rejected" &&
          outcome.error instanceof Error &&
          outcome.error.message,
        "body read timed out",
      );
      assertEquals(cancellationStarted, true);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  });
});
