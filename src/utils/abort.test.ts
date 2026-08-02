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
