import "#veryfront/schemas/_test-setup.ts";

import { VeryfrontError } from "#veryfront/errors";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES,
  MAX_WORKFLOW_DEFINITION_STATIC_BYTES,
  MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS,
} from "../limits.ts";
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
  it("keeps a workflow's output selector and rejects one that is not a function (#2107)", () => {
    const output = (context: Record<string, unknown>) => context.work;
    const captured = captureWorkflowDefinition({
      id: "selecting-workflow",
      steps: [step()],
      output,
    });

    assertEquals(captured.output, output);
    assertThrows(
      () =>
        captureWorkflowDefinition({
          id: "bad-selector",
          steps: [step()],
          output: "work",
        } as unknown as WorkflowDefinition),
      VeryfrontError,
      "output",
    );
  });

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

  it("rejects an unmarked raw wait on the reserved delay name", () => {
    assertThrows(
      () =>
        captureWorkflowDefinition(workflowWith({
          id: "unmarked-reserved-wait",
          config: {
            type: "wait",
            waitType: "event",
            eventName: "__delay__",
            timeout: 5,
            checkpoint: true,
          },
        })),
      Error,
      "reserved delay event name requires the delay marker",
    );
  });

  it("rejects an explicit event marker on the reserved delay name", () => {
    assertThrows(
      () =>
        captureWorkflowDefinition(workflowWith({
          id: "explicit-event-on-reserved-name",
          config: {
            type: "wait",
            waitType: "event",
            eventName: "__delay__",
            _waitKind: "event",
            timeout: 5,
            checkpoint: true,
          } as unknown as WaitNodeConfig,
        })),
      Error,
      "reserved delay event name requires the delay marker",
    );
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
  it("detaches and freezes Map and Set contents while retaining shared references", () => {
    const key = { id: "key" };
    const value = { count: 1 };
    const source = { map: new Map([[key, value]]), set: new Set([value]) };
    const captured = captureWorkflowStaticValue(source, "Collections");
    const capturedKey = [...captured.map.keys()][0]!;
    const capturedValue = captured.map.get(capturedKey)!;

    key.id = "changed";
    value.count = 2;
    source.map.clear();
    source.set.clear();

    assertEquals(capturedKey, { id: "key" });
    assertEquals(capturedValue, { count: 1 });
    assertEquals([...captured.set][0], capturedValue);
    assert(capturedKey !== key);
    assert(capturedValue !== value);
    for (const item of [captured.map, captured.set, capturedKey, capturedValue]) {
      assertEquals(Object.isFrozen(item), true);
    }

    const clone = cloneCapturedWorkflowStaticValue(captured, "Collection clone");
    const cloneKey = [...clone.map.keys()][0]!;
    clone.map.get(cloneKey)!.count = 3;
    assertEquals(capturedValue.count, 1);
    assertEquals([...clone.set][0], clone.map.get(cloneKey));
  });

  it("detaches binary views and preserves canonical Date and RegExp values", () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const source = {
      buffer,
      view: new DataView(buffer, 1, 2),
      typed: new Uint16Array([5, 6]),
      date: new Date("2026-01-02T03:04:05.000Z"),
      regexp: /value/giu,
    };
    const captured = captureWorkflowStaticValue(source, "Native values");
    new Uint8Array(buffer).fill(9);
    source.typed.fill(8);
    source.date.setUTCFullYear(2030);

    assertEquals([...new Uint8Array(captured.buffer)], [1, 2, 3, 4]);
    assertEquals(captured.view.buffer, captured.buffer);
    assertEquals(captured.view.byteOffset, 1);
    assertEquals(captured.view.byteLength, 2);
    assertEquals(captured.view.getUint8(0), 2);
    assertEquals([...captured.typed], [5, 6]);
    assertEquals(captured.date.toISOString(), "2026-01-02T03:04:05.000Z");
    assertEquals(captured.regexp.source, "value");
    assertEquals(captured.regexp.flags, "giu");
    assertEquals(captured.regexp.lastIndex, 0);
    assertEquals(Object.isFrozen(captured.date), true);
    assertEquals(Object.isFrozen(captured.regexp), true);
    assertEquals(Object.isFrozen(captured.view), true);
  });

  it("rejects custom native properties and stateful regular expressions", () => {
    const values = [
      Object.assign(new Map(), { extra: true }),
      Object.assign(new Set(), { extra: true }),
      Object.assign(new Uint8Array([1]), { extra: true }),
      Object.assign(new Date(0), { extra: true }),
      Object.assign(new ArrayBuffer(1), { extra: true }),
      Object.assign(new DataView(new ArrayBuffer(1)), { extra: true }),
      Object.assign(/value/u, { extra: true }),
    ];
    for (const value of values) {
      assertThrows(
        () => captureWorkflowStaticValue(value, "Custom native value"),
        VeryfrontError,
        "custom properties",
      );
    }
    const regexp = /value/g;
    regexp.lastIndex = 1;
    assertThrows(
      () => captureWorkflowStaticValue(regexp, "Stateful expression"),
      VeryfrontError,
      "lastIndex must be zero",
    );
    assertThrows(
      () => captureWorkflowStaticValue(new Date(NaN), "Invalid date"),
      VeryfrontError,
      "invalid Date",
    );
  });

  it("rejects shared memory before exposing buffers or views in a snapshot", () => {
    const shared = new SharedArrayBuffer(8);
    assertThrows(
      () => captureWorkflowStaticValue(shared, "Shared buffer"),
      VeryfrontError,
      "SharedArrayBuffer",
    );
    for (const value of [new DataView(shared), new Uint8Array(shared)]) {
      assertThrows(
        () => captureWorkflowStaticValue(value, "Shared view"),
        VeryfrontError,
        "must not view shared memory",
      );
    }
  });

  it("enforces collection, text, and byte budgets for native static values", () => {
    const count = MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES + 1;
    const entries = Array.from({ length: count }, (_, index) => [index, index] as const);
    for (
      const value of [
        new Map(entries),
        new Set(entries.map(([key]) => key)),
        new Uint8Array(count),
      ]
    ) {
      assertThrows(
        () => captureWorkflowStaticValue(value, "Large collection"),
        VeryfrontError,
        "too many entries",
      );
    }
    assertThrows(
      () =>
        captureWorkflowStaticValue(
          "x".repeat(MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS + 1),
          "Long text",
        ),
      VeryfrontError,
      "string exceeds",
    );
    assertThrows(
      () =>
        captureWorkflowStaticValue(
          new ArrayBuffer(MAX_WORKFLOW_DEFINITION_STATIC_BYTES + 1),
          "Large buffer",
        ),
      VeryfrontError,
      "maximum static size",
    );
  });
  it("captures nested workflow and map collaborators without retaining static inputs", () => {
    const input = { count: 1 };
    const items = () => [1];
    const nested = { id: "nested", steps: [step()] };
    const configs = [
      { type: "subWorkflow", workflow: nested, input },
      { type: "subWorkflow", workflow: "nested", input: items },
      { type: "map", items, processor: nested, concurrency: 2 },
    ];
    const captured = configs.map((config) => {
      const definition = captureWorkflowDefinition(
        workflowWith({ id: "parent", config } as WorkflowNode),
      );
      assert(Array.isArray(definition.steps));
      return definition.steps[0]!.config;
    });
    input.count = 2;
    nested.steps.length = 0;
    assertEquals((captured[0]! as { input: unknown }).input, { count: 1 });
    const subWorkflow = captured[0]!;
    assert(subWorkflow.type === "subWorkflow");
    assert(typeof subWorkflow.workflow !== "string");
    assert(Array.isArray(subWorkflow.workflow.steps));
    assertEquals(subWorkflow.workflow.steps.length, 1);
    assertEquals((captured[1]! as { input: unknown }).input, items);
    const map = captured[2]!;
    assert(map.type === "map");
    assertEquals(map.items, items);
    assert("steps" in map.processor);
    assert(Array.isArray(map.processor.steps));
    assertEquals(map.processor.steps.length, 1);
    assertEquals(Object.isFrozen(map.processor), true);
  });

  it("rejects invalid config collaborators and static record descriptors", () => {
    const configs: Record<string, unknown>[] = [
      { type: "step", agent: 1 },
      { type: "parallel", strategy: "invalid", nodes: [] },
      { type: "wait", waitType: "invalid" },
      { type: "wait", waitType: "event" },
      { type: "subWorkflow", workflow: 1 },
      { type: "map", processor: step() },
      { type: "map", items: 1, processor: step() },
      { type: "map", items: [], processor: null },
      { type: "map", items: [], processor: step(), concurrency: 0 },
      { type: "loop", while: () => true, steps: 1, maxIterations: 2 },
      { type: "loop", while: () => true, steps: [], maxIterations: 101 },
    ];
    for (const config of configs) {
      assertThrows(
        () =>
          captureWorkflowDefinition(
            workflowWith({ id: "invalid", config } as unknown as WorkflowNode),
          ),
        VeryfrontError,
      );
    }
    const values = [
      { [Symbol("unsupported")]: true },
      { ["x".repeat(MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS + 1)]: true },
      Object.defineProperty({}, "hidden", { value: true }),
      Object.fromEntries(Array.from(
        { length: MAX_WORKFLOW_DEFINITION_COLLECTION_ENTRIES + 1 },
        (_, index) => [String(index), true],
      )),
    ];
    for (const value of values) {
      assertThrows(() => captureWorkflowStaticValue(value, "Invalid record"), VeryfrontError);
    }
  });
});
