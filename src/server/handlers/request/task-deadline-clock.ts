/** Host-owned deadline operations; project code cannot replace the captured defaults. */
export interface TaskDeadlineClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer(handle: ReturnType<typeof setTimeout> | undefined): void;
}

const IntrinsicFreeze = Object.freeze;
const IntrinsicApply = Reflect.apply;
const IntrinsicNow = Date.now;
const IntrinsicSetTimeout = globalThis.setTimeout;
const IntrinsicClearTimeout = globalThis.clearTimeout;

export const systemTaskDeadlineClock: TaskDeadlineClock = IntrinsicFreeze({
  now: () => IntrinsicNow(),
  setTimer: (callback: () => void, delayMs: number) => IntrinsicSetTimeout(callback, delayMs),
  clearTimer: (handle: ReturnType<typeof setTimeout> | undefined) => IntrinsicClearTimeout(handle),
});

/** Snapshot the trusted constructor dependency before any project operation executes. */
export function snapshotTaskDeadlineClock(clock: TaskDeadlineClock): TaskDeadlineClock {
  const now = clock.now;
  const setTimer = clock.setTimer;
  const clearTimer = clock.clearTimer;
  return IntrinsicFreeze({
    now: () => IntrinsicApply(now, clock, []),
    setTimer: (callback: () => void, delayMs: number) =>
      IntrinsicApply(setTimer, clock, [callback, delayMs]),
    clearTimer: (handle: ReturnType<typeof setTimeout> | undefined) =>
      IntrinsicApply(clearTimer, clock, [handle]),
  });
}
