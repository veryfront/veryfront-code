import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createExecutorNodeClock, scheduleExecutorNodeDeadline } from "./executor-node-deadline.ts";

import { ManualMonotonicClock } from "#veryfront/agent/streaming/lifecycle/testing.ts";

function fixture(maxWakeDelayMs?: number) {
  let now = 0;
  let expired = 0;
  const callbacks = new Map<object, { callback: () => void; delayMs: number }>();
  const cancel = scheduleExecutorNodeDeadline(
    {
      now: () => now,
      schedule(callback, delayMs) {
        const handle = {};
        callbacks.set(handle, { callback, delayMs });
        return handle;
      },
      cancel: (handle) => {
        callbacks.delete(handle as object);
      },
    },
    1_000,
    () => expired++,
    maxWakeDelayMs,
  );
  return {
    cancel,
    callbacks,
    get expired() {
      return expired;
    },
    wake(at: number) {
      now = at;
      const [handle, task] = [...callbacks.entries()][0]!;
      callbacks.delete(handle);
      task.callback();
    },
  };
}

it("rechecks the transport deadline after an early timer callback", () => {
  const timer = fixture();
  timer.wake(999);
  assertEquals(timer.expired, 0);
  assertEquals([...timer.callbacks.values()][0]!.delayMs, 1);
  timer.wake(1_000);
  assertEquals(timer.expired, 1);
  assertEquals(timer.callbacks.size, 0);
});

it("cancels the replacement deadline timer and ignores a queued callback", () => {
  const timer = fixture();
  timer.wake(999);
  const queued = [...timer.callbacks.values()][0]!.callback;
  timer.cancel();
  assertEquals(timer.callbacks.size, 0);
  queued();
  assertEquals(timer.expired, 0);
  assertEquals(timer.callbacks.size, 0);
});

it("keeps the one-second elapsed budget after forward UTC correction and rollback", () => {
  const elapsed = new ManualMonotonicClock();
  let wall = 1_000;
  const clock = createExecutorNodeClock(() => wall, elapsed);
  wall = 11_000;
  assertEquals(clock.now(), 11_000);
  const deadline = clock.now() + 1_000;
  wall = 1_000;
  elapsed.advanceBy(999);
  assertEquals(deadline - clock.now(), 1);
  elapsed.advanceBy(1);
  assertEquals(deadline - clock.now(), 0);
});

it("bounds idle UTC rechecks without changing the absolute deadline", () => {
  const timer = fixture(100);
  assertEquals([...timer.callbacks.values()][0]!.delayMs, 100);
  timer.wake(100);
  assertEquals(timer.expired, 0);
  assertEquals([...timer.callbacks.values()][0]!.delayMs, 100);
  timer.wake(999);
  assertEquals(timer.expired, 0);
  assertEquals([...timer.callbacks.values()][0]!.delayMs, 1);
  timer.wake(1_000);
  assertEquals(timer.expired, 1);
});
