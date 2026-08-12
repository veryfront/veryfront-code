import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { awaitAbortable, createAbortError, throwIfAborted } from "./abort.ts";

Deno.test("abort utilities preserve Error reasons and normalize other reasons", () => {
  const reason = new Error("stop");
  assertStrictEquals(createAbortError(reason), reason);

  const normalized = createAbortError("stop now");
  assertEquals(normalized.name, "AbortError");
  assertEquals(normalized.message, "stop now");

  const controller = new AbortController();
  controller.abort(reason);
  const thrown = assertRejects(
    () => Promise.resolve().then(() => throwIfAborted(controller.signal)),
  );
  return thrown.then((error) => assertStrictEquals(error, reason));
});

Deno.test("createAbortError keeps a reason minted outside this realm", () => {
  // What an Error created in a worker, a `vm` context, or a second instance of
  // this module graph looks like to `instanceof`.
  const reason = Object.setPrototypeOf(new Error("upstream cancelled"), { name: "UpstreamAbort" });
  assertEquals(reason instanceof Error, false);

  assertStrictEquals(createAbortError(reason), reason);

  // Reasons that are not errors are still normalized, shaped ones included.
  assertEquals(createAbortError({ name: "Error", message: "shaped" }).name, "AbortError");
  assertEquals(createAbortError(undefined).name, "AbortError");
});

Deno.test("awaitAbortable lets cancellation win when a producer stalls", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const pending = awaitAbortable(new Promise<never>(() => {}), controller.signal);
  controller.abort(reason);

  const error = await assertRejects(() => pending);
  assertStrictEquals(error, reason);
});

Deno.test("awaitAbortable preserves successful values and producer failures", async () => {
  assertEquals(await awaitAbortable(Promise.resolve(42)), 42);

  const failure = new Error("producer failed");
  const error = await assertRejects(() => awaitAbortable(Promise.reject(failure)));
  assertStrictEquals(error, failure);
});
