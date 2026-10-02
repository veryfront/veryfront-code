import {
  createHostedExecutorSessionClock,
  type HostedExecutorSessionClock,
} from "./executor-session.ts";

export const executorNodeClock = createHostedExecutorSessionClock(Date.now());

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
