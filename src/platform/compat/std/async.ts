import { isDeno } from "../runtime.ts";
import { scaleMs } from "../../../testing/timing.ts";

function nodeDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

export let delay: (ms: number) => Promise<void>;

if (!isDeno) {
  delay = nodeDelay;
} else {
  const { delay: stdDelay } = await import("#std/async.ts");
  delay = (ms: number) => stdDelay(scaleMs(ms));
}
