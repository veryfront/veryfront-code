import "#veryfront/schemas/_test-setup.ts";

import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { WaitNodeConfig, WorkflowDefinition, WorkflowNode } from "../types.ts";
import { captureWorkflowDefinition } from "./workflow-definition-snapshot.ts";

function workflowWith(node: WorkflowNode): WorkflowDefinition {
  return { id: "test-workflow", steps: [node] };
}

function step(overrides: Record<string, unknown> = {}): WorkflowNode {
  return {
    id: "step",
    config: { type: "step", tool: "test", ...overrides },
  } as WorkflowNode;
}

describe("workflow definition snapshot", () => {
  it("captures and detaches the current top-level retry contract", () => {
    const retry = { maxAttempts: 3, backoff: "exponential" as const };
    const captured = captureWorkflowDefinition({
      id: "retrying-workflow",
      retry,
      steps: [step()],
    });

    retry.maxAttempts = 2;

    assertEquals(captured.retry, { maxAttempts: 3, backoff: "exponential" });
    assertEquals(Object.isFrozen(captured.retry), true);
  });

  it("captures integration requirements without ambient inspection methods", () => {
    const originalArrayIsArray = Array.isArray;
    const originalMapGet = Map.prototype.get;
    const originalMapHas = Map.prototype.has;
    const originalMapSet = Map.prototype.set;
    const originalObjectFreeze = Object.freeze;
    const originalObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalObjectGetPrototypeOf = Object.getPrototypeOf;
    const originalReflectApply = Reflect.apply;
    const originalReflectOwnKeys = Reflect.ownKeys;
    const originalSetHas = Set.prototype.has;
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("ambient workflow field Map method must not run");
    };
    let captured: WorkflowDefinition | undefined;

    try {
      Array.isArray = poison as unknown as typeof Array.isArray;
      Map.prototype.get = poison as typeof Map.prototype.get;
      Map.prototype.has = poison as typeof Map.prototype.has;
      Map.prototype.set = poison as typeof Map.prototype.set;
      Object.freeze = poison as typeof Object.freeze;
      Object.getOwnPropertyDescriptor = poison as typeof Object.getOwnPropertyDescriptor;
      Object.getPrototypeOf = poison as typeof Object.getPrototypeOf;
      Reflect.apply = poison as typeof Reflect.apply;
      Reflect.ownKeys = poison as typeof Reflect.ownKeys;
      Set.prototype.has = poison as typeof Set.prototype.has;
      captured = captureWorkflowDefinition(
        {
          id: "map-poison-workflow",
          steps: [],
          integrationRequirements: [{
            integration: "slack",
            requiredScopes: ["chat:write"],
            resources: [],
          }],
        },
        { allowEmptySteps: true },
      );
    } finally {
      Array.isArray = originalArrayIsArray;
      Map.prototype.get = originalMapGet;
      Map.prototype.has = originalMapHas;
      Map.prototype.set = originalMapSet;
      Object.freeze = originalObjectFreeze;
      Object.getOwnPropertyDescriptor = originalObjectGetOwnPropertyDescriptor;
      Object.getPrototypeOf = originalObjectGetPrototypeOf;
      Reflect.apply = originalReflectApply;
      Reflect.ownKeys = originalReflectOwnKeys;
      Set.prototype.has = originalSetHas;
    }

    assertEquals(poisonCalls, 0);
    assertEquals(captured?.integrationRequirements, [{
      integration: "slack",
      requiredScopes: ["chat:write"],
      resources: [],
    }]);
    assertEquals(Object.isFrozen(captured), true);
    assertThrows(
      () => {
        (captured as { integrationRequirements?: unknown[] }).integrationRequirements = [];
      },
      TypeError,
    );
  });

  it("rejects hostile timer and retry values without invoking Proxy hooks", () => {
    let hooks = 0;
    const hostile = new Proxy({}, {
      get() {
        hooks++;
        throw new Error("must not run");
      },
      getOwnPropertyDescriptor() {
        hooks++;
        throw new Error("must not run");
      },
      ownKeys() {
        hooks++;
        throw new Error("must not run");
      },
    });

    assertThrows(
      () =>
        captureWorkflowDefinition({
          id: "hostile-timeout",
          timeout: hostile as unknown as number,
          steps: [step()],
        }),
      Error,
      "timeout must be a string or number",
    );
    assertThrows(
      () =>
        captureWorkflowDefinition(workflowWith(step({
          retry: { backoff: hostile },
        }))),
      Error,
      "retry backoff must be a string",
    );
    assertThrows(
      () =>
        captureWorkflowDefinition(workflowWith({
          id: "loop",
          config: {
            type: "loop",
            while: () => false,
            steps: [],
            maxIterations: 1,
            iterationTimeout: hostile as unknown as number,
          },
        })),
      Error,
      "iterationTimeout must be a string or number",
    );

    assertEquals(hooks, 0);
  });

  it("rejects invalid executable step contracts at admission", () => {
    assertThrows(
      () => captureWorkflowDefinition(workflowWith(step({ tool: undefined }))),
      Error,
      "must configure exactly one of agent or tool",
    );
    assertThrows(
      () => captureWorkflowDefinition(workflowWith(step({ agent: "agent" }))),
      Error,
      "must configure exactly one of agent or tool",
    );
    assertThrows(
      () => captureWorkflowDefinition(workflowWith(step({ timeout: 0 }))),
      Error,
      "timeout must be greater than zero",
    );
  });

  it("marks raw events using the legacy delay transport name as explicit events", () => {
    const captured = captureWorkflowDefinition(workflowWith({
      id: "not-a-delay",
      config: {
        type: "wait",
        waitType: "event",
        eventName: "__delay__",
        timeout: 5,
        checkpoint: true,
      },
    }));
    assert(Array.isArray(captured.steps));
    const config = captured.steps[0]?.config as WaitNodeConfig & { _waitKind?: string };

    assertEquals(config.eventName, "__delay__");
    assertEquals(config._waitKind, "event");
  });

  it("refuses a forged delay marker on a wait that is not the reserved delay event", () => {
    assertThrows(
      () =>
        captureWorkflowDefinition(workflowWith({
          id: "forged-event",
          config: {
            type: "wait",
            waitType: "event",
            eventName: "user-approved",
            _waitKind: "delay",
            checkpoint: true,
          },
        } as unknown as WorkflowNode)),
      Error,
      "delay marker requires the reserved delay event name",
    );
    assertThrows(
      () =>
        captureWorkflowDefinition(workflowWith({
          id: "forged-approval",
          config: {
            type: "wait",
            waitType: "approval",
            _waitKind: "delay",
            checkpoint: true,
          },
        } as unknown as WorkflowNode)),
      Error,
      "delay marker requires the reserved delay event name",
    );
  });

  it("keeps the delay marker on the reserved delay event", () => {
    const captured = captureWorkflowDefinition(workflowWith({
      id: "real-delay",
      config: {
        type: "wait",
        waitType: "event",
        eventName: "__delay__",
        _waitKind: "delay",
        checkpoint: true,
      },
    } as unknown as WorkflowNode));
    assert(Array.isArray(captured.steps));
    const config = captured.steps[0]?.config as WaitNodeConfig & { _waitKind?: string };

    assertEquals(config._waitKind, "delay", "the reserved delay event keeps its delay marker");
  });

  it("rejects Proxy callbacks without invoking them", () => {
    let calls = 0;
    const builder = new Proxy(() => [step()], {
      apply() {
        calls++;
        return [step()];
      },
    });

    assertThrows(
      () => captureWorkflowDefinition({ id: "proxy-builder", steps: builder }),
      Error,
      "steps builder must be a non-Proxy function",
    );
    assertEquals(calls, 0);
  });
});
