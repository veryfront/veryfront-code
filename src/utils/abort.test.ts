import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { awaitAbortable, createAbortError, throwIfAborted } from "./abort.ts";

describe("abort utilities", () => {
  it("preserves Error reasons and normalizes other reasons", async () => {
    const reason = new Error("stop");
    assertStrictEquals(createAbortError(reason), reason);

    const normalized = createAbortError("stop now");
    assertEquals(normalized.name, "AbortError");
    assertEquals(normalized.message, "stop now");

    const controller = new AbortController();
    controller.abort(reason);
    const thrown = await assertRejects(
      () => Promise.resolve().then(() => throwIfAborted(controller.signal)),
    );
    assertStrictEquals(thrown, reason);
  });

  it("reads the immediate AbortSignal Error reason before normalizing", () => {
    const controller = new AbortController();
    const reason = new Error("caller aborted during startup");

    controller.abort(reason);

    assertEquals(controller.signal.aborted, true);
    assertStrictEquals(
      controller.signal.reason,
      reason,
      "AbortSignal must expose the supplied Error reason before shared abort handling reads it",
    );

    let thrown: unknown;
    try {
      throwIfAborted(controller.signal);
    } catch (error) {
      thrown = error;
    }
    assertStrictEquals(thrown, reason);
  });

  it("keeps a reason minted outside this realm", () => {
    // What an Error created in a worker, a `vm` context, or a second instance of
    // this module graph looks like to `instanceof`.
    const reason = Object.setPrototypeOf(new Error("upstream cancelled"), {
      name: "UpstreamAbort",
    });
    assertEquals(reason instanceof Error, false);

    assertStrictEquals(createAbortError(reason), reason);

    // Reasons that are not errors are still normalized, shaped ones included.
    assertEquals(createAbortError({ name: "Error", message: "shaped" }).name, "AbortError");
    assertEquals(createAbortError(undefined).name, "AbortError");
  });

  it("lets cancellation win when a producer stalls", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const pending = awaitAbortable(new Promise<never>(() => {}), controller.signal);
    controller.abort(reason);

    const error = await assertRejects(() => pending);
    assertStrictEquals(error, reason);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("already cancelled");
    controller.abort(reason);

    const error = await assertRejects(() =>
      awaitAbortable(new Promise<never>(() => {}), controller.signal)
    );
    assertStrictEquals(
      error,
      reason,
      "an already-aborted signal must reject before awaiting a stalled producer",
    );
  });

  it("preserves successful values and producer failures", async () => {
    assertEquals(await awaitAbortable(Promise.resolve(42)), 42);

    const failure = new Error("producer failed");
    const error = await assertRejects(() => awaitAbortable(Promise.reject(failure)));
    assertStrictEquals(error, failure);
  });
});
