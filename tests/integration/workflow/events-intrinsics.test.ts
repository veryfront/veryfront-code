import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isTerminalRunStatus,
  type RunEventSnapshot,
  snapshotRun,
} from "#veryfront/workflow/events.ts";

describe("workflow events with hostile ambient intrinsics", () => {
  it("does not trust a replaced Array.prototype.includes for terminal status", () => {
    const originalIncludes = Array.prototype.includes;
    try {
      Array.prototype.includes = () => false;
      assertEquals(isTerminalRunStatus("completed"), true);
      assertEquals(isTerminalRunStatus("running"), false);
    } finally {
      Array.prototype.includes = originalIncludes;
    }
  });

  it("does not trust the live array iterator while snapshotting nodes", () => {
    const originalIterator = Array.prototype[Symbol.iterator];
    let snapshot: RunEventSnapshot | undefined;
    try {
      Array.prototype[Symbol.iterator] = function* () {
        yield this[0];
        yield this[0];
      };
      snapshot = snapshotRun({
        status: "running",
        nodeStates: {
          alpha: { nodeId: "alpha", status: "completed", attempt: 2 },
        },
      } as never);
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }

    assertEquals(snapshot?.nodes.alpha, { status: "completed", attempt: 2 });
  });
});
