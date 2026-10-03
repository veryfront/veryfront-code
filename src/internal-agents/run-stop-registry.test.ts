import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RunStopRegistry } from "./run-stop-registry.ts";

describe("runtime cancellation settlement", () => {
  it("does not acknowledge signalling or a missing run, and acknowledges only after all executions settle", () => {
    const registry = new RunStopRegistry();
    let aborts = 0;
    const first = registry.register("run_1", () => {
      aborts++;
    });
    const second = registry.register("run_1", () => {
      aborts++;
    });
    assertEquals(registry.requestStop("unknown"), { accepted: false, stopped: false });
    assertEquals(registry.requestStop("run_1"), { accepted: true, stopped: false });
    assertEquals(aborts, 2);
    first();
    assertEquals(registry.requestStop("run_1"), { accepted: true, stopped: false });
    second();
    assertEquals(registry.requestStop("run_1"), { accepted: true, stopped: true });
    assertEquals(registry.requestStop("run_1"), { accepted: true, stopped: true });
    assertThrows(() => registry.register("run_1", () => {}), Error, "Run cancelled");
  });
  it("reserves bounded cancellation capacity so an owned execution can always be stopped", () => {
    const registry = new RunStopRegistry();
    let aborts = 0;
    const settle = registry.register("active", () => {
      aborts++;
    });
    for (let i = 0; i < 10_000; i++) {
      try {
        registry.requestStop(`unknown_${i}`);
      } catch (error) {
        assertEquals((error as Error).message, "Cancellation registry capacity reached");
      }
    }
    assertEquals(registry.requestStop("active"), { accepted: true, stopped: false });
    assertEquals(aborts, 1);
    settle();
    assertEquals(registry.requestStop("active"), { accepted: true, stopped: true });
    assertThrows(() => registry.register("active", () => {}), Error, "Run cancelled");
  });

  it("counts an active cancelled run once and refuses new admission before creating state", () => {
    const registry = new RunStopRegistry();
    const first = registry.register("active", () => {});
    registry.requestStop("active");
    for (let i = 0; i < 9_999; i++) registry.requestStop(`unknown_${i}`);
    assertThrows(
      () => registry.register("new", () => {}),
      Error,
      "Cancellation registry capacity reached",
    );
    assertEquals(registry.requestStop("active"), { accepted: true, stopped: false });
    first();
    assertEquals(registry.requestStop("active"), { accepted: true, stopped: true });
  });

  it("shares one reserved slot across executions of the same run", () => {
    const registry = new RunStopRegistry();
    const first = registry.register("active", () => {});
    for (let i = 0; i < 9_999; i++) registry.requestStop(`unknown_${i}`);
    const second = registry.register("active", () => {});
    assertEquals(registry.requestStop("active"), { accepted: true, stopped: false });
    first();
    assertEquals(registry.requestStop("active"), { accepted: true, stopped: false });
    second();
    assertEquals(registry.requestStop("active"), { accepted: true, stopped: true });
  });

  it("retires an abandoned registration without recording settlement evidence", () => {
    const registry = new RunStopRegistry();
    const orphan = registry.register("resume", () => {});
    orphan("abandoned");
    assertEquals(registry.requestStop("resume"), { accepted: false, stopped: false });

    const retry = new RunStopRegistry();
    const abandoned = retry.register("resume", () => {});
    const owner = retry.register("resume", () => {});
    abandoned("abandoned");
    owner();
    assertEquals(retry.requestStop("resume"), { accepted: true, stopped: true });

    const ordered = new RunStopRegistry();
    const settledOwner = ordered.register("resume", () => {});
    const unowned = ordered.register("resume", () => {});
    settledOwner();
    unowned("abandoned");
    assertEquals(ordered.requestStop("resume"), { accepted: true, stopped: true });

    const fresh = new RunStopRegistry();
    const first = fresh.register("resume", () => {});
    const second = fresh.register("resume", () => {});
    first();
    second();
    const orphan2 = fresh.register("resume", () => {});
    orphan2("abandoned");
    assertEquals(fresh.requestStop("resume"), { accepted: false, stopped: false });
  });
});
