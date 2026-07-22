import { isDeno } from "../runtime.ts";
import { scaleDuration } from "../time-scale.ts";

// no cleanup needed: one-shot
function nodeDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleDuration(ms)));
}

export let delay: (ms: number) => Promise<void>;

if (!isDeno) {
  delay = nodeDelay;
} else {
  const { delay: stdDelay } = await import("#std/async.ts");
  delay = (ms: number) => stdDelay(scaleDuration(ms));
}
