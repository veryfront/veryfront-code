import type { MonotonicClock } from "./types.ts";

export const performanceMonotonicClock: MonotonicClock = {
  nowMs: () => performance.now(),
  waitUntil(deadlineMs, signal) {
    if (signal?.aborted) return Promise.resolve("aborted");
    return new Promise((resolve) => {
      let settled = false;
      let timeoutId: number | undefined;
      const onAbort = () => finish("aborted");
      const finish = (result: "deadline" | "aborted") => {
        if (settled) return;
        settled = true;
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      timeoutId = setTimeout(
        () => finish("deadline"),
        Math.max(0, deadlineMs - performance.now()),
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) finish("aborted");
    });
  },
};
