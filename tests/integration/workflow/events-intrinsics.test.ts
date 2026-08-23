import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  deriveRunEvents,
  isTerminalRunStatus,
  type RunEventSnapshot,
  snapshotRun,
} from "#veryfront/workflow/events.ts";
import { MemoryBackend } from "#veryfront/workflow/backends/memory.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type { WorkflowRun } from "#veryfront/workflow/types.ts";

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

  it("requires descriptor value fields to be own properties", () => {
    const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    let getterCalls = 0;
    const nodeErrors = Object.defineProperty({}, "a", {
      enumerable: true,
      get: () => "accessor error",
    });
    let events;
    try {
      Object.defineProperty(Object.prototype, "value", {
        configurable: true,
        get() {
          getterCalls++;
          return "forged error";
        },
      });
      events = deriveRunEvents(
        "run",
        { status: "running", nodes: { a: { status: "running", attempt: 1 } } },
        { status: "running", nodes: { a: { status: "failed", attempt: 1 } } },
        undefined,
        nodeErrors,
      );
    } finally {
      if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
      else Reflect.deleteProperty(Object.prototype, "value");
    }

    assertEquals(events, [
      { type: "step.failed", runId: "run", nodeId: "a", attempt: 1 },
    ]);
    assertEquals(getterCalls, 0);
  });

  it("defines event array slots without invoking prototype setters", () => {
    const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    let setterCalls = 0;
    let events;
    try {
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set() {
          setterCalls++;
        },
      });
      events = deriveRunEvents(
        "run",
        { status: "running", nodes: {} },
        { status: "completed", nodes: {} },
      );
    } finally {
      if (originalZero) Object.defineProperty(Array.prototype, "0", originalZero);
      else Reflect.deleteProperty(Array.prototype, "0");
    }

    assertEquals(events, [{ type: "run.status", runId: "run", status: "completed" }]);
    assertEquals(setterCalls, 0);
  });

  it("preserves reserved node IDs through a real memory backend observation", async () => {
    const backend = new MemoryBackend();
    const run: WorkflowRun = {
      id: "reserved-run",
      workflowId: "workflow",
      status: "pending",
      input: {},
      nodeStates: {},
      currentNodes: [],
      context: { input: {} },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
    };
    await backend.createRun(run);
    const observation = await backend.openRunObservation(run.id);
    if (!observation) throw new Error("Expected memory observation");
    const nodeStates = Object.create(null);
    Object.defineProperty(nodeStates, "__proto__", {
      enumerable: true,
      value: { nodeId: "__proto__", status: "running", attempt: 1 },
    });
    const originalProto = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__");
    let setterCalls = 0;

    try {
      Object.defineProperty(Object.prototype, "__proto__", {
        configurable: true,
        set() {
          setterCalls++;
        },
      });
      await backend.updateRun(run.id, { status: "running", nodeStates });
    } finally {
      if (originalProto) Object.defineProperty(Object.prototype, "__proto__", originalProto);
      else Reflect.deleteProperty(Object.prototype, "__proto__");
    }

    const state = (await observation.changes[Symbol.asyncIterator]().next()).value;
    assertEquals(state?.nodes["__proto__"], { status: "running", attempt: 1 });
    assertEquals(setterCalls, 0);
    await observation.close();
    await backend.destroy();
  });
});
