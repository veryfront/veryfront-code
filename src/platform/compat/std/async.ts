import { isDeno } from "../runtime.ts";
import { scaleMs } from "#veryfront/testing/timing.ts";

export interface DelayOptions {
  signal?: AbortSignal;
  persistent?: boolean;
}

const MAX_TIMER_DELAY = 2 ** 31 - 1;

function setNodeTimeout(
  callback: () => void,
  delayMs: number,
  persistent: boolean,
): () => void {
  const normalizedDelay = Math.trunc(Math.max(delayMs, 0) || 0);
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout>;

  const schedule = (): void => {
    const remaining = normalizedDelay - (Date.now() - startedAt);
    timeout = setTimeout(
      remaining > MAX_TIMER_DELAY ? schedule : callback,
      Math.min(remaining, MAX_TIMER_DELAY),
    );
    const unref = (timeout as unknown as { unref?: () => void }).unref;
    if (!persistent && typeof unref === "function") {
      unref.call(timeout);
    }
  };

  schedule();
  return () => clearTimeout(timeout);
}

function nodeDelay(ms: number, options: DelayOptions = {}): Promise<void> {
  const { signal, persistent = true } = options;
  if (signal?.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clear();
      reject(signal?.reason);
    };
    const done = (): void => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const clear = setNodeTimeout(done, scaleMs(ms), persistent);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export let delay: (ms: number, options?: DelayOptions) => Promise<void>;

if (!isDeno) {
  delay = nodeDelay;
} else {
  const { delay: stdDelay } = await import("#std/async.ts");
  delay = (ms: number, options?: DelayOptions) => stdDelay(scaleMs(ms), options);
}
