import {
  createHostedExecutorSessionClock,
  type HostedExecutorSessionClock,
} from "./executor-session.ts";

import { performanceMonotonicClock } from "#veryfront/agent/streaming/lifecycle/clock.ts";
import type { MonotonicClock } from "#veryfront/agent/streaming/lifecycle/types.ts";

/** Honor forward UTC corrections without letting rollback extend elapsed budgets. */
export function createExecutorNodeClock(
  wallNow: () => number = () => Date.now(),
  elapsed: MonotonicClock = performanceMonotonicClock,
): HostedExecutorSessionClock {
  const clock = createHostedExecutorSessionClock(wallNow(), elapsed);
  let correction = 0;
  return {
    ...clock,
    now() {
      const elapsedNow = clock.now();
      const value = Math.max(elapsedNow + correction, wallNow());
      correction = value - elapsedNow;
      return value;
    },
  };
}

export const executorNodeClock = createExecutorNodeClock();

/** Timer delivery can precede the clock deadline. Expire only once it is due. */
export function scheduleExecutorNodeDeadline(
  clock: HostedExecutorSessionClock,
  deadline: number,
  expire: () => void,
): () => void {
  let canceled = false;
  let handle: unknown;
  const wake = () => {
    if (canceled) return;
    const remaining = deadline - clock.now();
    if (remaining > 0) {
      handle = clock.schedule(wake, remaining);
      return;
    }
    canceled = true;
    expire();
  };
  handle = clock.schedule(wake, Math.max(0, deadline - clock.now()));
  return () => {
    if (canceled) return;
    canceled = true;
    clock.cancel(handle);
  };
}
