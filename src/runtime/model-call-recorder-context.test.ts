import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelCallRecorder } from "./model-call-context.ts";
import {
  getActiveModelCallRecorder,
  resolveModelCallRecorder,
  runWithModelCallRecorder,
} from "./model-call-recorder-context.ts";

describe("model-call-recorder-context", () => {
  it("prefers the active scoped recorder and restores the configured recorder", async () => {
    const configured: ModelCallRecorder = () => {};
    const scoped: ModelCallRecorder = () => {};

    assertEquals(resolveModelCallRecorder(configured), configured);
    await runWithModelCallRecorder(scoped, async () => {
      assertEquals(getActiveModelCallRecorder(), scoped);
      assertEquals(resolveModelCallRecorder(configured), scoped);
    });
    assertEquals(getActiveModelCallRecorder(), undefined);
    assertEquals(resolveModelCallRecorder(configured), configured);
  });

  it("isolates concurrent recorder scopes", async () => {
    const first: ModelCallRecorder = () => {};
    const second: ModelCallRecorder = () => {};
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstRun = runWithModelCallRecorder(first, async () => {
      await firstBlocked;
      return getActiveModelCallRecorder();
    });
    const secondRun = runWithModelCallRecorder(second, async () => {
      await Promise.resolve();
      releaseFirst();
      return getActiveModelCallRecorder();
    });

    assertEquals(await Promise.all([firstRun, secondRun]), [first, second]);
    assertEquals(getActiveModelCallRecorder(), undefined);
  });
});
