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
});
