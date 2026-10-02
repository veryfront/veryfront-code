import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { scheduleExecutorNodeDeadline } from "./executor-node-deadline.ts";

function fixture() {
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
