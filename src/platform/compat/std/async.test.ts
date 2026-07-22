import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { testDelay } from "#veryfront/testing/timing.ts";
import { readTextFile } from "../fs.ts";
import { fromFileUrl } from "../path/index.ts";
import { deleteEnv, setEnv } from "../process.ts";
import { delay } from "./async.ts";

const TEST_TIME_SCALE_ENV = "VF_TEST_TIME_SCALE";

function captureScheduledDelay(schedule: () => Promise<void>): {
  delayMs: number;
  pending: Promise<void>;
} {
  const originalSetTimeout = globalThis.setTimeout;
  let delayMs: number | undefined;
  let pending: Promise<void> | undefined;

  try {
    globalThis.setTimeout = ((
      callback: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      delayMs = ms ?? 0;
      queueMicrotask(() => callback(...args));
      return 0;
    }) as unknown as typeof globalThis.setTimeout;
    pending = schedule();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  if (delayMs === undefined || pending === undefined) {
    throw new Error("Expected delay to schedule a timer");
  }
  return { delayMs, pending };
}

describe("platform/compat/std/async", () => {
  afterEach(() => deleteEnv(TEST_TIME_SCALE_ENV));

  it("runtime and testing delays use the same current scale", async () => {
    setEnv(TEST_TIME_SCALE_ENV, "0.25");
    const runtimeDelay = captureScheduledDelay(() => delay(100));
    const testingDelay = captureScheduledDelay(() => testDelay(100));

    assertEquals(runtimeDelay.delayMs, 25);
    assertEquals(testingDelay.delayMs, 25);
    await Promise.all([runtimeDelay.pending, testingDelay.pending]);
  });

  it("keeps production runtime imports outside the testing module", async () => {
    const source = await readTextFile(fromFileUrl(new URL("./async.ts", import.meta.url)));
    const importSpecifiers = Array.from(
      source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      (match) => match[1],
    );

    assertEquals(
      importSpecifiers.filter((specifier) => specifier?.includes("/testing/")),
      [],
    );
  });
});
