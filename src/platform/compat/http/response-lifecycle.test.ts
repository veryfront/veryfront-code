import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { completeOnResponseBodyConsumption } from "./response-lifecycle.ts";

function getSetCookies(headers: Headers): string[] {
  const getSetCookie = headers.getSetCookie;
  return typeof getSetCookie === "function"
    ? getSetCookie.call(headers)
    : [headers.get("set-cookie")].filter((value): value is string => value !== null);
}

describe("response body lifecycle", () => {
  it("completes bodyless responses without changing their identity", () => {
    let completions = 0;
    const response = new Response(null, { status: 204 });

    const tracked = completeOnResponseBodyConsumption(response, () => completions++);

    assertStrictEquals(tracked, response);
    assertEquals(completions, 1);
  });

  it("preserves transport fields and completes after the body is consumed", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let completions = 0;
    const headers = new Headers({
      "content-type": "text/plain",
      "x-response-id": "response-1",
    });
    headers.append("set-cookie", "left=1; Path=/; HttpOnly");
    headers.append("set-cookie", "right=2; Path=/; Secure");
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
      { status: 202, statusText: "Accepted", headers },
    );

    const tracked = completeOnResponseBodyConsumption(response, () => completions++);
    assertEquals(tracked.status, 202);
    assertEquals(tracked.statusText, "Accepted");
    assertEquals(tracked.headers.get("x-response-id"), "response-1");
    assertEquals(getSetCookies(tracked.headers), getSetCookies(response.headers));
    assertEquals(completions, 0);

    const body = tracked.text();
    controller!.enqueue(new TextEncoder().encode("ready"));
    controller!.close();

    assertEquals(await body, "ready");
    assertEquals(completions, 1);
  });

  it("completes once when the consumer cancels the body", async () => {
    let cancellationReason: unknown;
    let completions = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          cancellationReason = reason;
        },
      }),
    );
    const tracked = completeOnResponseBodyConsumption(response, () => completions++);

    await tracked.body!.cancel("consumer stopped");

    assertEquals(cancellationReason, "consumer stopped");
    assertEquals(completions, 1);
  });

  it("completes when the source body errors", async () => {
    const failure = new Error("stream failed");
    let completions = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(failure);
        },
      }),
    );
    const tracked = completeOnResponseBodyConsumption(response, () => completions++);

    await assertRejects(() => tracked.text(), Error, "stream failed");
    assertEquals(completions, 1);
  });

  it("cancels an unconsumed body when the request is aborted", async () => {
    const abort = new AbortController();
    let cancellationReason: unknown;
    let completions = 0;
    const cancelled = Promise.withResolvers<void>();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          cancellationReason = reason;
          cancelled.resolve();
        },
      }),
    );
    completeOnResponseBodyConsumption(response, () => completions++, abort.signal);

    const reason = new DOMException("client disconnected", "AbortError");
    abort.abort(reason);
    await cancelled.promise;
    await Promise.resolve();

    assertStrictEquals(cancellationReason, reason);
    assertEquals(completions, 1);
  });

  it("waits for asynchronous source cancellation before completing", async () => {
    const abort = new AbortController();
    const finishCancellation = Promise.withResolvers<void>();
    const cancellationStarted = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    let completions = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancellationStarted.resolve();
          return finishCancellation.promise;
        },
      }),
    );
    completeOnResponseBodyConsumption(response, () => {
      completions++;
      completed.resolve();
    }, abort.signal);

    abort.abort();
    await cancellationStarted.promise;
    await Promise.resolve();
    assertEquals(completions, 0);

    finishCancellation.resolve();
    await completed.promise;
    assertEquals(completions, 1);
  });

  it("observes source closure even when no consumer reads the wrapper", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const completed = Promise.withResolvers<void>();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
    );
    completeOnResponseBodyConsumption(response, completed.resolve);

    controller!.close();
    await completed.promise;
  });
});
