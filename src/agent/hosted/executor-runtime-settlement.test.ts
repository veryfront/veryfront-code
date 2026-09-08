import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { awaitExecutorCleanup } from "./executor-runtime-settlement.ts";

it("retains channel retirement after runtime cleanup fails", async () => {
  const channel = Promise.withResolvers<void>();
  let settled = false;
  const closing = awaitExecutorCleanup([
    Promise.reject(new Error("Synthetic cleanup failure")),
    channel.promise,
  ]);
  void closing.then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assertEquals(settled, false);
  channel.resolve();
  await assertRejects(() => closing);
  assertEquals(settled, true);
});
