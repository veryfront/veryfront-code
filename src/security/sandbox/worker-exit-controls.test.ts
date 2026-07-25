import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createWorkerExitControls } from "./worker-exit-controls.ts";

describe("createWorkerExitControls", () => {
  it("notifies before closing the worker", () => {
    const events: string[] = [];
    const controls = createWorkerExitControls({
      notifyExit: () => events.push("notify"),
      closeWorker: () => events.push("close"),
    });

    controls.close();

    assertEquals(events, ["notify", "close"]);
  });

  it("always closes the worker when exit notification fails", () => {
    const events: string[] = [];
    const closeError = new Error("worker closed");
    const controls = createWorkerExitControls({
      notifyExit: () => {
        events.push("notify");
        throw new Error("notification failed");
      },
      closeWorker: () => {
        events.push("close");
        throw closeError;
      },
    });

    let thrown: unknown;
    try {
      controls.close();
    } catch (error) {
      thrown = error;
    }

    assertStrictEquals(thrown, closeError);
    assertEquals(events, ["notify", "close"]);
  });

  it("notifies before invoking native Deno.exit", () => {
    const events: string[] = [];
    const exitError = new Error("worker exited");
    const controls = createWorkerExitControls({
      notifyExit: () => events.push("notify"),
      closeWorker: () => {
        throw new Error("close should not be used by Deno.exit");
      },
      exitWorker: (code) => {
        events.push(`exit:${code}`);
        throw exitError;
      },
    });

    let thrown: unknown;
    try {
      controls.exit?.(17);
    } catch (error) {
      thrown = error;
    }

    assertStrictEquals(thrown, exitError);
    assertEquals(events, ["notify", "exit:17"]);
  });

  it("always invokes native Deno.exit when exit notification fails", () => {
    const events: string[] = [];
    const exitError = new Error("worker exited");
    const controls = createWorkerExitControls({
      notifyExit: () => {
        events.push("notify");
        throw new Error("notification failed");
      },
      closeWorker: () => {
        throw new Error("close should not be used by Deno.exit");
      },
      exitWorker: (code) => {
        events.push(`exit:${code}`);
        throw exitError;
      },
    });

    let thrown: unknown;
    try {
      controls.exit?.(17);
    } catch (error) {
      thrown = error;
    }

    assertStrictEquals(thrown, exitError);
    assertEquals(events, ["notify", "exit:17"]);
  });
});
