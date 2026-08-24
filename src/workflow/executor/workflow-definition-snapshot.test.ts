import "#veryfront/schemas/_test-setup.ts";

import { VeryfrontError } from "#veryfront/errors";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { WaitNodeConfig, WorkflowDefinition, WorkflowNode } from "../types.ts";
import {
  captureWorkflowDefinition,
  captureWorkflowDefinitions,
  captureWorkflowMapItems,
  captureWorkflowNodes,
  captureWorkflowStaticValue,
  captureWorkflowStringList,
  cloneCapturedWorkflowStaticValue,
} from "./workflow-definition-snapshot.ts";

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
      VeryfrontError,
      "timeout must be a string or number",
    );
    assertThrows(
      () =>
        captureWorkflowDefinition(workflowWith(step({
          retry: { backoff: hostile },
        }))),
      VeryfrontError,
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
      VeryfrontError,
      "iterationTimeout must be a string or number",
    );

    assertEquals(hooks, 0);
  });

  it("rejects invalid executable step contracts at admission", () => {
    assertThrows(
      () => captureWorkflowDefinition(workflowWith(step({ tool: undefined }))),
      VeryfrontError,
      "must configure exactly one of agent or tool",
    );
    assertThrows(
      () => captureWorkflowDefinition(workflowWith(step({ agent: "agent" }))),
      VeryfrontError,
      "must configure exactly one of agent or tool",
    );
    assertThrows(
      () => captureWorkflowDefinition(workflowWith(step({ timeout: 0 }))),
      VeryfrontError,
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
      VeryfrontError,
      "steps builder must be a non-Proxy function",
    );
    assertEquals(calls, 0);
  });

  it("captures and clones static helper values without retaining caller state", () => {
    const source = { nested: { count: 1 } };
    const captured = captureWorkflowStaticValue(source, "Static value");
    const clone = cloneCapturedWorkflowStaticValue(captured, "Static value clone");
    const mapItems = captureWorkflowMapItems([{ id: "one" }], "Map items");

    source.nested.count = 2;
    clone.nested.count = 3;

    assertEquals(captured, { nested: { count: 1 } });
    assertEquals(clone, { nested: { count: 3 } });
    assertEquals(Object.isFrozen(captured), true);
    assertEquals(Object.isFrozen(captured.nested), true);
    assertEquals(mapItems, [{ id: "one" }]);
    assertEquals(Object.isFrozen(mapItems), true);
  });

  it("captures definition batches and rejects duplicate workflow IDs", () => {
    const captured = captureWorkflowDefinitions([
      { id: "first", steps: [step()] },
      { id: "second", steps: [step({ tool: "second-tool" })] },
    ]);

    assertEquals(captured.map((workflow) => workflow.id), ["first", "second"]);
    assertEquals(Object.isFrozen(captured), true);
    assertThrows(
      () =>
        captureWorkflowDefinitions([
          { id: "duplicate", steps: [step()] },
          { id: "duplicate", steps: [step({ tool: "other-tool" })] },
        ]),
      VeryfrontError,
      "Workflow already registered in batch",
    );
  });

  it("captures canonical string lists and rejects duplicate entries", () => {
    const source = ["first", "second"];
    const captured = captureWorkflowStringList(source, "Approvers", {
      requireNonEmpty: true,
    });

    source[0] = "changed";

    assertEquals(captured, ["first", "second"]);
    assertEquals(Object.isFrozen(captured), true);
    assertThrows(
      () => captureWorkflowStringList(["duplicate", "duplicate"], "Approvers"),
      VeryfrontError,
      "must not contain duplicate values",
    );
  });

  it("validates helper options without invoking accessors", () => {
    let calls = 0;
    const nodeOptions = Object.defineProperty({}, "allowEmpty", {
      enumerable: true,
      get() {
        calls++;
        return true;
      },
    });
    const stringOptions = Object.defineProperty({}, "allowUndefined", {
      enumerable: true,
      get() {
        calls++;
        return true;
      },
    });

    assertThrows(
      () => captureWorkflowNodes([], "Dynamic nodes", nodeOptions as never),
      VeryfrontError,
      "must be an own data property",
    );
    assertThrows(
      () => captureWorkflowStringList(undefined, "Approvers", stringOptions as never),
      VeryfrontError,
      "must be an own data property",
    );
    assertEquals(calls, 0);
  });
});
